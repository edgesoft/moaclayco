import mongoose from "mongoose";
import { ActionFunction } from "@remix-run/node";
import { Stripe } from "stripe";
import { Items } from "~/schemas/items";
import { Orders } from "~/schemas/orders";
import { OrderItem, Order } from "~/types";
import { Discounts } from "~/schemas/discounts";
import EmailOrderTemplate, { Template } from "~/components/mail/order";
import { renderToString } from "react-dom/server";
import { transporter } from "~/services/email-provider.server";

export const sendMail = async (order: Order, template: Template) => {
  try {
    let info = await transporter.sendMail({
      from: "support@moaclayco.com",
      to: order.customer.email,
      bcc: "moaclayco@gmail.com,wicket.programmer@gmail.com,support@moaclayco.com",
      subject: template === Template.ORDER ? `Order ${order._id} (moaclayco.com)` :  `Din order ${order._id} är nu påväg!`,
      html: renderToString(<EmailOrderTemplate order={order} template={template} />),
    });

    console.log("Message sent: %s", info.messageId);
  } catch (e) {
    console.log(e);
  }
};

const fromPaymentIntent = async (id: string, status: string) => {
  const order: Order | null = await Orders.findOne({
    "paymentIntent.id": id,
  }).lean();

  if (order) {
    await Orders.updateOne(
      { _id: order._id },
      { status, webhookAt: new Date() }
    );
    if (order.discount && order.discount.amount > 0) {
      await Discounts.updateOne(
        { code: order.discount.code },
        { $inc: { balance: -1 } }
      );
    }
    if (status === "SUCCESS") {
      order.items.map(async (i: OrderItem) => {
        await Items.updateOne(
          { _id: new mongoose.Types.ObjectId(i.itemRef) },
          { $inc: { amount: -i.quantity } }
        );
      });
      await sendMail(order, Template.ORDER);
    }
  } else {
    console.log("Could not find order");
  }
};

export let action: ActionFunction = async ({ request }) => {
  const sig = request.headers.get("Stripe-Signature");
  let body = await request.text();

  try {
    let event = JSON.parse(body);
    let paymentIntent = event.data.object as Stripe.PaymentIntent;
    switch (event.type) {
      case "payment_intent.succeeded":
        await fromPaymentIntent(paymentIntent.id, "SUCCESS");
        break;
      case "payment_intent.canceled":
        await fromPaymentIntent(paymentIntent.id, "CANCELED");
        break;
      case "payment_intent.payment_failed":
        await fromPaymentIntent(paymentIntent.id, "FAILED");
        break;
    }
  } catch (e) {}

  return new Response().ok;
};
