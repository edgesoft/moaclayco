import type {LinksFunction, LoaderFunction} from 'remix'
import {Meta, Links, Scripts, useLoaderData, LiveReload, useCatch} from 'remix'
import tailwindStyles from './styles/tailwind.css'
import {Link, Outlet, useNavigate} from 'react-router-dom'
import {useCart} from 'react-use-cart'
import {CartProvider} from 'react-use-cart'

export function loader() {
  return {
    ENV: {
      STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY
    }
  };
}

export let links: LinksFunction = () => {
  return [{rel: 'stylesheet', href: tailwindStyles}]
}

const Header = (): JSX.Element => {
  const {totalItems} = useCart()
  const history = useNavigate()
  return (
    <Link to="/">
      <div style={{backgroundImage: "url(https://moaclayco-prod.s3.eu-north-1.amazonaws.com/background3.jpg)", backgroundPosition: "center left", backgroundRepeat: 'no-repeat'}} className="space-between fixed z-10 left-0 top-0 flex p-4 min-w-full h-20 text-gray-600 font-note text-3xl bg-white border-b-2 border-gray-600 md:p-2 md:text-5xl">
        <div className="flex-grow">Moa Clay Collection</div>
        <div
          onClick={e => {
            e.preventDefault()
            if (totalItems > 0) {
              history('/cart')
            }
          }}
          className="relative py-0 md:py-3"
        >
          {totalItems > 0 ? (
            <div className="absolute z-10 right-0 top-1 flex items-center justify-center w-5 h-5 text-gray-700 font-sans text-sm font-semibold bg-rosa rounded-full ring-1 ring-pink-200">
              {totalItems}
            </div>
          ) : null}
          <svg
            className="h-15 w-10 text-gray-600 fill-current"
            viewBox="0 0 490.057 490.057"
          >
            <g>
              <path
                d="M489.194,464l-36.4-293.4c-1-10.4-9.4-17.7-19.8-17.7h-23.9v-16.6c0-74.9-61.4-136.3-136.3-136.3c-12.6,0-24.6,1.7-35.9,5
		c-11.3-3.3-23.3-5-35.9-5c-74.9,0-136.3,61.4-136.3,136.3v16.6h-10.4c-9.4,0-18.7,7.3-19.8,17.7l-34.3,296.5
		c0,18,14.4,23.6,20.8,22.9c0,0,448.9,0,449.4,0C481.894,490.1,492.694,478.9,489.194,464z M367.394,136.3v16.6h-40.6v-16.6
		c0-36.3-11.2-67.9-30.3-91.6C337.194,55.3,367.394,92.5,367.394,136.3z M187.494,136.3c0-40.7,19.3-73,49.6-87
		c30.1,13.9,49.3,45.6,49.3,87v16.6h-98.8L187.494,136.3z M106.294,136.3c0-43.8,30.3-81,70.9-91.6c-19.1,23.7-30.3,55.3-30.3,91.6
		v16.6h-40.6V136.3z M43.894,449.4l30.2-255.9h342.3l30.2,255.9H43.894z"
              />
            </g>
          </svg>
        </div>
      </div>
    </Link>
  )
}

function Document({
  children,
  title,
}: {
  children: React.ReactNode
  title?: string
}) {
  let data = useLoaderData();
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
            __html: `window.ENV = ${JSON.stringify(
              data.ENV
            )}`
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
        <div className="fixed bottom-0 flex flex-grow px-4 w-full bg-gray-50">
          <div className="flew-grow flex items-center p-1 md:p-3">
            <a href="https://www.instagram.com/moaclayco/" target="_blank">
              <svg
                className="w-10 h-10 text-gray-500 hover:text-pink-600"
                aria-hidden="true"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  fillRule="evenodd"
                  d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z"
                  clipRule="evenodd"
                ></path>
              </svg>
            </a>
            <a
              href="https://twitter.com/moaclaycohl-Config"
              className="hover:text-blue-400 text-gray-500"
            >
              <svg
                className="w-10 h-10"
                aria-hidden="true"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84"></path>
              </svg>
            </a>
            <span className="p-2 invisible md:visible">
              All rights reserved © Moa Clay Co 2021
            </span>
          </div>
        </div>
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
