import type {MetaFunction,  LoaderFunction, ActionFunction} from 'remix'
import {useLoaderData} from 'remix'

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import stripeClient from '~/stripeClient'
import {loadStripe, Stripe} from '@stripe/stripe-js'
import {Orders} from '~/schemas/orders'


declare global {
  interface Window {
      ENV:any;
  }
}

let stripePromise: Stripe | PromiseLike<Stripe | null> | null = null;
if (typeof window !== "undefined") {
  stripePromise = loadStripe(window ? window.ENV.STRIPE_PUBLIC_KEY : "");
}


type Order = {
  _id: string
  totalSum: number
}

export let loader: LoaderFunction = async ({request}) => {
  let url = new URL(await request.url);
  let body = new URLSearchParams(url.search)
  const order: Order = await Orders.findOne({_id: body.get("order")})

  const paymentIntent = await stripeClient.paymentIntents.create({
    amount: order.totalSum * 100,
    currency: 'sek',
    payment_method_types: ['klarna', 'card'],
  })

  await Orders.updateOne({_id: order._id }, {paymentIntent: {
    id: paymentIntent.id,
    client_secret: paymentIntent.client_secret
  }})

  return {clientSecret: paymentIntent.client_secret}
}


export let meta: MetaFunction = () => {
  return {
    title: 'Moa Clay Collection',
    description: 'Moa Clay Collection',
  }
}

export default function Index() {

  let data = useLoaderData()
  const options = {
    clientSecret: data.clientSecret,
    locale: 'sv',
  }




  const CheckoutForm = () => {
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
        console.log(result.error.message)
      }
    }

    return (
      <form onSubmit={handleSubmit}>
        <PaymentElement />
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
      <section className="mx-auto px-4 py-5 max-w-6xl sm:px-6 lg:px-4">
        <div className="grid gap-6 grid-cols-1 my-20 lg:grid-cols-2">
          <div className="flex flex-col w-full bg-gray-50 rounded-lg shadow-lg">
            <div className="p-2">
              <div className="mb-1 text-gray-700 text-xl">Betalning</div>
              <CheckoutForm />
            </div>
          </div>
        </div>
      </section>
    </Elements>
  )
}
