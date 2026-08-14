import { createHash, randomUUID } from "node:crypto";
import { createCookie } from "react-router";
import type Stripe from "stripe";
import { sessionSecret } from "~/services/session.server";
import { STORE_ID } from "~/utils/store";

export const checkoutAttemptCookie = createCookie("checkout_attempt", {
  httpOnly: true,
  maxAge: 60 * 60,
  path: "/",
  sameSite: "lax",
  secrets: [sessionSecret],
  secure: process.env.NODE_ENV === "production",
});

export const createCheckoutAttemptToken = () => randomUUID();

export const isCheckoutAttemptToken = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

export const createCheckoutFingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

type CheckoutOrder = {
  _id: unknown;
  totalSum: number;
};

export const buildCheckoutPaymentIntent = ({
  checkoutToken,
  order,
  paymentMethods,
}: {
  checkoutToken: string;
  order: CheckoutOrder;
  paymentMethods: string[];
}) => {
  if (!isCheckoutAttemptToken(checkoutToken)) {
    throw new Error("Invalid checkout attempt token");
  }

  const amount = Math.round(order.totalSum * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Invalid checkout amount");
  }

  return {
    params: {
      amount,
      capture_method: "automatic",
      currency: "sek",
      payment_method_types: paymentMethods,
      metadata: {
        domain: STORE_ID,
        orderId: String(order._id),
      },
    } satisfies Stripe.PaymentIntentCreateParams,
    options: {
      idempotencyKey: `checkout:${STORE_ID}:${checkoutToken}`,
    } satisfies Stripe.RequestOptions,
  };
};

export const assertPaymentIntentMatchesOrder = ({
  order,
  paymentIntent,
}: {
  order: CheckoutOrder;
  paymentIntent: Pick<
    Stripe.PaymentIntent,
    "amount" | "currency" | "id" | "metadata"
  >;
}) => {
  const expectedAmount = Math.round(order.totalSum * 100);
  if (paymentIntent.amount !== expectedAmount) {
    throw new Error(
      `PaymentIntent ${paymentIntent.id} amount does not match order ${String(
        order._id
      )}`
    );
  }
  if (paymentIntent.currency.toLowerCase() !== "sek") {
    throw new Error(
      `PaymentIntent ${paymentIntent.id} currency does not match the order currency`
    );
  }
  if (
    paymentIntent.metadata.domain &&
    paymentIntent.metadata.domain !== STORE_ID
  ) {
    throw new Error(
      `PaymentIntent ${paymentIntent.id} domain does not match order ${String(
        order._id
      )}`
    );
  }
  if (
    paymentIntent.metadata.orderId &&
    paymentIntent.metadata.orderId !== String(order._id)
  ) {
    throw new Error(
      `PaymentIntent ${paymentIntent.id} metadata does not match order ${String(
        order._id
      )}`
    );
  }
};
