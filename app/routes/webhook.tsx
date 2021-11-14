import mongoose from 'mongoose'
import { ActionFunction, LoaderFunction } from 'remix'
import { Stripe } from 'stripe'
import { Items } from '~/schemas/items'
import { Orders } from '~/schemas/orders'
import { OrderItem, Order} from '~/types'
import nodemailer from 'nodemailer'
import { Discounts } from '~/schemas/discounts'


const sendMail = async (order: Order) => {
  let transporter = nodemailer.createTransport({
    host: 'send.one.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD,
    },
  })

  let info = await transporter.sendMail({
    from: 'support@moaclayco.com',
    to: order.customer.email,
    bcc: "moaclayco@gmail.com,wicket.programmer@gmail.com,support@moaclayco.com",
    subject: `Order ${order._id} (moaclayco.com)`,
    text: `Hej ${order.customer.firstname} ${order.customer.lastname}!\nTack för din order (${order._id})\n\nVi kommer att behandla ordern så snart vi kan.\n\nMed vänliga hälsningar Moa Clay Collection`,
  })

  console.log('Message sent: %s', info.messageId)
}



const fromPaymentIntent = async (id: string, status: string) => {

  const order: Order = await Orders.findOne({
    'paymentIntent.id': id,
  })

  if (order) {
    await Orders.updateOne({_id: order._id}, {status, webhookAt: new Date()})
    if (order.discount && order.discount.amount > 0) {
      await Discounts.updateOne({code: order.discount.code}, {used: true, usedAt: new Date()})
    }
    if (status === 'SUCCESS') {
      order.items.map(async (i: OrderItem) => {
        await Items.updateOne(
          {_id: new mongoose.Types.ObjectId(i.itemRef)},
          {$inc: {amount: -i.quantity}},
        )
      })
      await sendMail(order)
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
