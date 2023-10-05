import {useEffect} from 'react'
import {useNavigate} from 'react-router-dom'
import {useCart} from 'react-use-cart'
import {
  createCookie,
  LoaderFunction,
  MetaFunction,
  redirect
} from "@remix-run/node"
import {
    useLoaderData
  } from "@remix-run/react"
  
import {Orders} from '~/schemas/orders'

export let loader: LoaderFunction = async ({request}) => {
  let url = new URL(await request.url)
  let body = new URLSearchParams(url.search)
  const paymentIntent = body.get('payment_intent')
  let cookie = createCookie('order', {
    expires: new Date(),
  })

  const order = await Orders.findOne({'paymentIntent.id': paymentIntent})

  if (!order) {
    return redirect('/')
  }

  const serialize = {
    ...order.toObject(),
    redirect_status: body.get('redirect_status'),
  }

  return new Response(JSON.stringify(serialize), {
    status: 200,
    headers: {
      'Set-Cookie': await cookie.serialize(null),
    },
  })
}

export let meta: MetaFunction = () => {
  return [{
    title: 'Moa Clay Collection'
  },
  {
    name: "description",
    content: 'Moa Clay Collection'
  }
]
}

export default function Index() {
  let d = useLoaderData()
  let data = null
  let navigation = useNavigate()
  try {
    data = JSON.parse(d)
  } catch (e) {}

  const {emptyCart} = useCart()
  useEffect(() => {
    emptyCart()
  }, [])

  return (
    <div className="ml-4 mr-2 mt-20">
      <div className="py-4">
        {data.redirect_status === 'succeeded' ? (
          <>
            <p className="text-gray-700 text-2xl font-bold">
              Tack för ditt köp!
            </p>
            <p className="py-2">
              Ditt ordernummer är{' '}
              <span className="font-semibold">{data._id}</span>
            </p>

            <p className="pt-4 text-base">
              Vi kommer att skicka ordern så fort som möjligt. Om du har frågor
              om din order så är du välkommen att skicka frågor till &nbsp;
              <span className="text-blue-600">support@moaclayco.com</span>. Ange
              ordernummer i din ämnesrad.
            </p>
          </>
        ) : (
          <>
            <p className="text-gray-700 text-2xl font-bold">
              Ditt köp gick inte igenom
            </p>
            <p className="py-2">
              Du har avbrytit ditt köp eller så har betalningen inte gått igenom
            </p>
          </>
        )}
        <button
          onClick={() => {
            navigation('/')
          }}
          className="mt-2 p-2 text-gray-700 font-semibold bg-rosa rounded"
        >
          Se kollektioner
        </button>
      </div>
    </div>
  )
}