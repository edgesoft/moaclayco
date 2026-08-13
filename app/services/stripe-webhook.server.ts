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
import {
  readTextWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";
import {
  getActiveStripeWebhookApiVersion,
  getRequestedStripeWebhookApiVersion,
  getStripeWebhookSecret,
} from "~/services/stripe-config.server";

const MAX_STRIPE_WEBHOOK_SIZE = 1024 * 1024;

export type StripeWebhookDependencies = {
  createVerification: typeof createVerification;
  discounts: typeof Discounts;
  items: typeof Items;
  now: () => Date;
  orders: typeof Orders;
  sendOrderEmail: typeof sendOrderEmail;
  startSession: typeof mongoose.startSession;
  stripe: typeof stripeClient;
  webhookEvents: typeof WebhookEvents;
};

const defaultDependencies: StripeWebhookDependencies = {
  createVerification,
  discounts: Discounts,
  items: Items,
  now: () => new Date(),
  orders: Orders,
  sendOrderEmail,
  startSession: () => mongoose.startSession(),
  stripe: stripeClient,
  webhookEvents: WebhookEvents,
};

const cents = (value: number) => Math.round(value * 100) / 100;

export const makeAccountTransaction = async(
  paymentIntent: Stripe.PaymentIntent,
  order: Order,
  dependencies: StripeWebhookDependencies = defaultDependencies
) => {
  if (!paymentIntent.latest_charge) {
    throw new Error(
      `PaymentIntent ${paymentIntent.id} has no retrievable latest charge`
    );
  }
  const charge =
    typeof paymentIntent.latest_charge === "string"
      ? await dependencies.stripe.charges.retrieve(paymentIntent.latest_charge)
      : paymentIntent.latest_charge;
  if (!charge.balance_transaction) {
    throw new Error(
      `Charge ${charge.id} has no balance transaction for PaymentIntent ${paymentIntent.id}`
    );
  }
  const balanceTransaction =
    typeof charge.balance_transaction === "string"
      ? await dependencies.stripe.balanceTransactions.retrieve(
          charge.balance_transaction
        )
      : charge.balance_transaction;

  const totalAmount = cents(balanceTransaction.amount / 100);
  const stripeFee = cents(balanceTransaction.fee / 100);
  const netAmount = cents(balanceTransaction.net / 100);
  const vatRate = 0.25;
  const vatAmount = cents((totalAmount * vatRate) / (1 + vatRate));
  const amountExVat = cents(totalAmount - vatAmount);

  await dependencies.createVerification({
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

export const resolveSucceededOrder = async (
  paymentIntent: Stripe.PaymentIntent,
  dependencies: StripeWebhookDependencies = defaultDependencies
) => {
  let order = (await dependencies.orders.findOne(
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

  order = (await dependencies.orders.findOne({
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
    const reviewOrder = (await dependencies.orders.findOneAndUpdate(
      { _id: order._id, domain: order.domain },
      {
        $addToSet: { paymentIntentAliases: paymentIntent.id },
        $set: {
          paidReviewReason: `Successful Stripe payment ${paymentIntent.id} differs from the order PaymentIntent`,
          status: "PAID_REVIEW",
          webhookAt: dependencies.now(),
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
  const attachedOrder = (await dependencies.orders.findOneAndUpdate(
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

export const handlePayoutPaid = async (
  payout: Stripe.Payout,
  dependencies: StripeWebhookDependencies = defaultDependencies
) => {
  const payoutId = payout.id;
  const amountInSek = payout.amount / 100;
  const description = `Stripe Payout(${payoutId})`;

  console.log(`Payout ID: ${payoutId}`);
  console.log(`Payout amount: ${amountInSek} SEK`);
  const domains = new Set<string>();
  const metadata: Array<{ key: string; value: string }> = [];

  if (payout.automatic === false) {
    const manualPayoutDomain = payout.metadata?.domain?.trim();
    if (!manualPayoutDomain) {
      throw new Error("Manual Stripe payout is missing domain metadata");
    }
    domains.add(manualPayoutDomain);
  } else {
    // Stripe only supports filtering balance transactions by automatic payouts.
    const balanceTransactions = await dependencies.stripe.balanceTransactions
      .list({ payout: payoutId, limit: 100 })
      .autoPagingToArray({ limit: 10_000 });

    let index = 0;
    for (const balanceTransaction of balanceTransactions) {
      if (!balanceTransaction.source) continue;

      try {
        const charge = await dependencies.stripe.charges.retrieve(
          String(balanceTransaction.source)
        );
        if (!charge.payment_intent) continue;

        const paymentIntentId = String(charge.payment_intent);
        const order = await dependencies.orders
          .findOne(paymentIntentOrderQuery(paymentIntentId))
          .lean<Order>();

        if (!order) {
          console.warn(`Order not found for PaymentIntent: ${paymentIntentId}`);
          continue;
        }

        domains.add(order.domain);
        metadata.push({ key: `orderId.${index}`, value: `${order._id}` });
        metadata.push({
          key: `paymentIntentId.${index}`,
          value: paymentIntentId,
        });
        index += 1;
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
  await dependencies.createVerification({
    domain,
    idempotencyKey: `stripe:payout:${payoutId}`,
    verificationDate: new Date((payout.arrival_date || payout.created) * 1000),
    description,
    journalEntries: [
      {
        account: 1930, // Bankkonto
        debit: cents(amountInSek),
      },
      {
        account: 1580, // Fordran på Stripe
        credit: cents(amountInSek),
      },
    ],
    metadata: [{ key: "payoutId", value: payoutId }, ...metadata],
  });

  console.log(`Bokföringspost skapad för utbetalning: ${payoutId}`);
};
class PaidOrderNeedsReviewError extends Error {}

export const fromPaymentIntent = async (
  id: string,
  status: string,
  dependencies: StripeWebhookDependencies = defaultDependencies
) => {
  if (status !== "SUCCESS") {
    await dependencies.orders.updateOne(
      {
        ...paymentIntentOrderQuery(id),
        status: { $nin: ["SUCCESS", "SHIPPED", "PAID_REVIEW"] },
      },
      { $set: { status, webhookAt: dependencies.now() } }
    );
    return;
  }

  const session = await dependencies.startSession();
  let transitionedOrder: Order | null = null;
  try {
    await session.withTransaction(async () => {
      transitionedOrder = await dependencies.orders.findOneAndUpdate(
        {
          ...paymentIntentOrderQuery(id),
          status: { $nin: ["SUCCESS", "SHIPPED", "PAID_REVIEW"] },
        },
        { $set: { status: "SUCCESS", webhookAt: dependencies.now() } },
        { new: true, session }
      ).lean<Order>();

      if (!transitionedOrder) return;

      for (const item of transitionedOrder.items) {
        const result = await dependencies.items.updateOne(
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
        const result = await dependencies.discounts.updateOne(
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
    transitionedOrder = await dependencies.orders.findOneAndUpdate(
      {
        ...paymentIntentOrderQuery(id),
        status: { $nin: ["SUCCESS", "SHIPPED", "PAID_REVIEW"] },
      },
      {
        $set: {
          paidReviewReason: error.message,
          status: "PAID_REVIEW",
          webhookAt: dependencies.now(),
        },
      },
      { new: true }
    ).lean<Order>();
  } finally {
    await session.endSession();
  }

  const orderForEmail =
    transitionedOrder ??
    (status === "SUCCESS"
      ? ((await dependencies.orders.findOne({
          ...paymentIntentOrderQuery(id),
          status: { $in: ["SUCCESS", "SHIPPED", "PAID_REVIEW"] },
          orderConfirmationEmailAt: { $exists: false },
        }).lean()) as Order | null)
      : null);

  if (orderForEmail && !orderForEmail.orderConfirmationEmailAt) {
    await dependencies.sendOrderEmail(orderForEmail, Template.ORDER);
    await dependencies.orders.updateOne(
      {
        _id: orderForEmail._id,
        orderConfirmationEmailAt: { $exists: false },
      },
      { $set: { orderConfirmationEmailAt: dependencies.now() } }
    );
  }
};

const isDuplicateKeyError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
  );

export const claimStripeEvent = async (
  event: Stripe.Event,
  dependencies: StripeWebhookDependencies = defaultDependencies
) => {
  try {
    await dependencies.webhookEvents.create({
      apiVersion: event.api_version,
      provider: "stripe",
      eventId: event.id,
      eventType: event.type,
      status: "processing",
    });
    return true;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  const staleBefore = new Date(dependencies.now().getTime() - 5 * 60 * 1000);
  const claimed = await dependencies.webhookEvents.findOneAndUpdate(
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
        apiVersion: event.api_version,
        status: "processing",
        eventType: event.type,
        lastError: null,
        updatedAt: dependencies.now(),
      },
    }
  );
  return Boolean(claimed);
};

export const createStripeWebhookAction = (
  dependencies: StripeWebhookDependencies = defaultDependencies
): ActionFunction => async ({ request }) => {
  const sig = request.headers.get("Stripe-Signature");
  let webhookApiVersion;
  try {
    webhookApiVersion = getRequestedStripeWebhookApiVersion(request);
  } catch {
    return new Response("Unsupported Stripe webhook API version", {
      status: 400,
    });
  }

  let activeWebhookApiVersion;
  try {
    activeWebhookApiVersion = getActiveStripeWebhookApiVersion();
  } catch (error) {
    console.error("Stripe webhook version configuration is invalid", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response("Stripe webhook version is not configured", {
      status: 500,
    });
  }

  const webhookSecret = getStripeWebhookSecret(webhookApiVersion);

  if (!webhookSecret) {
    return new Response("Stripe webhook is not configured", { status: 500 });
  }
  if (!sig) {
    return new Response("Stripe signature is missing", { status: 400 });
  }

  let body: string;
  try {
    body = await readTextWithinLimit(request, MAX_STRIPE_WEBHOOK_SIZE);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return new Response("Stripe webhook payload is too large", {
        status: 413,
      });
    }
    throw error;
  }

  let event: Stripe.Event;
  try {
    event = dependencies.stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch {
    return new Response("Invalid Stripe signature", { status: 400 });
  }

  if (event.api_version !== webhookApiVersion) {
    return new Response("Stripe webhook API version does not match endpoint", {
      status: 400,
    });
  }

  if (webhookApiVersion !== activeWebhookApiVersion) {
    return new Response("Inactive Stripe webhook version", { status: 200 });
  }

  const claimed = await claimStripeEvent(event, dependencies);
  if (!claimed) return new Response("Already processed", { status: 200 });

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const order = await resolveSucceededOrder(paymentIntent, dependencies);
        await makeAccountTransaction(paymentIntent, order, dependencies);
        await fromPaymentIntent(paymentIntent.id, "SUCCESS", dependencies);
        break;
      }
      case "payment_intent.canceled": {
        const paymentIntenCanceled = event.data.object as Stripe.PaymentIntent;
        await fromPaymentIntent(paymentIntenCanceled.id, "CANCELED", dependencies);
        break;
      }
      case "payment_intent.payment_failed": {
        const paymentIntentFailed = event.data.object as Stripe.PaymentIntent;
        await fromPaymentIntent(paymentIntentFailed.id, "FAILED", dependencies);
        break;
      }
      case "payout.paid": {
        const payout = event.data.object as Stripe.Payout;
        await handlePayoutPaid(payout, dependencies);
        break;
      }
    }
    await dependencies.webhookEvents.updateOne(
      { provider: "stripe", eventId: event.id },
      { $set: { status: "completed", lastError: null } }
    );
    return new Response("OK", { status: 200 });
  } catch (error) {
    await dependencies.webhookEvents.updateOne(
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

export let action: ActionFunction = createStripeWebhookAction();
