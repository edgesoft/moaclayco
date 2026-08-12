import {
  HeadersFunction,
  data as json,
  LinksFunction,
  LoaderFunction,
  redirect,
} from "react-router";
import {
  Links,
  Meta,
  Outlet,
  ShouldRevalidateFunction,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useLocation,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef } from "react";
import Header from "./components/header";
import Footer from "./components/footer";
import { CartProvider } from "react-use-cart";
import Cookies from "./components/cookies";
import tailwindStyles from "./styles/tailwind.css?url";
import appStyles from "./styles/app.css?url";
import itemEditorStyles from "./styles/item-editor.css?url";
import toastStyles from "./styles/toast.css?url";
import { Collections } from "./schemas/collections";
import { auth } from "./services/auth.server";
import s from "react-toastify/dist/ReactToastify.css?url";
import { ToastContainer } from "react-toastify";
import { CollectionProps, User } from "./types";
import { ThemeProvider, useTheme } from "./components/Theme";
import { getDomain } from "./utils/domain";
import { toLoaderData } from "./utils/loaderData";
import { isGoogleAuthenticationConfigured } from "./services/google-auth.server";

export type IndexProps = {
  hostname: string,
  user?: User;
  ENV: {
    STRIPE_PUBLIC_KEY: string;
  };
  collections: CollectionProps[];
  googleAuthenticationConfigured: boolean;
};

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: appStyles },
  { rel: "stylesheet", href: itemEditorStyles },
  { rel: "stylesheet", href: tailwindStyles },
  { rel: "stylesheet", href: s },
  { rel: "stylesheet", href: toastStyles },
];

export const headers: HeadersFunction = () => ({
  "Cache-Control": "private, no-store",
});

export const loader: LoaderFunction = async ({ request }) => {
  let domain = getDomain(request)
  const collections = toLoaderData(
    await Collections.find({ domain: domain?.domain })
      .sort({ sortOrder: 1 })
      .lean()
  );
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
 

  return json(
    {
      hostname,
      user,
      ENV: {
        STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
      },
      collections,
      googleAuthenticationConfigured: isGoogleAuthenticationConfigured(),
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    }
  );
};

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}) => {
  if (formMethod && formMethod !== "GET") return defaultShouldRevalidate;

  const staysInAccounting =
    currentUrl.pathname.startsWith("/admin/verifications") &&
    nextUrl.pathname.startsWith("/admin/verifications");

  return staysInAccounting ? false : defaultShouldRevalidate;
};

function Document({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  let data: { ENV: { STRIPE_PUBLIC_KEY: string } } =
  useLoaderData<IndexProps>();
  const theme = useTheme();
  return (
    <html lang="sv">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes"
        />
        <meta
          property="twitter:image"
          content={theme?.backgroundImage}
        />
        <meta
          property="og:image"
          content={theme?.backgroundImage}
        />
        {(theme?.favicon.endsWith(".svg")) ? <link rel="icon" type="image/svg+xml" href={theme?.favicon}></link> : <link rel="icon" href={String(theme?.favicon)} type="image/png" /> }
          
    
        {title ? <title>{title}</title> : null}
        <Meta />
        <Links />
      </head>
      <body>
        <Header />
        {children}
        <ToastContainer
          position="top-right"
          theme="light"
          hideProgressBar
          newestOnTop
          limit={3}
        />
        <ScrollRestoration />
        <Scripts />
        {data ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.ENV = ${JSON.stringify(data.ENV)}`,
            }}
          />
        ) : null}
        <div id="portal" />
      </body>
    </html>
  );
}

function RouteTransition({ data }: { data: IndexProps }) {
  const isFirstRender = useRef(true);
  const location = useLocation();
  const shouldReduceMotion = useReducedMotion();
  const routeTransitionKey = location.pathname.startsWith("/admin/orders")
    ? "/admin/orders"
    : location.pathname;

  useEffect(() => {
    isFirstRender.current = false;
  }, []);

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      initial={
        shouldReduceMotion || isFirstRender.current
          ? false
          : { opacity: 0.97, y: 4 }
      }
      key={routeTransitionKey}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
      }
    >
      <Outlet context={data} />
    </motion.div>
  );
}

export default function App() {
  const data = useLoaderData<IndexProps>();
  return (
    <ThemeProvider hostname={data.hostname}>
    <CartProvider>
      <Document>
        <RouteTransition data={data} />
        <Cookies />
        <Footer />
      </Document>
    </CartProvider>
    </ThemeProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const responseError = isRouteErrorResponse(error);
  const status = responseError ? error.status : 500;
  const isNotFound = status === 404;
  const isUnauthorized = status === 401 || status === 403;
  const title = isNotFound
    ? "Den sidan verkar ha flyttat på sig."
    : isUnauthorized
      ? "Här behöver du logga in."
      : status < 500
        ? "Det gick inte riktigt som tänkt."
        : "Något gick snett bakom kulisserna.";
  const responseMessage =
    responseError && typeof error.data === "string" && status < 500
      ? error.data
      : null;
  const message =
    responseMessage ??
    (isNotFound
      ? "Länken leder inte längre till en aktiv sida. Du hittar alla aktuella Collections från startsidan."
      : isUnauthorized
        ? "Administrationen är bara öppen för godkända konton."
        : "Försök igen om en liten stund. Om problemet återkommer får du gärna höra av dig till oss.");

  return (
    <html lang="sv">
      <head>
        <meta charSet="utf-8" />
        <meta
          content="width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes"
          name="viewport"
        />
        <title>{`${status} — Moa Clay Co`}</title>
        <link href="/favicon.png" rel="icon" type="image/png" />
        <Meta />
        <Links />
      </head>
      <body>
        <main className="mcc-error-page">
          <header className="mcc-error-header">
            <a aria-label="Moa Clay Co, till startsidan" href="/">
              <span>Moa Clay</span>
              <small>Co</small>
            </a>
          </header>

          <section className="mcc-error-content">
            <div aria-hidden="true" className="mcc-error-number">
              {status}
            </div>
            <div className="mcc-error-copy">
              <p className="mcc-error-kicker">Ett litet avbrott</p>
              <h1>{title}</h1>
              <p>{message}</p>
              <div className="mcc-error-actions">
                <a href="/">
                  Till startsidan <span aria-hidden="true">→</span>
                </a>
                {isUnauthorized ? (
                  <a className="is-secondary" href="/login">
                    Logga in
                  </a>
                ) : (
                  <button onClick={() => window.location.reload()} type="button">
                    Försök igen
                  </button>
                )}
              </div>
            </div>
          </section>

          <p className="mcc-error-note">
            Behöver du hjälp? Skriv till{" "}
            <a href="mailto:support@moaclayco.com">support@moaclayco.com</a>
          </p>
        </main>
        <Scripts />
      </body>
    </html>
  );
}
