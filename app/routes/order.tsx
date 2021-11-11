import { useEffect } from 'react'
import { useCart } from 'react-use-cart'
import { createCookie, LoaderFunction, MetaFunction, redirect, useLoaderData } from 'remix'
import { Orders } from '~/schemas/orders'

export let loader: LoaderFunction = async ({request}) => {
  let url = new URL(await request.url)
  let body = new URLSearchParams(url.search)
  const paymentIntent = body.get('payment_intent')
  let cookie = createCookie('order', {
    expires: new Date(),
  })

  const order = await Orders.findOne({'paymentIntent.id': paymentIntent})

  if (!order) {
    return redirect("/")
  }

  return new Response(JSON.stringify(order), {
    status: 200,
    headers: {
      'Set-Cookie': await cookie.serialize(null),
    },
  })
}

export let meta: MetaFunction = () => {
  return {
    title: 'Moa Clay Collection',
    description: 'Moa Clay Collection',
  }
}

export default function Index() {
  let data = useLoaderData()
  console.log(data)
  const {emptyCart} = useCart()
  useEffect(() => {
    emptyCart()
  }, [])

  return <div className="ml-2 mr-2 mt-20">Tack för ditt köp!</div>
}
