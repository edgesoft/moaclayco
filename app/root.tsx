import type {LinksFunction} from 'remix'
import {Meta, Links, Scripts, useLoaderData, LiveReload, useCatch} from 'remix'
import tailwindStyles from './styles/tailwind.css'
import {Outlet} from 'react-router-dom'
import {CartProvider} from 'react-use-cart'
import Cookies from './components/cookies'
import Header from './components/header'
import Footer from './components/footer'

export function loader() {
  return {
    ENV: {
      STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
    },
  }
}

export let links: LinksFunction = () => {
  return [{rel: 'stylesheet', href: tailwindStyles}]
}


function Document({
  children,
  title,
}: {
  children: React.ReactNode
  title?: string
}) {
  let data = useLoaderData()
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"
        />

        <link rel="icon" href="/favicon.png" type="image/png" />
        {title ? <title>{title}</title> : null}
        <Meta />
        <Links />
      </head>
      <body>
        <Header />
        {children}
        <Scripts />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.ENV = ${JSON.stringify(data.ENV)}`,
          }}
        />
        {process.env.NODE_ENV === 'development' && <LiveReload />}
      </body>
    </html>
  )
}

export default function App() {
  return (
    <CartProvider>
      <Document>
        <Outlet />
        <Footer/>
        <Cookies />
      </Document>
    </CartProvider>
  )
}

export function CatchBoundary() {
  let caught = useCatch()

  switch (caught.status) {
    case 401:
    case 404:
      return (
        <Document title={`${caught.status} ${caught.statusText}`}>
          <h1>
            {caught.status} {caught.statusText}
          </h1>
        </Document>
      )

    default:
      throw new Error(
        `Unexpected caught response with status: ${caught.status}`,
      )
  }
}

export function ErrorBoundary({error}: {error: Error}) {
  console.error(error)

  return (
    <Document title="Uh-oh!">
      <h1>App Error</h1>
      <pre>{error.message}</pre>
      <p>
        Replace this UI with what you want users to see when your app throws
        uncaught errors.
      </p>
    </Document>
  )
}
