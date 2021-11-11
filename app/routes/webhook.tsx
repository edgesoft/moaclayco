import {ActionFunction, LoaderFunction} from 'remix'
import {Stripe} from 'stripe'
import {Orders} from '~/schemas/orders'
import {Items} from '~/schemas/items'
import {OrderItem} from '~/types'
import mongoose from 'mongoose'

const fromPaymentIntent = async (id: string, status: string) => {
  const order = await Orders.findOne({
    'paymentIntent.id': id,
  })
  if (order) {
    await Orders.updateOne({_id: order._id}, {status, webhookAt: new Date()})
    if (status === 'SUCCESS') {
      order.items.map(async (i: OrderItem) => {
        await Items.updateOne(
          {_id: new mongoose.Types.ObjectId(i.itemRef)},
          {$inc: {amount: -i.quantity}},
        )
      })
    }
  }
}

export let loader: LoaderFunction = async ({request}) => {
  const sig = request.headers.get('Stripe-Signature')
  let body = await request.text()
  try {
    let event = JSON.parse(body)
    let paymentIntent = event.data.object as Stripe.PaymentIntent
    switch (event.type) {
      case 'payment_intent.succeeded':
        await fromPaymentIntent(paymentIntent.id, 'SUCCESS')
        break
      case 'payment_intent.canceled':
        await fromPaymentIntent(paymentIntent.id, 'CANCELED')
        break
      case 'payment_intent.payment_failed':
        await fromPaymentIntent(paymentIntent.id, 'FAILED')
        break
    }
  } catch (e) {}

  return new Response().ok
}

export let action: ActionFunction = async () => {
  return new Response().ok
}

export default function Index() {
  return null
}
