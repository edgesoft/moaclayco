import assert from "node:assert/strict";
import test from "node:test";
import Stripe from "stripe";
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
      `checkout_attempt=${value.startsWith("a") ? "b" : "a"}${value.slice(1)}`
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

test("Stripe SDK sends the checkout request with amount, metadata and idempotency", async () => {
  let captured:
    | {
        headers: Record<string, string | number | string[]>;
        method: string;
        path: string;
        requestData: string;
      }
    | undefined;
  const httpClient = {
    getClientName: () => "local-test-client",
    makeRequest: async (
      _host: string,
      _port: string,
      path: string,
      method: string,
      headers: Record<string, string | number | string[]>,
      requestData: string
    ) => {
      captured = { headers, method, path, requestData };
      return {
        getHeaders: () => ({ "request-id": "req_test" }),
        getRawResponse: () => ({}),
        getStatusCode: () => 200,
        toJSON: async () => ({
          amount: 54_900,
          client_secret: "pi_sdk_secret_test",
          currency: "sek",
          id: "pi_sdk_test",
          metadata: { domain: order.domain, orderId: order._id },
          object: "payment_intent",
          status: "requires_payment_method",
        }),
        toStream: () => undefined,
      };
    },
  };
  const stripe = new Stripe("sk_test_local", {
    apiVersion: "2023-08-16" as Stripe.LatestApiVersion,
    httpClient: httpClient as never,
    maxNetworkRetries: 0,
  });
  const request = buildCheckoutPaymentIntent({
    checkoutToken: "d9428888-122b-4e80-a248-2eae9917c80f",
    order,
    paymentMethods: ["card", "klarna"],
  });

  const intent = await stripe.paymentIntents.create(
    request.params,
    request.options
  );

  assert.equal(intent.id, "pi_sdk_test");
  assert.equal(captured?.method, "POST");
  assert.equal(captured?.path, "/v1/payment_intents");
  const params = new URLSearchParams(captured?.requestData);
  assert.equal(params.get("amount"), "54900");
  assert.equal(params.get("currency"), "sek");
  assert.equal(params.get("metadata[domain]"), order.domain);
  assert.equal(params.get("metadata[orderId]"), order._id);
  assert.deepEqual(params.getAll("payment_method_types[0]"), ["card"]);
  assert.deepEqual(params.getAll("payment_method_types[1]"), ["klarna"]);
  const idempotencyHeader = Object.entries(captured?.headers ?? {}).find(
    ([key]) => key.toLowerCase() === "idempotency-key"
  )?.[1];
  assert.equal(
    idempotencyHeader,
    `checkout:${order.domain}:d9428888-122b-4e80-a248-2eae9917c80f`
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
