import {
  MetaFunction,
  LoaderFunction,
  ActionFunction,
  useTransition,
} from 'remix'
import {useLoaderData} from 'remix'

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import stripeClient from '~/stripeClient'
import {
  loadStripe,
  Stripe,
  StripeElementLocale,
  StripePaymentElement,
} from '@stripe/stripe-js'
import {Orders} from '~/schemas/orders'
import {useEffect, useRef, useState} from 'react'
import {classNames} from '~/utils/classnames'
import Loader from '~/components/loader'
import Terms from '~/components/terms'
import { Order } from '~/types'

declare global {
  interface Window {
    ENV: any
  }
}

let stripePromise: Stripe | PromiseLike<Stripe | null> | null = null
if (typeof window !== 'undefined') {
  stripePromise = loadStripe(window ? window.ENV.STRIPE_PUBLIC_KEY : '')
}



export let loader: LoaderFunction = async ({request}) => {
  let url = new URL(await request.url)
  let body = new URLSearchParams(url.search)
  const order: Order = await Orders.findOne({_id: body.get('order')})

  if (order && order.paymentIntent?.id) {
    const paymentIntent = await stripeClient.paymentIntents.update(
      order.paymentIntent.id,
      {
        amount: order.totalSum * 100,
        currency: 'sek',
        payment_method_types: ['klarna', 'card'],
      },
    )
    return {clientSecret: paymentIntent.client_secret}
  }

  const paymentIntent = await stripeClient.paymentIntents.create({
    amount: order.totalSum * 100,
    currency: 'sek',
    payment_method_types: ['klarna', 'card'],
  })

  await Orders.updateOne(
    {_id: order._id},
    {
      paymentIntent: {
        id: paymentIntent.id,
        client_secret: paymentIntent.client_secret,
      },
    },
  )

  return {clientSecret: paymentIntent.client_secret}
}

export let meta: MetaFunction = () => {
  return {
    title: 'Moa Clay Collection',
    description: 'Moa Clay Collection',
  }
}

interface Props {
  setShow: (show: boolean) => void
}

export default function Index() {
  let data = useLoaderData()
  let transition = useTransition()
  const [show, setShow] = useState(false)
  const locale: StripeElementLocale = 'sv'

  const options = {
    clientSecret: data.clientSecret as string,
    locale,
  }

  const CheckoutForm = ({setShow}: Props) => {
    const stripe = useStripe()
    const elements = useElements()
    const termsRef: React.RefObject<HTMLInputElement> = useRef(null)
    const [error, showError] = useState<string | undefined>(undefined)
    const [showTerm, setShowTerm] = useState<boolean>(false)

    useEffect(() => {
      if (error) {
        setTimeout(() => {
          showError(undefined)
        }, 2000)
      }
    }, [error])

    const handleSubmit = async (event: React.FormEvent) => {
      event.preventDefault()

      if (!stripe || !elements) {
        return
      }
      const agreeTerms = termsRef.current && termsRef.current.checked
      if (agreeTerms) {
        const result = await stripe.confirmPayment({
          elements,
          confirmParams: {
            return_url: `${location.protocol}//${location.host}/order`,
          },
        })

        if (result.error) {
          showError(result.error.message)
        }
      } else {
        showError('Du måste godkänna villkoren')
      }
    }

    return (
      <form onSubmit={handleSubmit}>
        {showTerm ? <Terms show={setShowTerm}/> : null}
        <PaymentElement
          onReady={(e: StripePaymentElement) => {
            setShow(true)
          }}
        />
        <div className="flex mt-3">
          <input
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            ref={termsRef}
            type="checkbox"
          />{' '}
          <span className="-mt-2 px-1 py-1 underline" onClick={() => {
            setShowTerm(true)
          }}>
            Jag godkänner villkoren
          </span>
        </div>
        <button
          disabled={!stripe}
          className="mt-2 p-2 text-gray-700 font-medium bg-rosa rounded"
        >
          Gå vidare till betalning
        </button>
        {error ? (
          <div className="fixed z-10 bottom-2 left-0 w-screen opacity-95">
            <div className="relative flex m-1 px-4 py-2 text-red-900 bg-red-100 border-t-4 border-red-500 rounded-b shadow-md">
              <div className="py-1">
                <svg
                  className="mr-4 w-6 h-6 text-red-500 fill-current"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                >
                  <path d="M2.93 17.07A10 10 0 1 1 17.07 2.93 10 10 0 0 1 2.93 17.07zm12.73-1.41A8 8 0 1 0 4.34 4.34a8 8 0 0 0 11.32 11.32zM9 11V9h2v6H9v-4zm0-6h2v2H9V5z" />
                </svg>
              </div>
              <div>
                <p className="font-bold">Fel i formulär</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          </div>
        ) : null}
      </form>
    )
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      <>
     
        {!show || transition.state === 'loading' ? <Loader /> : null}
        <section
          className={classNames(
            show && transition.state !== 'loading'
              ? 'mx-auto px-4 py-5 max-w-6xl sm:px-6 lg:px-4 visible'
              : 'hidden',
          )}
        >
          <div className="grid gap-6 grid-cols-1 my-20 lg:grid-cols-2">
            <div className="flex flex-col w-full bg-gray-50 rounded-lg shadow-lg">
              <div className="p-2">
                <div className="mb-1 text-gray-700 text-xl">Betalning</div>
                <CheckoutForm setShow={setShow} />
              </div>
            </div>
          </div>
        </section>
      </>
    </Elements>
  )
}
