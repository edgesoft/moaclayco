import mongoose from "mongoose";
import { Orders } from "~/schemas/orders";
import {
  deliverQueuedOrderEmail,
  ensureLegacyShippingDelivery,
  getLatestOrderEmailDelivery,
  queueOrderEmail,
  type OrderEmailDelivery,
} from "~/services/email-delivery.server";
import type { Order } from "~/types";

export class FinalSpecialOrderImageRequiredError extends Error {
  constructor() {
    super("Lägg till ett foto av den färdiga specialbeställningen innan den skickas.");
    this.name = "FinalSpecialOrderImageRequiredError";
  }
}

type OrderShippingDependencies = {
  deliver(deliveryId: string): Promise<OrderEmailDelivery | null>;
  ensureLegacy(
    order: Pick<Order, "_id" | "shippingEmailAt" | "status">
  ): Promise<OrderEmailDelivery | null>;
  findOrder(orderId: string): Promise<Order | null>;
  getLatest(orderId: string): Promise<OrderEmailDelivery | null>;
  queue(input: {
    kind: "SHIPPING";
    orderId: string;
    recipient: string;
  }): Promise<OrderEmailDelivery | null>;
  updateStatus(orderId: string, status: Order["status"]): Promise<void>;
};

export function createOrderShippingService(
  dependencies: OrderShippingDependencies
) {
  const markShippedAndEmail = async (orderId: string) => {
    if (!mongoose.Types.ObjectId.isValid(orderId)) return null;
    const order = await dependencies.findOrder(orderId);
    if (!order) return null;

    if (
      order.kind === "SPECIAL" &&
      order.items.some((item) => !item.finalImage)
    ) {
      throw new FinalSpecialOrderImageRequiredError();
    }

    // Persist the deterministic outbox row before changing the order status.
    // If the process stops between these operations, the next request reuses
    // the pending row. The delivery worker also refuses to send shipping mail
    // until it observes SHIPPED on the order.
    const existingDelivery =
      (await dependencies.getLatest(orderId)) ??
      (await dependencies.ensureLegacy(order));
    const delivery =
      existingDelivery ??
      (await dependencies.queue({
        kind: "SHIPPING",
        orderId,
        recipient: order.customer.email,
      }));

    if (!delivery) {
      throw new Error("Leveransmejlet kunde inte läggas i utkorgen");
    }

    await dependencies.updateStatus(orderId, "SHIPPED");
    return {
      delivery:
        delivery.status === "PENDING"
          ? await dependencies.deliver(String(delivery._id))
          : delivery,
      orderStatus: "SHIPPED" as const,
    };
  };

  const markNotShipped = async (orderId: string) => {
    if (!mongoose.Types.ObjectId.isValid(orderId)) return null;
    const order = await dependencies.findOrder(orderId);
    if (!order) return null;
    await dependencies.ensureLegacy(order);
    const status = order.paidReviewReason
      ? "PAID_REVIEW"
      : order.manualOrderAt
        ? "MANUAL_PROCESSING"
        : "SUCCESS";
    await dependencies.updateStatus(orderId, status);
    return status;
  };

  return { markNotShipped, markShippedAndEmail };
}

const orderShippingService = createOrderShippingService({
  deliver: (deliveryId) => deliverQueuedOrderEmail(deliveryId),
  ensureLegacy: (order) => ensureLegacyShippingDelivery(order),
  findOrder: async (orderId) =>
    (await Orders.findById(orderId).lean()) as Order | null,
  getLatest: (orderId) =>
    getLatestOrderEmailDelivery(orderId, "SHIPPING"),
  queue: (input) => queueOrderEmail(input),
  updateStatus: async (orderId, status) => {
    await Orders.updateOne(
      { _id: orderId },
      { $set: { status, updatedAt: new Date() } }
    );
  },
});

export async function markOrderShippedAndEmail(orderId: string) {
  return orderShippingService.markShippedAndEmail(orderId);
}

export async function markOrderNotShipped(orderId: string) {
  return orderShippingService.markNotShipped(orderId);
}
