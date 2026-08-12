import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import {
  assertPaymentIntentMatchesOrder,
  buildCheckoutPaymentIntent,
  checkoutAttemptCookie,
  createCheckoutAttemptToken,
  createCheckoutFingerprint,
} from "../app/services/checkout-payment.server";

const order = {
  _id: "64f10123456789abcdef0123",
  domain: "moaclayco",
  totalSum: 549,
};

test("checkout attempt cookie is signed and rejects tampering", async () => {
  const token = createCheckoutAttemptToken();
  const cookieHeader = await checkoutAttemptCookie.serialize(token);

  assert.equal(await checkoutAttemptCookie.parse(cookieHeader), token);

  const tamperedHeader = cookieHeader.replace(
    /checkout_attempt=([^;]+)/,
    (_match, value: string) =>
      `checkout_attempt=${value.slice(0, -1)}${
        value.endsWith("a") ? "b" : "a"
      }`
  );
  assert.equal(await checkoutAttemptCookie.parse(tamperedHeader), null);
});

test("duplicate checkout requests use the same Stripe idempotency key", () => {
  const checkoutToken = "d9428888-122b-4e80-a248-2eae9917c80f";
  const first = buildCheckoutPaymentIntent({
    checkoutToken,
    order,
    paymentMethods: ["card"],
  });
  const duplicate = buildCheckoutPaymentIntent({
    checkoutToken,
    order,
    paymentMethods: ["card"],
  });

  assert.deepEqual(duplicate, first);
  assert.equal(first.params.amount, 54_900);
  assert.equal(
    first.options.idempotencyKey,
    `checkout:${order.domain}:${checkoutToken}`
  );
});

test("checkout fingerprint changes when the order snapshot changes", () => {
  const original = createCheckoutFingerprint({ totalSum: 549, items: ["cup"] });
  const duplicate = createCheckoutFingerprint({ totalSum: 549, items: ["cup"] });
  const changed = createCheckoutFingerprint({ totalSum: 649, items: ["cup"] });

  assert.equal(duplicate, original);
  assert.notEqual(changed, original);
});

test("webhook validation rejects a PaymentIntent for another amount or order", () => {
  const paymentIntent = {
    amount: 54_900,
    currency: "sek",
    id: "pi_checkout",
    metadata: { domain: order.domain, orderId: String(order._id) },
  } as Pick<Stripe.PaymentIntent, "amount" | "currency" | "id" | "metadata">;

  assert.doesNotThrow(() =>
    assertPaymentIntentMatchesOrder({ order, paymentIntent })
  );
  assert.throws(
    () =>
      assertPaymentIntentMatchesOrder({
        order,
        paymentIntent: { ...paymentIntent, amount: 54_901 },
      }),
    /amount does not match/
  );
  assert.throws(
    () =>
      assertPaymentIntentMatchesOrder({
        order,
        paymentIntent: {
          ...paymentIntent,
          metadata: { ...paymentIntent.metadata, orderId: "another-order" },
        },
      }),
    /metadata does not match/
  );
});
