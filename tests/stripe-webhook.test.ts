import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
import type { Order } from "../app/types";
import {
  claimStripeEvent,
  createStripeWebhookAction,
  fromPaymentIntent,
  handlePayoutPaid,
  makeAccountTransaction,
  resolveSucceededOrder,
  type StripeWebhookDependencies,
} from "../app/services/stripe-webhook.server";
import {
  STRIPE_LEGACY_API_VERSION,
  STRIPE_TARGET_API_VERSION,
  STRIPE_WEBHOOK_VERSION_PARAMETER,
  type SupportedStripeWebhookApiVersion,
} from "../app/services/stripe-config.server";
import { STORE_ID } from "../app/utils/store";

const fixedNow = new Date("2026-08-12T12:00:00.000Z");
const itemId = "64f10123456789abcdef0123";

const order: Order = {
  _id: "64f10123456789abcdef0456",
  customer: {
    city: "Stockholm",
    email: "customer@example.com",
    firstname: "Moa",
    lastname: "Test",
    postaddress: "Testgatan 1",
    zipcode: "11122",
  },
  discount: { amount: 55, code: "SOMMAR", percentage: 10 },
  freightCost: 49,
  items: [
    {
      _id: itemId,
      additionalItems: [],
      image: "cup.webp",
      itemRef: itemId,
      name: "Kopp",
      price: 500,
      quantity: 1,
    },
  ],
  paymentIntent: {
    client_secret: "pi_test_secret_test",
    id: "pi_test",
  },
  status: "PENDING",
  totalSum: 549,
};

const paymentIntent = {
  amount: 54_900,
  client_secret: "pi_test_secret_test",
  currency: "sek",
  id: "pi_test",
  latest_charge: "ch_test",
  metadata: { domain: STORE_ID, orderId: order._id },
  object: "payment_intent",
  status: "succeeded",
} as unknown as Stripe.PaymentIntent;

const stripeEvent = (
  type: Stripe.Event.Type,
  object: Stripe.Event.Data.Object = paymentIntent,
  id = "evt_test",
  apiVersion: SupportedStripeWebhookApiVersion = STRIPE_LEGACY_API_VERSION
) =>
  ({
    api_version: apiVersion,
    created: Math.floor(fixedNow.getTime() / 1000),
    data: { object },
    id,
    livemode: false,
    object: "event",
    pending_webhooks: 1,
    request: null,
    type,
  }) as Stripe.Event;

const leanResult = <T>(value: T) => ({
  lean: async () => value,
});

const unexpected = (name: string) => async () => {
  throw new Error(`Unexpected dependency call: ${name}`);
};

const makeDependencies = (
  overrides: Partial<StripeWebhookDependencies> = {}
): StripeWebhookDependencies => {
  const signer = new Stripe("sk_test_local");
  const session = {
    endSession: async () => undefined,
    withTransaction: async (callback: () => Promise<void>) => callback(),
  };

  return {
    createVerification: unexpected("createVerification"),
    discounts: { updateOne: unexpected("discounts.updateOne") },
    items: { updateOne: unexpected("items.updateOne") },
    now: () => new Date(fixedNow),
    orders: {
      findOne: unexpected("orders.findOne"),
      findOneAndUpdate: unexpected("orders.findOneAndUpdate"),
      updateOne: unexpected("orders.updateOne"),
    },
    sendOrderEmail: unexpected("sendOrderEmail"),
    startSession: async () => session,
    stripe: signer,
    webhookEvents: {
      create: unexpected("webhookEvents.create"),
      findOneAndUpdate: unexpected("webhookEvents.findOneAndUpdate"),
      updateOne: unexpected("webhookEvents.updateOne"),
    },
    ...overrides,
  } as unknown as StripeWebhookDependencies;
};

const signedRequest = ({
  event,
  secret,
  stripe,
  url = "http://localhost/webhook",
}: {
  event: Stripe.Event;
  secret: string;
  stripe: Stripe;
  url?: string;
}) => {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    timestamp: Math.floor(Date.now() / 1000),
  });
  return new Request(url, {
    body: payload,
    headers: { "Stripe-Signature": signature },
    method: "POST",
  });
};

const withStripeEnvironment = async (
  values: Record<string, string | undefined>,
  callback: () => Promise<void>
) => {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const runAction = async (
  action: ReturnType<typeof createStripeWebhookAction>,
  request: Request
) => (await action({ request } as never)) as Response;

test("signed payment success runs accounting, inventory, discount and email once", async () => {
  const secret = "whsec_local_test";
  const previousSecret = process.env.STRIPE_WEBHOOK;
  process.env.STRIPE_WEBHOOK = secret;
  const signer = new Stripe("sk_test_local");
  const verifications: Array<Record<string, unknown>> = [];
  const eventUpdates: Array<Record<string, unknown>> = [];
  const orderUpdates: Array<Record<string, unknown>> = [];
  let itemDecrements = 0;
  let discountDecrements = 0;
  let emails = 0;
  let catalogInvalidations = 0;

  const succeededOrder = { ...order, status: "SUCCESS" as const };
  const dependencies = makeDependencies({
    createVerification: async (input) => {
      verifications.push(input as unknown as Record<string, unknown>);
      return input as never;
    },
    discounts: {
      updateOne: async () => {
        discountDecrements += 1;
        return { modifiedCount: 1 };
      },
    } as never,
    items: {
      updateOne: async () => {
        itemDecrements += 1;
        return { modifiedCount: 1 };
      },
    } as never,
    invalidateCatalogCache: () => {
      catalogInvalidations += 1;
    },
    orders: {
      findOne: () => leanResult(order),
      findOneAndUpdate: () => leanResult(succeededOrder),
      updateOne: async (filter: unknown, update: unknown) => {
        orderUpdates.push({ filter, update });
        return { modifiedCount: 1 };
      },
    } as never,
    sendOrderEmail: async () => {
      emails += 1;
      return { messageId: "order-test" };
    },
    stripe: {
      balanceTransactions: {
        retrieve: async () => ({ amount: 54_900, fee: 1_450, net: 53_450 }),
      },
      charges: {
        retrieve: async () => ({
          balance_transaction: "txn_test",
          created: 1_786_536_000,
          id: "ch_test",
        }),
      },
      webhooks: signer.webhooks,
    } as never,
    webhookEvents: {
      create: async () => ({}),
      findOneAndUpdate: unexpected("webhookEvents.findOneAndUpdate"),
      updateOne: async (_filter: unknown, update: unknown) => {
        eventUpdates.push(update as Record<string, unknown>);
        return { modifiedCount: 1 };
      },
    } as never,
  });

  try {
    const action = createStripeWebhookAction(dependencies);
    const response = await runAction(
      action,
      signedRequest({
        event: stripeEvent("payment_intent.succeeded"),
        secret,
        stripe: signer,
      })
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "OK");
    assert.equal(verifications.length, 1);
    assert.deepEqual(verifications[0].journalEntries, [
      { account: 3001, credit: 439.2 },
      { account: 2611, credit: 109.8 },
      { account: 6570, debit: 14.5 },
      { account: 1580, debit: 534.5 },
    ]);
    assert.equal(itemDecrements, 1);
    assert.equal(discountDecrements, 1);
    assert.equal(emails, 1);
    assert.equal(catalogInvalidations, 1);
    assert.equal(orderUpdates.length, 1);
    assert.deepEqual(eventUpdates.at(-1), {
      $set: { lastError: null, status: "completed" },
    });
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK;
    else process.env.STRIPE_WEBHOOK = previousSecret;
  }
});

test("webhook rejects missing, invalid and oversized signatures before processing", async () => {
  const previousSecret = process.env.STRIPE_WEBHOOK;
  process.env.STRIPE_WEBHOOK = "whsec_local_test";
  const dependencies = makeDependencies();
  const action = createStripeWebhookAction(dependencies);

  try {
    const missing = await runAction(
      action,
      new Request("http://localhost/webhook", {
        body: "{}",
        method: "POST",
      })
    );
    assert.equal(missing.status, 400);

    const invalid = await runAction(
      action,
      new Request("http://localhost/webhook", {
        body: "{}",
        headers: { "Stripe-Signature": "invalid" },
        method: "POST",
      })
    );
    assert.equal(invalid.status, 400);

    const oversized = await runAction(
      action,
      new Request("http://localhost/webhook", {
        body: "x".repeat(1024 * 1024 + 1),
        headers: { "Stripe-Signature": "unread" },
        method: "POST",
      })
    );
    assert.equal(oversized.status, 413);
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK;
    else process.env.STRIPE_WEBHOOK = previousSecret;
  }
});

test("Dahlia webhook uses its version-specific secret and records the API version", async () => {
  const signer = new Stripe("sk_test_local");
  const secret = "whsec_dahlia_test";
  const createdEvents: Array<Record<string, unknown>> = [];
  const dependencies = makeDependencies({
    stripe: { webhooks: signer.webhooks } as never,
    webhookEvents: {
      create: async (event: Record<string, unknown>) => {
        createdEvents.push(event);
        return {};
      },
      updateOne: async () => ({ modifiedCount: 1 }),
    } as never,
  });

  await withStripeEnvironment(
    {
      STRIPE_API_VERSION: STRIPE_TARGET_API_VERSION,
      STRIPE_WEBHOOK: "whsec_wrong_generic_secret",
      STRIPE_WEBHOOK_ACTIVE_VERSION: STRIPE_TARGET_API_VERSION,
      STRIPE_WEBHOOK_DAHLIA: secret,
    },
    async () => {
      const event = stripeEvent(
        "account.updated",
        paymentIntent,
        "evt_dahlia",
        STRIPE_TARGET_API_VERSION
      );
      const response = await runAction(
        createStripeWebhookAction(dependencies),
        signedRequest({
          event,
          secret,
          stripe: signer,
          url: `http://localhost/webhook?${STRIPE_WEBHOOK_VERSION_PARAMETER}=${STRIPE_TARGET_API_VERSION}`,
        })
      );

      assert.equal(response.status, 200);
      assert.equal(await response.text(), "OK");
      assert.equal(createdEvents.length, 1);
      assert.equal(
        createdEvents[0].apiVersion,
        STRIPE_TARGET_API_VERSION
      );
    }
  );
});

test("webhook verifies but ignores an inactive rollout version", async () => {
  const signer = new Stripe("sk_test_local");
  const secret = "whsec_dahlia_inactive";
  const dependencies = makeDependencies({
    stripe: { webhooks: signer.webhooks } as never,
  });

  await withStripeEnvironment(
    {
      STRIPE_API_VERSION: STRIPE_TARGET_API_VERSION,
      STRIPE_WEBHOOK_ACTIVE_VERSION: STRIPE_LEGACY_API_VERSION,
      STRIPE_WEBHOOK_DAHLIA: secret,
    },
    async () => {
      const response = await runAction(
        createStripeWebhookAction(dependencies),
        signedRequest({
          event: stripeEvent(
            "account.updated",
            paymentIntent,
            "evt_inactive",
            STRIPE_TARGET_API_VERSION
          ),
          secret,
          stripe: signer,
          url: `http://localhost/webhook?${STRIPE_WEBHOOK_VERSION_PARAMETER}=${STRIPE_TARGET_API_VERSION}`,
        })
      );

      assert.equal(response.status, 200);
      assert.equal(await response.text(), "Inactive Stripe webhook version");
    }
  );
});

test("webhook rejects an event rendered for another API version", async () => {
  const signer = new Stripe("sk_test_local");
  const secret = "whsec_dahlia_mismatch";
  const dependencies = makeDependencies({
    stripe: { webhooks: signer.webhooks } as never,
  });

  await withStripeEnvironment(
    {
      STRIPE_API_VERSION: STRIPE_TARGET_API_VERSION,
      STRIPE_WEBHOOK_ACTIVE_VERSION: STRIPE_TARGET_API_VERSION,
      STRIPE_WEBHOOK_DAHLIA: secret,
    },
    async () => {
      const response = await runAction(
        createStripeWebhookAction(dependencies),
        signedRequest({
          event: stripeEvent("account.updated"),
          secret,
          stripe: signer,
          url: `http://localhost/webhook?${STRIPE_WEBHOOK_VERSION_PARAMETER}=${STRIPE_TARGET_API_VERSION}`,
        })
      );

      assert.equal(response.status, 400);
      assert.equal(
        await response.text(),
        "Stripe webhook API version does not match endpoint"
      );
    }
  );
});

test("duplicate completed webhook events are acknowledged without side effects", async () => {
  const secret = "whsec_local_test";
  const previousSecret = process.env.STRIPE_WEBHOOK;
  process.env.STRIPE_WEBHOOK = secret;
  const signer = new Stripe("sk_test_local");
  const duplicateError = Object.assign(new Error("duplicate"), { code: 11000 });
  const dependencies = makeDependencies({
    stripe: { webhooks: signer.webhooks } as never,
    webhookEvents: {
      create: async () => {
        throw duplicateError;
      },
      findOneAndUpdate: async () => null,
      updateOne: unexpected("webhookEvents.updateOne"),
    } as never,
  });

  try {
    const response = await runAction(
      createStripeWebhookAction(dependencies),
      signedRequest({
        event: stripeEvent("payment_intent.succeeded"),
        secret,
        stripe: signer,
      })
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "Already processed");
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK;
    else process.env.STRIPE_WEBHOOK = previousSecret;
  }
});

test("failed or stale webhook events can be claimed for retry", async () => {
  const duplicateError = Object.assign(new Error("duplicate"), { code: 11000 });
  let retryFilter: Record<string, unknown> | undefined;
  const dependencies = makeDependencies({
    webhookEvents: {
      create: async () => {
        throw duplicateError;
      },
      findOneAndUpdate: async (filter: Record<string, unknown>) => {
        retryFilter = filter;
        return { status: "processing" };
      },
    } as never,
  });

  assert.equal(
    await claimStripeEvent(
      stripeEvent("payment_intent.payment_failed"),
      dependencies
    ),
    true
  );
  assert.deepEqual(retryFilter?.$or, [
    { status: "failed" },
    {
      status: "processing",
      updatedAt: { $lt: new Date("2026-08-12T11:55:00.000Z") },
    },
  ]);
});

test("processing failures are persisted and return a retryable 500", async () => {
  const secret = "whsec_local_test";
  const previousSecret = process.env.STRIPE_WEBHOOK;
  process.env.STRIPE_WEBHOOK = secret;
  const signer = new Stripe("sk_test_local");
  const eventUpdates: Array<Record<string, unknown>> = [];
  const dependencies = makeDependencies({
    orders: { findOne: () => leanResult(null) } as never,
    stripe: { webhooks: signer.webhooks } as never,
    webhookEvents: {
      create: async () => ({}),
      updateOne: async (_filter: unknown, update: unknown) => {
        eventUpdates.push(update as Record<string, unknown>);
        return { modifiedCount: 1 };
      },
    } as never,
  });

  try {
    const response = await runAction(
      createStripeWebhookAction(dependencies),
      signedRequest({
        event: stripeEvent("payment_intent.succeeded"),
        secret,
        stripe: signer,
      })
    );

    assert.equal(response.status, 500);
    assert.match(
      String((eventUpdates.at(-1)?.$set as Record<string, unknown>)?.lastError),
      /was not found/
    );
    assert.equal(
      (eventUpdates.at(-1)?.$set as Record<string, unknown>)?.status,
      "failed"
    );
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK;
    else process.env.STRIPE_WEBHOOK = previousSecret;
  }
});

test("failed and canceled payments update only non-paid orders", async () => {
  const updates: Array<Record<string, unknown>> = [];
  let sessions = 0;
  const dependencies = makeDependencies({
    orders: {
      updateOne: async (filter: unknown, update: unknown) => {
        updates.push({ filter, update });
        return { modifiedCount: 1 };
      },
    } as never,
    startSession: async () => {
      sessions += 1;
      throw new Error("not expected");
    },
  });

  await fromPaymentIntent("pi_failed", "FAILED", dependencies);
  await fromPaymentIntent("pi_canceled", "CANCELED", dependencies);

  assert.equal(sessions, 0);
  assert.equal(updates.length, 2);
  assert.deepEqual(
    (updates[0].filter as Record<string, unknown>).status,
    { $nin: ["SUCCESS", "SHIPPED", "PAID_REVIEW"] }
  );
  assert.equal(
    ((updates[0].update as Record<string, unknown>).$set as Record<string, unknown>)
      .status,
    "FAILED"
  );
});

test("signed failed and canceled events dispatch their exact order status", async () => {
  const secret = "whsec_local_test";
  const previousSecret = process.env.STRIPE_WEBHOOK;
  process.env.STRIPE_WEBHOOK = secret;
  const signer = new Stripe("sk_test_local");
  const statuses: string[] = [];
  const dependencies = makeDependencies({
    orders: {
      updateOne: async (_filter: unknown, update: Record<string, unknown>) => {
        statuses.push(String((update.$set as Record<string, unknown>).status));
        return { modifiedCount: 1 };
      },
    } as never,
    stripe: { webhooks: signer.webhooks } as never,
    webhookEvents: {
      create: async () => ({}),
      updateOne: async () => ({ modifiedCount: 1 }),
    } as never,
  });
  const action = createStripeWebhookAction(dependencies);

  try {
    const failed = await runAction(
      action,
      signedRequest({
        event: stripeEvent(
          "payment_intent.payment_failed",
          { ...paymentIntent, status: "requires_payment_method" } as Stripe.PaymentIntent,
          "evt_failed"
        ),
        secret,
        stripe: signer,
      })
    );
    const canceled = await runAction(
      action,
      signedRequest({
        event: stripeEvent(
          "payment_intent.canceled",
          { ...paymentIntent, status: "canceled" } as Stripe.PaymentIntent,
          "evt_canceled"
        ),
        secret,
        stripe: signer,
      })
    );

    assert.equal(failed.status, 200);
    assert.equal(canceled.status, 200);
    assert.deepEqual(statuses, ["FAILED", "CANCELED"]);
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK;
    else process.env.STRIPE_WEBHOOK = previousSecret;
  }
});

test("insufficient stock moves a paid order to review without decrementing discount", async () => {
  let transitionCalls = 0;
  let discountDecrements = 0;
  let emails = 0;
  let catalogInvalidations = 0;
  let sessionEnded = false;
  const transitionUpdates: Array<Record<string, unknown>> = [];
  const reviewOrder = {
    ...order,
    paidReviewReason: "Insufficient stock for paid order",
    status: "PAID_REVIEW" as const,
  };
  const dependencies = makeDependencies({
    discounts: {
      updateOne: async () => {
        discountDecrements += 1;
        return { modifiedCount: 1 };
      },
    } as never,
    items: {
      updateOne: async () => ({ modifiedCount: 0 }),
    } as never,
    invalidateCatalogCache: () => {
      catalogInvalidations += 1;
    },
    orders: {
      findOneAndUpdate: (_filter: unknown, update: Record<string, unknown>) => {
        transitionCalls += 1;
        transitionUpdates.push(update);
        return leanResult(transitionCalls === 1 ? order : reviewOrder);
      },
      updateOne: async () => ({ modifiedCount: 1 }),
    } as never,
    sendOrderEmail: async () => {
      emails += 1;
      return { messageId: "review-test" };
    },
    startSession: async () => ({
      endSession: async () => {
        sessionEnded = true;
      },
      withTransaction: async (callback: () => Promise<void>) => callback(),
    } as never),
  });

  await fromPaymentIntent(paymentIntent.id, "SUCCESS", dependencies);

  assert.equal(transitionCalls, 2);
  assert.equal(discountDecrements, 0);
  assert.equal(emails, 1);
  assert.equal(catalogInvalidations, 0);
  assert.equal(sessionEnded, true);
  assert.equal(
    (transitionUpdates[1].$set as Record<string, unknown>).paidReviewReason,
    "Insufficient stock for paid order"
  );
});

test("a paid PaymentIntent alias still finds the review order for email", async () => {
  const aliasedOrder = {
    ...order,
    paymentIntentAliases: ["pi_alias"],
    status: "PAID_REVIEW" as const,
  };
  let emailQuery: Record<string, unknown> | undefined;
  let emails = 0;
  const dependencies = makeDependencies({
    orders: {
      findOne: (filter: Record<string, unknown>) => {
        emailQuery = filter;
        return leanResult(aliasedOrder);
      },
      findOneAndUpdate: () => leanResult(null),
      updateOne: async () => ({ modifiedCount: 1 }),
    } as never,
    sendOrderEmail: async () => {
      emails += 1;
      return { messageId: "alias-review-test" };
    },
  });

  await fromPaymentIntent("pi_alias", "SUCCESS", dependencies);

  assert.equal(emails, 1);
  assert.deepEqual(emailQuery?.$or, [
    { "paymentIntent.id": "pi_alias" },
    { paymentIntentAliases: "pi_alias" },
  ]);
});

test("accounting uses the Stripe balance transaction amounts and stable idempotency key", async () => {
  const verifications: Array<Record<string, unknown>> = [];
  const dependencies = makeDependencies({
    createVerification: async (input) => {
      verifications.push(input as unknown as Record<string, unknown>);
      return input as never;
    },
    stripe: {
      balanceTransactions: {
        retrieve: async () => ({ amount: 54_900, fee: 1_450, net: 53_450 }),
      },
      charges: {
        retrieve: async () => ({
          balance_transaction: "txn_test",
          created: 1_786_536_000,
          id: "ch_test",
        }),
      },
    } as never,
  });

  await makeAccountTransaction(paymentIntent, order, dependencies);
  await makeAccountTransaction(paymentIntent, order, dependencies);

  assert.equal(verifications.length, 2);
  assert.equal(verifications[0].idempotencyKey, "stripe:payment:pi_test");
  assert.deepEqual(verifications[1].journalEntries, verifications[0].journalEntries);
});

test("accounting waits for Stripe when a balance transaction is not available", async () => {
  let verifications = 0;
  const dependencies = makeDependencies({
    createVerification: async () => {
      verifications += 1;
      return {} as never;
    },
    stripe: {
      charges: {
        retrieve: async () => ({
          balance_transaction: null,
          created: 1_786_536_000,
          id: "ch_test",
        }),
      },
    } as never,
  });

  await assert.rejects(
    () => makeAccountTransaction(paymentIntent, order, dependencies),
    /has no balance transaction/
  );
  assert.equal(verifications, 0);
});

test("successful intent metadata can safely attach a missing order PaymentIntent", async () => {
  const unattachedOrder = { ...order, paymentIntent: undefined };
  let findCalls = 0;
  let attachedUpdate: Record<string, unknown> | undefined;
  const dependencies = makeDependencies({
    orders: {
      findOne: () => {
        findCalls += 1;
        return leanResult(findCalls === 1 ? null : unattachedOrder);
      },
      findOneAndUpdate: (_filter: unknown, update: Record<string, unknown>) => {
        attachedUpdate = update;
        return leanResult({ ...unattachedOrder, paymentIntent: order.paymentIntent });
      },
    } as never,
  });

  const resolved = await resolveSucceededOrder(
    paymentIntent,
    dependencies
  );

  assert.equal(resolved.paymentIntent?.id, paymentIntent.id);
  assert.deepEqual(attachedUpdate, {
    $set: {
      "paymentIntent.client_secret": paymentIntent.client_secret,
      "paymentIntent.id": paymentIntent.id,
    },
  });
});

test("a different successful PaymentIntent is attached as an alias and flagged for review", async () => {
  const aliasedIntent = {
    ...paymentIntent,
    client_secret: "pi_alias_secret_test",
    id: "pi_alias",
  } as Stripe.PaymentIntent;
  let findCalls = 0;
  let reviewUpdate: Record<string, unknown> | undefined;
  const reviewOrder = {
    ...order,
    paidReviewReason: "Successful Stripe payment pi_alias differs from the order PaymentIntent",
    paymentIntentAliases: ["pi_alias"],
    status: "PAID_REVIEW" as const,
  };
  const dependencies = makeDependencies({
    orders: {
      findOne: () => {
        findCalls += 1;
        return leanResult(findCalls === 1 ? null : order);
      },
      findOneAndUpdate: (_filter: unknown, update: Record<string, unknown>) => {
        reviewUpdate = update;
        return leanResult(reviewOrder);
      },
    } as never,
  });

  const resolved = await resolveSucceededOrder(aliasedIntent, dependencies);

  assert.equal(resolved.status, "PAID_REVIEW");
  assert.deepEqual(reviewUpdate?.$addToSet, {
    paymentIntentAliases: "pi_alias",
  });
  assert.equal(
    (reviewUpdate?.$set as Record<string, unknown>).status,
    "PAID_REVIEW"
  );
});

test("payout accounting links an order and balances Stripe clearing", async () => {
  const verifications: Array<Record<string, unknown>> = [];
  const dependencies = makeDependencies({
    createVerification: async (input) => {
      verifications.push(input as unknown as Record<string, unknown>);
      return input as never;
    },
    orders: { findOne: () => leanResult(order) } as never,
    stripe: {
      balanceTransactions: {
        list: () => ({
          autoPagingToArray: async () => [
            { id: "txn_test", source: "ch_test" },
          ],
        }),
      },
      charges: {
        retrieve: async () => ({ payment_intent: paymentIntent.id }),
      },
    } as never,
  });

  await handlePayoutPaid(
    {
      amount: 53_450,
      arrival_date: 1_786_622_400,
      created: 1_786_536_000,
      id: "po_test",
    } as unknown as Stripe.Payout,
    dependencies
  );

  assert.equal("domain" in verifications[0], false);
  assert.equal(verifications[0].idempotencyKey, "stripe:payout:po_test");
  assert.deepEqual(verifications[0].journalEntries, [
    { account: 1930, debit: 534.5 },
    { account: 1580, credit: 534.5 },
  ]);
});

test("manual payout accounting accepts legacy store metadata", async () => {
  const verifications: Array<Record<string, unknown>> = [];
  const dependencies = makeDependencies({
    createVerification: async (input) => {
      verifications.push(input as unknown as Record<string, unknown>);
      return input as never;
    },
    stripe: {
      balanceTransactions: {
        list: () => {
          throw new Error("manual payouts must not query by payout");
        },
      },
    } as never,
  });

  await handlePayoutPaid(
    {
      amount: 30_037,
      automatic: false,
      created: 1_786_634_763,
      id: "po_manual",
      metadata: { domain: STORE_ID },
    } as unknown as Stripe.Payout,
    dependencies
  );

  assert.equal("domain" in verifications[0], false);
  assert.equal(verifications[0].idempotencyKey, "stripe:payout:po_manual");
  assert.deepEqual(verifications[0].journalEntries, [
    { account: 1930, debit: 300.37 },
    { account: 1580, credit: 300.37 },
  ]);
});

test("manual payout accounting needs no tenant metadata", async () => {
  const verifications: Array<Record<string, unknown>> = [];
  const dependencies = makeDependencies({
    createVerification: async (input) => {
      verifications.push(input as unknown as Record<string, unknown>);
      return input as never;
    },
  });

  await handlePayoutPaid(
    {
      amount: 30_037,
      automatic: false,
      created: 1_786_634_763,
      id: "po_manual_without_domain",
      metadata: {},
    } as unknown as Stripe.Payout,
    dependencies
  );

  assert.equal("domain" in verifications[0], false);
  assert.equal(
    verifications[0].idempotencyKey,
    "stripe:payout:po_manual_without_domain"
  );
});

test("manual payout accounting rejects metadata for another store", async () => {
  await assert.rejects(
    () =>
      handlePayoutPaid(
        {
          amount: 30_037,
          automatic: false,
          created: 1_786_634_763,
          id: "po_manual_without_domain",
          metadata: { domain: "another-store" },
        } as unknown as Stripe.Payout,
        makeDependencies()
      ),
    /unknown store/
  );
});
