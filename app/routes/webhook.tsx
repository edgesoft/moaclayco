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
import stripeClient from "../stripeClient";
import { Verifications } from "~/schemas/verifications";
import { generateNextEntryNumber } from "~/utils/verificationUtil";
import { themes } from "~/components/Theme";

export const sendMail = async (order: Order, template: Template) => {

  const theme = themes[order.domain]

  try {
    let info = await transporter.sendMail({
      from: theme.email,
      to: order.customer.email,
      bcc: `${theme.email},wicket.programmer@gmail.com`,
      subject: template === Template.ORDER ? `Order ${order._id} (${theme.title})` :  `Din order ${order._id} är nu påväg!`,
      html: renderToString(<EmailOrderTemplate order={order} template={template} />),
    });

    console.log("Message sent: %s", info.messageId);
  } catch (e) {
    console.log(e);
  }
};


const makeAccountTransaction = async(paymentIntent: Stripe.PaymentIntent) => {

  const order: Order | null = await Orders.findOne({
    "paymentIntent.id": paymentIntent.id,
  }).lean();
  if (order) {
    if (typeof paymentIntent.latest_charge === 'string') {
      const chargeId = paymentIntent.latest_charge;
      const charge = await stripeClient.charges.retrieve(chargeId);

      if (typeof charge.balance_transaction === 'string') {
        const balanceTransaction = await stripeClient.balanceTransactions.retrieve(charge.balance_transaction);

        // Totalbelopp i SEK
        const totalAmount = balanceTransaction.amount / 100; // Bruttobelopp (inklusive moms) i SEK
        const stripeFee = balanceTransaction.fee / 100; // Stripe-avgiften i SEK
        const netAmount = balanceTransaction.net / 100; // Nettobelopp att betalas ut i SEK

        // Beräkna momsbelopp baserat på bruttobeloppet
        const vatRate = 0.25; // 25% moms
        const vatAmount = (totalAmount * vatRate) / (1 + vatRate); // Momsbelopp
        const amountExVat = totalAmount - vatAmount; // Belopp exklusive moms

        // Skapa bokföringspost
        await Verifications.create({
          domain: order.domain,
          verificationDate: new Date(),
          description: `Order id: ${order._id}\r\nPayment intent id: ${paymentIntent.id}`,
          verificationNumber: await generateNextEntryNumber(order.domain),
          metadata: [
            {
              key: "orderId",
              value: `${order._id}`
            },
            {
              key: "paymentIntentId",
              value: `${paymentIntent.id}`
            },
          ],
          journalEntries: [
            {
              account: 3001, // Försäljning exkl. moms
              credit: amountExVat.toFixed(2), // Belopp exklusive moms
            },
            {
              account: 2611, // Moms
              credit: vatAmount.toFixed(2), // Momsbelopp
            },
            {
              account: 6570, // Stripe-avgifter
              debit: stripeFee.toFixed(2), // Stripe-avgift
            },
            {
              account: 1580, // Fordran på Stripe
              debit: netAmount.toFixed(2), // Nettobelopp efter avgift
            }
          ]
        });

        console.log(`Transaktion skapad för order ${order._id} på domain ${order.domain}`);
        console.log(`Stripe Fee: ${stripeFee} SEK`);
        console.log(`Netto-belopp att betalas ut: ${netAmount} SEK`);
      }
    }
  } else {
    console.log("Could not find order");
  }
 
}
const handlePayoutPaid = async (payout: Stripe.Payout) => {
  const payoutId = payout.id;
  const amountInSek = payout.amount / 100;
  let descriptionParts: string[] = [`Payout id: ${payoutId}\r\n\r\n`]; // Samla delarna av beskrivningen i en lista

  console.log(`Payout ID: ${payoutId}`);
  console.log(`Payout amount: ${amountInSek} SEK`);
  let domain = null

  // Hämta alla balance transactions som är kopplade till denna utbetalning
  const balanceTransactions = await stripeClient.balanceTransactions.list({
    payout: payoutId,
  });

  for (const balanceTransaction of balanceTransactions.data) {
    if (balanceTransaction.source) {
      try {
        // Hämta PaymentIntent kopplad till denna balance transaction
        const charge = await stripeClient.charges.retrieve(balanceTransaction.source as string);

        if (charge.payment_intent) {
          const paymentIntentId = charge.payment_intent;

          // Hämta order kopplad till PaymentIntent
          const order: Order | null = await Orders.findOne({
            "paymentIntent.id": paymentIntentId,
          }).lean();

          if (order) {
            // Lägg till i beskrivningen
            domain = order.domain
            descriptionParts.push(`Order id: ${order._id}\r\nPayment intent id: ${paymentIntentId}`);
          } else {
            console.warn(`Order not found for PaymentIntent: ${paymentIntentId}`);
          }
        }
      } catch (error) {
        console.error(`Error retrieving PaymentIntent or order for balance transaction: ${error.message}`);
      }
    }
  }

  if (!domain) throw new  Error("Could not find domain")

  // Sätt ihop beskrivningen från alla delar
  const description = descriptionParts.join('\r\n');
  // Skapa bokföringspost
  await Verifications.create({
    domain: domain,
    verificationDate: new Date(),
    description: description.trim(), // Rensa onödiga tomma rader
    verificationNumber: await generateNextEntryNumber(domain),
    journalEntries: [
      {
        account: 1930, // Bankkonto. Behöver inte vara 1930 om det är sgwoods
        debit: amountInSek.toFixed(2),
      },
      {
        account: 1580, // Fordran på Stripe
        credit: amountInSek.toFixed(2),
      }
    ]
  });

  console.log(`Bokföringspost skapad för utbetalning: ${payoutId}`);
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
    console.log(event)

    switch (event.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await makeAccountTransaction(paymentIntent)
        await fromPaymentIntent(paymentIntent.id, "SUCCESS");
        break;
      case "payment_intent.canceled":
        const paymentIntenCanceled = event.data.object as Stripe.PaymentIntent;
        await fromPaymentIntent(paymentIntenCanceled.id, "CANCELED");
        break;
      case "payment_intent.payment_failed":
        const paymentIntentFailed = event.data.object as Stripe.PaymentIntent;
        await fromPaymentIntent(paymentIntentFailed.id, "FAILED");
        break;
      case "payout.paid":
          const payout = event.data.object as Stripe.Payout;
          await handlePayoutPaid(payout);
          break;
    }
  } catch (e) {}

  return new Response().ok;
};
