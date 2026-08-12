import mongoose from "mongoose";
import { ActionFunction } from "@remix-run/node";
import { Stripe } from "stripe";
import { Items } from "~/schemas/items";
import { Orders } from "~/schemas/orders";
import { Order } from "~/types";
import { Discounts } from "~/schemas/discounts";
import EmailOrderTemplate, {
  getOrderEmailSubject,
  getOrderEmailText,
  Template,
} from "~/components/mail/order";
import { renderToStaticMarkup } from "react-dom/server";
import { transporter } from "~/services/email-provider.server";
import stripeClient from "../stripeClient";
import { createVerification } from "~/services/verification.server";
import { themes } from "~/components/Theme";
import { WebhookEvents } from "~/schemas/webhook-events";

export const sendMail = async (order: Order, template: Template) => {
  const theme = themes[order.domain] ?? themes.moaclayco;

  try {
    const markup = renderToStaticMarkup(
      <EmailOrderTemplate order={order} template={template} />
    );
    let info = await transporter.sendMail({
      from: theme.email,
      to: order.customer.email,
      bcc: `${theme.email},wicket.programmer@gmail.com`,
      subject: getOrderEmailSubject(order, template),
      text: getOrderEmailText(order, template),
      html: `<!doctype html>${markup}`,
    });

    console.log("Message sent: %s", info.messageId);
  } catch (e) {
    console.log(e);
  }
};


const cents = (value: number) => Math.round(value * 100) / 100;

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
        const totalAmount = cents(balanceTransaction.amount / 100); // Bruttobelopp (inklusive moms) i SEK
        const stripeFee = cents(balanceTransaction.fee / 100); // Stripe-avgiften i SEK
        const netAmount = cents(balanceTransaction.net / 100); // Nettobelopp att betalas ut i SEK

        // Beräkna momsbelopp baserat på bruttobeloppet
        const vatRate = 0.25; // 25% moms
        const vatAmount = cents((totalAmount * vatRate) / (1 + vatRate)); // Momsbelopp
        const amountExVat = cents(totalAmount - vatAmount); // Belopp exklusive moms

        // Skapa bokföringspost
        await createVerification({
          domain: order.domain,
          idempotencyKey: `stripe:payment:${paymentIntent.id}`,
          verificationDate: new Date(charge.created * 1000),
          description: `Order id: ${order._id}\r\nPayment intent id: ${paymentIntent.id}`,
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
              credit: amountExVat, // Belopp exklusive moms
            },
            {
              account: 2611, // Moms
              credit: vatAmount, // Momsbelopp
            },
            {
              account: 6570, // Stripe-avgifter
              debit: stripeFee, // Stripe-avgift
            },
            {
              account: 1580, // Fordran på Stripe
              debit: netAmount, // Nettobelopp efter avgift
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
  let description = `Stripe Payout(${payoutId})`

  console.log(`Payout ID: ${payoutId}`);
  console.log(`Payout amount: ${amountInSek} SEK`);
  const domains = new Set<string>();

  // Hämta alla balance transactions som är kopplade till denna utbetalning
  const balanceTransactions = await stripeClient.balanceTransactions
    .list({ payout: payoutId, limit: 100 })
    .autoPagingToArray({ limit: 10_000 });

  let metadata = []
  let index = 0; // Startar index på 0
  for (const balanceTransaction of balanceTransactions) {
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
            domains.add(order.domain)
            metadata.push({key: `orderId.${index}`, value: `${order._id}`})
            metadata.push({key: `paymentIntentId.${index}`, value: `${paymentIntentId}`})
            index = index + 1
          } else {
            console.warn(`Order not found for PaymentIntent: ${paymentIntentId}`);
          }
        }
      } catch (error) {
        console.error(
          "Error retrieving PaymentIntent or order for balance transaction:",
          error
        );
      }
    }
  }

  if (domains.size !== 1) {
    throw new Error(
      domains.size === 0
        ? "Could not determine payout domain"
        : "A Stripe payout contains orders from multiple domains"
    );
  }
  const [domain] = domains;

  // Sätt ihop beskrivningen från alla delar
  // Skapa bokföringspost
  await createVerification({
    domain: domain,
    idempotencyKey: `stripe:payout:${payoutId}`,
    verificationDate: new Date((payout.arrival_date || payout.created) * 1000),
    description: description.trim(), // Rensa onödiga tomma rader
    journalEntries: [
      {
        account: 1930, // Bankkonto
        debit: cents(amountInSek),
      },
      {
        account: 1580, // Fordran på Stripe
        credit: cents(amountInSek),
      }
    ],
    metadata: [{ key: "payoutId", value: payoutId }, ...metadata]
  });

  console.log(`Bokföringspost skapad för utbetalning: ${payoutId}`);
};


class PaidOrderNeedsReviewError extends Error {}

const fromPaymentIntent = async (id: string, status: string) => {
  if (status !== "SUCCESS") {
    await Orders.updateOne(
      {
        "paymentIntent.id": id,
        status: { $nin: ["SUCCESS", "SHIPPED", "PAID_REVIEW"] },
      },
      { $set: { status, webhookAt: new Date() } }
    );
    return;
  }

  const session = await mongoose.startSession();
  let transitionedOrder: Order | null = null;
  try {
    await session.withTransaction(async () => {
      transitionedOrder = await Orders.findOneAndUpdate(
        {
          "paymentIntent.id": id,
          status: { $nin: ["SUCCESS", "SHIPPED", "PAID_REVIEW"] },
        },
        { $set: { status: "SUCCESS", webhookAt: new Date() } },
        { new: true, session }
      ).lean();

      if (!transitionedOrder) return;

      for (const item of transitionedOrder.items) {
        const result = await Items.updateOne(
          {
            _id: new mongoose.Types.ObjectId(item.itemRef),
            domain: transitionedOrder.domain,
            amount: { $gte: item.quantity },
          },
          { $inc: { amount: -item.quantity } },
          { session }
        );
        if (result.modifiedCount !== 1) {
          throw new PaidOrderNeedsReviewError("Insufficient stock for paid order");
        }
      }

      if (
        transitionedOrder.discount?.amount > 0 &&
        transitionedOrder.discount.code
      ) {
        const result = await Discounts.updateOne(
          {
            domain: transitionedOrder.domain,
            code: transitionedOrder.discount.code,
            balance: { $gt: 0 },
          },
          { $inc: { balance: -1 } },
          { session }
        );
        if (result.modifiedCount !== 1) {
          throw new PaidOrderNeedsReviewError(
            "Discount balance was exhausted before payment completed"
          );
        }
      }
    });
  } catch (error) {
    if (!(error instanceof PaidOrderNeedsReviewError)) throw error;
    transitionedOrder = await Orders.findOneAndUpdate(
      {
        "paymentIntent.id": id,
        status: { $nin: ["SUCCESS", "SHIPPED", "PAID_REVIEW"] },
      },
      { $set: { status: "PAID_REVIEW", webhookAt: new Date() } },
      { new: true }
    ).lean();
  } finally {
    await session.endSession();
  }

  if (transitionedOrder) {
    await sendMail(transitionedOrder, Template.ORDER);
  }
};

const isDuplicateKeyError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
  );

const claimStripeEvent = async (event: Stripe.Event) => {
  try {
    await WebhookEvents.create({
      provider: "stripe",
      eventId: event.id,
      eventType: event.type,
      status: "processing",
    });
    return true;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  const claimed = await WebhookEvents.findOneAndUpdate(
    {
      provider: "stripe",
      eventId: event.id,
      $or: [
        { status: "failed" },
        { status: "processing", updatedAt: { $lt: staleBefore } },
      ],
    },
    {
      $set: {
        status: "processing",
        eventType: event.type,
        lastError: null,
        updatedAt: new Date(),
      },
    }
  );
  return Boolean(claimed);
};

export let action: ActionFunction = async ({ request }) => {
  const sig = request.headers.get("Stripe-Signature");
  const body = await request.text();
  const webhookSecret = process.env.STRIPE_WEBHOOK;

  if (!sig || !webhookSecret) {
    return new Response("Stripe webhook is not configured", { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripeClient.webhooks.constructEvent(body, sig, webhookSecret);
  } catch {
    return new Response("Invalid Stripe signature", { status: 400 });
  }

  const claimed = await claimStripeEvent(event);
  if (!claimed) return new Response("Already processed", { status: 200 });

  try {
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
    await WebhookEvents.updateOne(
      { provider: "stripe", eventId: event.id },
      { $set: { status: "completed", lastError: null } }
    );
    return new Response("OK", { status: 200 });
  } catch (error) {
    await WebhookEvents.updateOne(
      { provider: "stripe", eventId: event.id },
      {
        $set: {
          status: "failed",
          lastError: error instanceof Error ? error.message : "Unknown error",
        },
      }
    );
    console.error("Stripe webhook processing failed", {
      eventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response("Webhook processing failed", { status: 500 });
  }
};
