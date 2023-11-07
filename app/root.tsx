import { LinksFunction, LoaderFunction, redirect } from "@remix-run/node";
import {
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import Header from "./components/header";
import Footer from "./components/footer";
import { CartProvider } from "react-use-cart";
import Cookies from "./components/cookies";
import tailwindStyles from "./styles/tailwind.css";
import appStyles from "./styles/app.css";
import { Collections } from "./schemas/collections";
import { auth } from "./services/auth.server";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: appStyles },
  { rel: "stylesheet", href: tailwindStyles },
];

export const loader: LoaderFunction = async ({ request }) => {
  const collections = await Collections.find().sort({ sortOrder: 1 });
  let url = new URL(request.url);
  let hostname = url.hostname;
  let proto = request.headers.get("X-Forwarded-Proto") ?? url.protocol;

  url.host =
    request.headers.get("X-Forwarded-Host") ??
    request.headers.get("host") ??
    url.host;
  url.protocol = "https:";

  if (proto === "http" && hostname !== "localhost") {
    return redirect(url.toString(), {
      headers: {
        "X-Forwarded-Proto": "https",
      },
    });
  }

  let user = await auth.isAuthenticated(request);

  return {
    user,
    ENV: {
      STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
    },
    collections,
  };
};

function Document({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  let data: { ENV: { STRIPE_PUBLIC_KEY: string } } = useLoaderData();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes"
        />
        <link rel="icon" href="/favicon.png" type="image/png" />
        {title ? <title>{title}</title> : null}
        <Meta />
        <Links />
      </head>
      <body>
     
        <Header />
        {children}
        <ScrollRestoration />
        <LiveReload />
        <Scripts />
        {data ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.ENV = ${JSON.stringify(data.ENV)}`,
            }}
          />
        ) : null}
        {process.env.NODE_ENV === "development" && <LiveReload />}
        <div id="portal"/>
      </body>
    </html>
  );
}

export default function App() {
  const data = useLoaderData();
  return (
    <CartProvider>
      <Document>
       <Outlet context={data} />
        <Cookies />
        <Footer />
      </Document>
    </CartProvider>
  );
}
