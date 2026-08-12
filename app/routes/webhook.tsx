import mongoose from "mongoose";
import type { ActionFunction } from "react-router";
import type { Stripe } from "stripe";
import { Items } from "~/schemas/items";
import { Orders } from "~/schemas/orders";
import type { Order } from "~/types";
import { Discounts } from "~/schemas/discounts";
import { Template } from "~/components/mail/order";
import stripeClient from "../stripeClient";
import { createVerification } from "~/services/verification.server";
import { WebhookEvents } from "~/schemas/webhook-events";
import { assertPaymentIntentMatchesOrder } from "~/services/checkout-payment.server";
import { sendOrderEmail } from "~/services/order-email.server";


const cents = (value: number) => Math.round(value * 100) / 100;

const makeAccountTransaction = async(
  paymentIntent: Stripe.PaymentIntent,
  order: Order
) => {
  if (!paymentIntent.latest_charge) {
    throw new Error(
      `PaymentIntent ${paymentIntent.id} has no retrievable latest charge`
    );
  }
  const charge =
    typeof paymentIntent.latest_charge === "string"
      ? await stripeClient.charges.retrieve(paymentIntent.latest_charge)
      : paymentIntent.latest_charge;
  if (!charge.balance_transaction) {
    throw new Error(
      `Charge ${charge.id} has no balance transaction for PaymentIntent ${paymentIntent.id}`
    );
  }
  const balanceTransaction =
    typeof charge.balance_transaction === "string"
      ? await stripeClient.balanceTransactions.retrieve(
          charge.balance_transaction
        )
      : charge.balance_transaction;

  const totalAmount = cents(balanceTransaction.amount / 100);
  const stripeFee = cents(balanceTransaction.fee / 100);
  const netAmount = cents(balanceTransaction.net / 100);
  const vatRate = 0.25;
  const vatAmount = cents((totalAmount * vatRate) / (1 + vatRate));
  const amountExVat = cents(totalAmount - vatAmount);

  await createVerification({
    domain: order.domain,
    idempotencyKey: `stripe:payment:${paymentIntent.id}`,
    verificationDate: new Date(charge.created * 1000),
    description: `Order id: ${order._id}\r\nPayment intent id: ${paymentIntent.id}`,
    metadata: [
      { key: "orderId", value: `${order._id}` },
      { key: "paymentIntentId", value: paymentIntent.id },
    ],
    journalEntries: [
      { account: 3001, credit: amountExVat },
      { account: 2611, credit: vatAmount },
      { account: 6570, debit: stripeFee },
      { account: 1580, debit: netAmount },
    ],
  });

  console.log(
    `Transaktion skapad för order ${order._id} på domain ${order.domain}`
  );
  console.log(`Stripe Fee: ${stripeFee} SEK`);
  console.log(`Netto-belopp att betalas ut: ${netAmount} SEK`);
};

const paymentIntentOrderQuery = (paymentIntentId: string) => ({
  $or: [
    { "paymentIntent.id": paymentIntentId },
    { paymentIntentAliases: paymentIntentId },
  ],
});

const resolveSucceededOrder = async (paymentIntent: Stripe.PaymentIntent) => {
  let order = (await Orders.findOne(
    paymentIntentOrderQuery(paymentIntent.id)
  ).lean()) as Order | null;
  if (order) {
    assertPaymentIntentMatchesOrder({ order, paymentIntent });
    return order;
  }

  const metadataOrderId = paymentIntent.metadata.orderId;
  const metadataDomain = paymentIntent.metadata.domain;
  if (
    !mongoose.Types.ObjectId.isValid(metadataOrderId) ||
    !metadataDomain
  ) {
    throw new Error(
      `PaymentIntent ${paymentIntent.id} cannot be linked to an order`
    );
  }

  order = (await Orders.findOne({
    _id: metadataOrderId,
    domain: metadataDomain,
  }).lean()) as Order | null;
  if (!order) {
    throw new Error(
      `Order ${metadataOrderId} from PaymentIntent ${paymentIntent.id} was not found`
    );
  }
  assertPaymentIntentMatchesOrder({ order, paymentIntent });

  if (order.paymentIntent?.id && order.paymentIntent.id !== paymentIntent.id) {
    const reviewOrder = (await Orders.findOneAndUpdate(
      { _id: order._id, domain: order.domain },
      {
        $addToSet: { paymentIntentAliases: paymentIntent.id },
        $set: {
          paidReviewReason: `Successful Stripe payment ${paymentIntent.id} differs from the order PaymentIntent`,
          status: "PAID_REVIEW",
          webhookAt: new Date(),
        },
      },
      { new: true }
    ).lean()) as Order | null;
    if (!reviewOrder) {
      throw new Error(
        `Order ${metadataOrderId} could not be flagged for payment review`
      );
    }
    return reviewOrder;
  }

  const paymentIntentUpdate: Record<string, string> = {
    "paymentIntent.id": paymentIntent.id,
  };
  if (typeof paymentIntent.client_secret === "string") {
    paymentIntentUpdate["paymentIntent.client_secret"] =
      paymentIntent.client_secret;
  }
  const attachedOrder = (await Orders.findOneAndUpdate(
    {
      _id: order._id,
      domain: order.domain,
      $or: [
        { "paymentIntent.id": { $exists: false } },
        { "paymentIntent.id": paymentIntent.id },
      ],
    },
    { $set: paymentIntentUpdate },
    { new: true }
  ).lean()) as Order | null;
  if (!attachedOrder) {
    throw new Error(
      `PaymentIntent ${paymentIntent.id} could not be attached to order ${metadataOrderId}`
    );
  }
  return attachedOrder;
};

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
          const order: Order | null = await Orders.findOne(
            paymentIntentOrderQuery(String(paymentIntentId))
          ).lean();

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
    await sendOrderEmail(transitionedOrder, Template.ORDER);
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
        const order = await resolveSucceededOrder(paymentIntent);
        await makeAccountTransaction(paymentIntent, order);
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
