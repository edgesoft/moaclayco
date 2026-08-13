import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mongoose from "mongoose";
import type Stripe from "stripe";
import { Discounts } from "../app/schemas/discounts";
import { Items } from "../app/schemas/items";
import { Orders } from "../app/schemas/orders";
import { VerificationCounters } from "../app/schemas/verification-counters";
import { Verifications } from "../app/schemas/verifications";
import { WebhookEvents } from "../app/schemas/webhook-events";
import { connectToDatabase } from "../app/services/database.server";
import { buildCheckoutPaymentIntent } from "../app/services/checkout-payment.server";
import {
  STRIPE_TARGET_API_VERSION,
  STRIPE_WEBHOOK_VERSION_PARAMETER,
} from "../app/services/stripe-config.server";
import stripeClient, { stripeApiVersion } from "../app/stripeClient";

const databaseName = process.env.STRIPE_E2E_DATABASE;
const appBaseUrl = process.env.STRIPE_E2E_BASE_URL;
const mailpitUrl = process.env.STRIPE_E2E_MAILPIT_URL;
const webhookSecret = process.env.STRIPE_WEBHOOK;
const webhookUrl = `${appBaseUrl}/webhook?${STRIPE_WEBHOOK_VERSION_PARAMETER}=${encodeURIComponent(
  stripeApiVersion
)}`;

const waitFor = async <T>(
  description: string,
  read: () => Promise<T | null | undefined | false>,
  timeoutMs = 45_000
) => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const suffix =
    lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
};

const mailpitMessages = async () => {
  const response = await fetch(`${mailpitUrl}/api/v1/messages`);
  if (!response.ok) {
    throw new Error(`Mailpit returned ${response.status}`);
  }
  const payload = (await response.json()) as { messages?: unknown[] };
  return Array.isArray(payload.messages) ? payload.messages : [];
};

const messagesForOrder = async (orderId: string) =>
  (await mailpitMessages()).filter((message) =>
    String(
      (message as { MessageID?: unknown; MessageId?: unknown }).MessageID ??
        (message as { MessageId?: unknown }).MessageId ??
        ""
    ).includes(orderId)
  );

const webhookFor = async (eventType: string, after: Date) =>
  WebhookEvents.findOne({
    apiVersion: stripeApiVersion,
    createdAt: { $gte: after },
    eventType,
    provider: "stripe",
    status: "completed",
  }).lean();

type Scenario = Awaited<ReturnType<typeof createScenario>>;

const createScenario = async ({
  discount = false,
  runId,
}: {
  discount?: boolean;
  runId: string;
}) => {
  const item = await Items.create({
    amount: 3,
    collectionRef: `stripe-e2e-${runId}`,
    domain: "moaclayco",
    headline: `Stripe E2E ${runId}`,
    images: ["stripe-e2e.webp"],
    price: 100,
  });
  const discountCode = discount ? `E2E-${runId}` : undefined;
  if (discountCode) {
    await Discounts.create({
      balance: 2,
      code: discountCode,
      domain: "moaclayco",
      percentage: 10,
    });
  }

  const checkoutToken = randomUUID();
  const order = await Orders.create({
    checkoutFingerprint: `stripe-e2e-${runId}`,
    checkoutToken,
    createdAt: new Date(),
    customer: {
      city: "Stockholm",
      email: `stripe-e2e-${runId}@example.com`,
      firstname: "Stripe",
      lastname: "E2E",
      postaddress: "Testgatan 1",
      zipcode: "11122",
    },
    discount: discountCode
      ? { amount: 10, code: discountCode, percentage: 10 }
      : { amount: 0 },
    domain: "moaclayco",
    freightCost: 0,
    items: [
      {
        additionalItems: [],
        image: "stripe-e2e.webp",
        itemRef: String(item._id),
        name: item.headline,
        price: 100,
        quantity: 1,
      },
    ],
    status: "PENDING",
    totalSum: discountCode ? 90 : 100,
  });

  const paymentRequest = buildCheckoutPaymentIntent({
    checkoutToken,
    order,
    paymentMethods: ["card"],
  });
  const paymentIntent = await stripeClient.paymentIntents.create(
    {
      ...paymentRequest.params,
      description: `Moa Clay webhook E2E ${runId}`,
      metadata: {
        ...paymentRequest.params.metadata,
        e2eRunId: runId,
      },
    },
    paymentRequest.options
  );
  assert.ok(paymentIntent.client_secret);
  await Orders.updateOne(
    { _id: order._id },
    {
      $set: {
        paymentIntent: {
          client_secret: paymentIntent.client_secret,
          id: paymentIntent.id,
        },
      },
    }
  );

  return { discountCode, item, order, paymentIntent, runId };
};

const assertNoPaymentSideEffects = async (scenario: Scenario) => {
  const item = await Items.findById(scenario.item._id).lean();
  assert.equal(item?.amount, 3);
  assert.equal(
    await Verifications.countDocuments({
      idempotencyKey: `stripe:payment:${scenario.paymentIntent.id}`,
    }),
    0
  );
  assert.equal((await messagesForOrder(String(scenario.order._id))).length, 0);
};

test(
  "Stripe sandbox delivers signed payment webhooks through the real application",
  { timeout: 180_000 },
  async (context) => {
    assert.match(process.env.STRIPE_SRV ?? "", /^sk_test_/);
    assert.match(webhookSecret ?? "", /^whsec_/);
    assert.ok(appBaseUrl);
    assert.ok(mailpitUrl);
    assert.equal(databaseName, "moaclayco-stripe-e2e");
    assert.equal(stripeApiVersion, STRIPE_TARGET_API_VERSION);

    await connectToDatabase();
    context.after(async () => {
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });
    assert.equal(mongoose.connection.db?.databaseName, databaseName);
    const hello = await mongoose.connection.db?.admin().command({ hello: 1 });
    assert.equal(hello?.setName, "rs0");

    await Promise.all([
      Discounts.init(),
      Items.init(),
      Orders.init(),
      VerificationCounters.init(),
      Verifications.init(),
      WebhookEvents.init(),
    ]);
    await Promise.all([
      Discounts.deleteMany({}),
      Items.deleteMany({}),
      Orders.deleteMany({}),
      VerificationCounters.deleteMany({}),
      Verifications.deleteMany({}),
      WebhookEvents.deleteMany({}),
    ]);
    await waitFor("Mailpit", async () => {
      await mailpitMessages();
      return true;
    });

    await context.test("rejects an invalid signature", async () => {
      const response = await fetch(webhookUrl, {
        body: "{}",
        headers: { "Stripe-Signature": "invalid" },
        method: "POST",
      });
      assert.equal(response.status, 400);
    });

    await context.test(
      "completes payment, accounting, stock, discount and email exactly once",
      async () => {
        const startedAt = new Date();
        const scenario = await createScenario({
          discount: true,
          runId: randomUUID(),
        });
        const confirmed = await stripeClient.paymentIntents.confirm(
          scenario.paymentIntent.id,
          { payment_method: "pm_card_visa" }
        );
        assert.equal(confirmed.status, "succeeded");
        assert.equal(confirmed.capture_method, "automatic");

        await waitFor("completed payment_intent.succeeded webhook", () =>
          webhookFor("payment_intent.succeeded", startedAt)
        );
        const order = await Orders.findById(scenario.order._id).lean();
        assert.equal(order?.status, "SUCCESS");
        assert.ok(order?.webhookAt);
        assert.ok(order?.orderConfirmationEmailAt);
        assert.equal(
          (await Items.findById(scenario.item._id).lean())?.amount,
          2
        );
        assert.equal(
          (
            await Discounts.findOne({
              code: scenario.discountCode,
              domain: "moaclayco",
            }).lean()
          )?.balance,
          1
        );

        const verifications = await Verifications.find({
          idempotencyKey: `stripe:payment:${scenario.paymentIntent.id}`,
        }).lean();
        assert.equal(verifications.length, 1);
        const debit = verifications[0].journalEntries.reduce(
          (sum: number, entry: { debit?: number }) => sum + Number(entry.debit || 0),
          0
        );
        const credit = verifications[0].journalEntries.reduce(
          (sum: number, entry: { credit?: number }) =>
            sum + Number(entry.credit || 0),
          0
        );
        assert.equal(debit, credit);
        assert.equal(credit, scenario.order.totalSum);
        await waitFor("one captured order email", async () => {
          const messages = await messagesForOrder(String(scenario.order._id));
          return messages.length === 1 ? messages : null;
        });

        const events = await stripeClient.events.list({
          created: { gte: Math.floor(startedAt.getTime() / 1000) - 2 },
          limit: 100,
          type: "payment_intent.succeeded",
        });
        const event = events.data.find(
          (candidate) =>
            (candidate.data.object as Stripe.PaymentIntent).id ===
            scenario.paymentIntent.id
        );
        assert.ok(event, "Stripe did not expose the succeeded event for replay");
        const replayEvent = {
          ...event,
          api_version: stripeApiVersion,
        } as Stripe.Event;
        const payload = JSON.stringify(replayEvent);
        const signature = stripeClient.webhooks.generateTestHeaderString({
          payload,
          secret: webhookSecret as string,
        });
        const replay = await fetch(webhookUrl, {
          body: payload,
          headers: { "Stripe-Signature": signature },
          method: "POST",
        });
        assert.equal(replay.status, 200);
        assert.equal(await replay.text(), "Already processed");
        assert.equal(
          (await Items.findById(scenario.item._id).lean())?.amount,
          2
        );
        assert.equal(
          await Verifications.countDocuments({
            idempotencyKey: `stripe:payment:${scenario.paymentIntent.id}`,
          }),
          1
        );
        assert.equal(
          (await messagesForOrder(String(scenario.order._id))).length,
          1
        );
      }
    );

    await context.test("records a real declined payment", async () => {
      const startedAt = new Date();
      const scenario = await createScenario({ runId: randomUUID() });
      await assert.rejects(
        () =>
          stripeClient.paymentIntents.confirm(scenario.paymentIntent.id, {
            payment_method: "pm_card_visa_chargeDeclined",
          }),
        (error: unknown) =>
          Boolean(
            error &&
              typeof error === "object" &&
              "type" in error &&
              error.type === "StripeCardError"
          )
      );
      await waitFor("completed payment_intent.payment_failed webhook", () =>
        webhookFor("payment_intent.payment_failed", startedAt)
      );
      assert.equal(
        (await Orders.findById(scenario.order._id).lean())?.status,
        "FAILED"
      );
      await assertNoPaymentSideEffects(scenario);
    });

    await context.test("records a real canceled PaymentIntent", async () => {
      const startedAt = new Date();
      const scenario = await createScenario({ runId: randomUUID() });
      const canceled = await stripeClient.paymentIntents.cancel(
        scenario.paymentIntent.id
      );
      assert.equal(canceled.status, "canceled");
      await waitFor("completed payment_intent.canceled webhook", () =>
        webhookFor("payment_intent.canceled", startedAt)
      );
      assert.equal(
        (await Orders.findById(scenario.order._id).lean())?.status,
        "CANCELED"
      );
      await assertNoPaymentSideEffects(scenario);
    });
  }
);
