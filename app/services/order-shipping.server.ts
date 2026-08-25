import mongoose from "mongoose";
import { Orders } from "~/schemas/orders";
import {
  deliverQueuedOrderEmail,
  ensureLegacyShippingDelivery,
  getLatestOrderEmailDelivery,
  queueOrderEmail,
} from "~/services/email-delivery.server";
import type { Order } from "~/types";

export class FinalSpecialOrderImageRequiredError extends Error {
  constructor() {
    super("Lägg till ett foto av den färdiga specialbeställningen innan den skickas.");
    this.name = "FinalSpecialOrderImageRequiredError";
  }
}

export async function markOrderShippedAndEmail(orderId: string) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) return null;
  const order = (await Orders.findById(orderId).lean()) as Order | null;
  if (!order) return null;

  if (
    order.kind === "SPECIAL" &&
    order.items.some((item) => !item.finalImage)
  ) {
    throw new FinalSpecialOrderImageRequiredError();
  }

  await Orders.updateOne(
    { _id: orderId },
    { $set: { status: "SHIPPED", updatedAt: new Date() } }
  );

  const existingDelivery =
    (await getLatestOrderEmailDelivery(orderId, "SHIPPING")) ??
    (await ensureLegacyShippingDelivery(order));
  if (existingDelivery) {
    return {
      delivery:
        existingDelivery.status === "PENDING"
          ? await deliverQueuedOrderEmail(String(existingDelivery._id))
          : existingDelivery,
      orderStatus: "SHIPPED" as const,
    };
  }

  const delivery = await queueOrderEmail({
    kind: "SHIPPING",
    orderId,
    recipient: order.customer.email,
  });
  if (!delivery) return { delivery: null, orderStatus: "SHIPPED" as const };

  return {
    delivery: await deliverQueuedOrderEmail(String(delivery._id)),
    orderStatus: "SHIPPED" as const,
  };
}

export async function markOrderNotShipped(orderId: string) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) return null;
  const order = (await Orders.findById(orderId).lean()) as Order | null;
  if (!order) return null;
  await ensureLegacyShippingDelivery(order);
  const status = order.paidReviewReason
    ? "PAID_REVIEW"
    : order.manualOrderAt
      ? "MANUAL_PROCESSING"
      : "SUCCESS";
  await Orders.updateOne(
    { _id: orderId },
    { $set: { status, updatedAt: new Date() } }
  );
  return status;
}
