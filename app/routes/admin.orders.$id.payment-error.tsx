import { data as json } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Orders } from "~/schemas/orders";
import { auth } from "~/services/auth.server";
import stripeClient from "~/stripeClient";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });

  const order = await Orders.findById(params.id)
    .select("paymentIntent.id status")
    .lean<{ paymentIntent?: { id?: string }; status?: string }>();
  if (!order || order.status !== "FAILED" || !order.paymentIntent?.id) {
    return json({ message: null });
  }

  try {
    const intent = await stripeClient.paymentIntents.retrieve(
      order.paymentIntent.id
    );
    return json({ message: intent.last_payment_error?.message ?? null });
  } catch (error) {
    console.error("Stripe PaymentIntent could not be retrieved", {
      error,
      orderId: params.id,
    });
    return json({ message: null });
  }
};
