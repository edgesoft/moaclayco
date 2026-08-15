import {
  HeadersFunction,
  data as json,
  LinksFunction,
  LoaderFunction,
  MiddlewareFunction,
  redirect,
  Links,
  Meta,
  Outlet,
  ShouldRevalidateFunction,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useLocation,
  useNavigation,
  isRouteErrorResponse,
  useRouteError,
} from "react-router";
import { motion, useReducedMotion } from "framer-motion";
import { lazy, Suspense, useEffect, useRef } from "react";
import ArrowIcon from "./components/ArrowIcon";
import Header from "./components/header";
import Footer from "./components/footer";
import { CartProvider } from "react-use-cart";
import Cookies from "./components/cookies";
import tailwindStyles from "./styles/tailwind.css?url";
import appStyles from "./styles/app.css?url";
import { Collections } from "./schemas/collections";
import { activeCatalogCollectionFilter } from "~/utils/catalogCollections.server";
import { auth } from "./services/auth.server";
import { CollectionProps, User } from "./types";
import { theme } from "./components/Theme";
import { toLoaderData } from "./utils/loaderData";
import { isGoogleAuthenticationConfigured } from "./services/google-auth.server";
import { connectToDatabase } from "./services/database.server";
import { shouldRevalidateRoot } from "./utils/rootRevalidation";
import { collectionCardProjection } from "./utils/queryProjections.server";
import {
  catalogCacheKeys,
  readCatalogCache,
} from "./services/catalog-cache.server";
import {
  formatServerTiming,
  measureServerTiming,
  type ServerTimingMetric,
} from "./utils/serverTiming.server";
import { privateRootHeaders } from "./utils/responseHeaders";
import { scheduleExpiredImageDraftCleanup } from "./services/image-drafts.server";

export type IndexProps = {
  user?: User;
  ENV: {
    STRIPE_PUBLIC_KEY: string;
  };
  collections: CollectionProps[];
  googleAuthenticationConfigured: boolean;
};

const ToastRegion = lazy(() => import("./components/ToastRegion"));

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: appStyles },
  { rel: "stylesheet", href: tailwindStyles },
];

export const headers: HeadersFunction = ({ loaderHeaders }) =>
  privateRootHeaders(loaderHeaders);

export const middleware: MiddlewareFunction[] = [
  async (_args, next) => {
    await connectToDatabase();
    return next();
  },
];

export const loader: LoaderFunction = async ({ request }) => {
  scheduleExpiredImageDraftCleanup();
  const timings: ServerTimingMetric[] = [];
  const url = new URL(request.url);
  const hostname = url.hostname;
  const proto = request.headers.get("X-Forwarded-Proto") ?? url.protocol;

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

  let catalogCacheStatus = "miss";
  const [collections, user] = await Promise.all([
    measureServerTiming(
      timings,
      "root-catalog",
      () =>
        readCatalogCache(
          catalogCacheKeys.collections,
          async () =>
            toLoaderData(
              await Collections.find(activeCatalogCollectionFilter)
                .select(collectionCardProjection)
                .sort({ sortOrder: 1 })
                .lean()
                .exec()
            ),
          { onStatus: (status) => (catalogCacheStatus = status) }
        ),
      "collections"
    ),
    measureServerTiming(
      timings,
      "root-auth",
      () => auth.isAuthenticated(request),
      "session"
    ),
  ]);
  timings.push({
    description: catalogCacheStatus,
    duration: 0,
    name: "root-cache",
  });

  return json(
    {
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
        "Server-Timing": formatServerTiming(timings),
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
  return shouldRevalidateRoot({
    currentPathname: currentUrl.pathname,
    defaultShouldRevalidate,
    formMethod,
    nextPathname: nextUrl.pathname,
  });
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
  const location = useLocation();
  const usesToasts =
    location.pathname.startsWith("/admin/discounts") ||
    location.pathname === "/admin/verifications/new";
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
        {data?.ENV.STRIPE_PUBLIC_KEY ? (
          <meta
            name="stripe-public-key"
            content={data.ENV.STRIPE_PUBLIC_KEY}
          />
        ) : null}
        <Meta />
        <Links />
      </head>
      <body>
        <Header />
        {children}
        {usesToasts ? (
          <Suspense fallback={null}>
            <ToastRegion />
          </Suspense>
        ) : null}
        <ScrollRestoration />
        <Scripts />
        <div id="portal" />
      </body>
    </html>
  );
}

function RouteTransition({ data }: { data: IndexProps }) {
  const isFirstRenderRef = useRef(true);
  const location = useLocation();
  const navigation = useNavigation();
  const shouldReduceMotion = useReducedMotion();
  const isLeavingRoute =
    navigation.state === "loading" &&
    Boolean(navigation.location) &&
    navigation.location?.pathname !== location.pathname;
  const isAdminWorkspace =
    location.pathname.startsWith("/admin/orders") ||
    location.pathname.startsWith("/admin/verifications");
  const routeTransitionKey = location.pathname.startsWith("/admin/orders")
    ? "/admin/orders"
    : location.pathname;

  useEffect(() => {
    isFirstRenderRef.current = false;
  }, []);

  return (
    <motion.div
      animate={
        isLeavingRoute
          ? { opacity: 0.965, scale: 0.998, y: 3 }
          : { opacity: 1, scale: 1, y: 0 }
      }
      initial={
        shouldReduceMotion || isFirstRenderRef.current
          ? false
          : isAdminWorkspace
            ? { opacity: 0.92, y: 8 }
            : { opacity: 0.97, y: 4 }
      }
      key={routeTransitionKey}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : isLeavingRoute
            ? {
                duration: 0.12,
                ease: [0.4, 0, 1, 1],
              }
          : {
              duration: isAdminWorkspace ? 0.26 : 0.18,
              ease: [0.22, 1, 0.36, 1],
            }
      }
    >
      <Outlet context={data} />
    </motion.div>
  );
}

export default function App() {
  const data = useLoaderData<IndexProps>();
  return (
    <CartProvider>
      <Document>
        <RouteTransition data={data} />
        <Cookies />
        <Footer />
      </Document>
    </CartProvider>
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
                  Till startsidan <ArrowIcon />
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
