import Stripe from "stripe";

const stripeClient = new Stripe(process.env.STRIPE_SRV || "", {
  // Keep requests aligned with the separately versioned production webhook.
  // Upgrade both in Stripe Workbench before adopting the SDK's pinned API version.
  apiVersion: "2023-08-16" as Stripe.LatestApiVersion,
});

export default stripeClient;
