import {MetaFunction, LoaderFunction, ActionFunction, useTransition} from 'remix'
import {useLoaderData} from 'remix'

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import stripeClient from '~/stripeClient'
import {loadStripe, Stripe, StripeElementLocale, StripePaymentElement} from '@stripe/stripe-js'
import {Orders} from '~/schemas/orders'
import {useState} from 'react'
import {classNames} from '~/utils/classnames'

declare global {
  interface Window {
    ENV: any
  }
}

let stripePromise: Stripe | PromiseLike<Stripe | null> | null = null
if (typeof window !== 'undefined') {
  stripePromise = loadStripe(window ? window.ENV.STRIPE_PUBLIC_KEY : '')
}

type Order = {
  _id: string
  totalSum: number
  paymentIntent?: {
    id: string
    client_secret: string
  }
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
  setShow: (show: boolean) => void;
}

export default function Index() {
  let data = useLoaderData()
  let transition = useTransition();
  const [show, setShow] = useState(false)
  const locale: StripeElementLocale = "sv"
  const options = {
    clientSecret: data.clientSecret as string,
    locale,
  }

  const CheckoutForm = ({setShow}: Props) => {
    const stripe = useStripe()
    const elements = useElements()

    const handleSubmit = async (event: React.FormEvent) => {
      event.preventDefault()

      if (!stripe || !elements) {
        return
      }

      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${location.protocol}//${location.host}/order`,
        },
      })

      if (result.error) {
        // TODO: handle error
        console.log(result.error.message)
      }
    }

    return (
      <form onSubmit={handleSubmit}>
        <PaymentElement
          onReady={(e: StripePaymentElement) => {
            setShow(true)
          }}
        />
        <button
          disabled={!stripe}
          className="mt-2 p-2 text-white bg-blue-600 rounded"
        >
          Gå vidare till betalning
        </button>
      </form>
    )
  }

  return (
    <Elements stripe={stripePromise} options={options}>
      <>
      {show || transition.state === "loading" ? null:  <div className="fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
      <div
        className="
          bg-blue-300
          animate-ping
          rounded-full
          h-32
          w-32
          ring-blue-800
           ring-2 border-blue-500
        "
      ></div>
    </div> }
      <section
        className={
          classNames(
          show && transition.state !== "loading" ? 'mx-auto px-4 py-5 max-w-6xl sm:px-6 lg:px-4 visible' : 'hidden')
        }
      >
        <div className="grid gap-6 grid-cols-1 my-20 lg:grid-cols-2">
          <div className="flex flex-col w-full bg-gray-50 rounded-lg shadow-lg">
            <div className="p-2">
              <div className="mb-1 text-gray-700 text-xl">Betalning</div>
              <CheckoutForm setShow={setShow}/>
            </div>
          </div>
        </div>
      </section>
   
      </>
    </Elements>
  )
}
