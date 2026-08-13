import Stripe from "stripe";
import {
  getConfiguredStripeApiVersion,
  toStripeSdkApiVersion,
  type SupportedStripeRequestApiVersion,
} from "~/services/stripe-config.server";

export const stripeApiVersion = getConfiguredStripeApiVersion();

export const createStripeClient = (
  secretKey = process.env.STRIPE_SRV || "",
  apiVersion: SupportedStripeRequestApiVersion = stripeApiVersion
) =>
  new Stripe(secretKey, {
    apiVersion: toStripeSdkApiVersion(apiVersion),
  });

const stripeClient = createStripeClient();

export default stripeClient;
