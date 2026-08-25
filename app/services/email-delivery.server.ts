import { createHash, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { Template } from "~/components/mail/order";
import { EmailDeliveries } from "~/schemas/email-deliveries";
import { Orders } from "~/schemas/orders";
import { sendOrderEmail } from "~/services/order-email.server";
import { specialOrderPublicUrl } from "~/services/special-order.server";
import type { Order } from "~/types";

export type EmailDeliveryKind =
  | "ORDER_CONFIRMATION"
  | "SHIPPING"
  | "SPECIAL_ORDER_INVITATION";

export type EmailDeliveryStatus =
  | "PENDING"
  | "SENDING"
  | "SENT"
  | "FAILED"
  | "UNKNOWN";

export type OrderEmailDelivery = {
  _id: string;
  attempt: number;
  claimedAt?: Date;
  createdAt?: Date;
  kind: EmailDeliveryKind;
  lastError?: string;
  orderRef: string;
  providerMessageId?: string;
  sentAt?: Date;
  status: EmailDeliveryStatus;
  updatedAt?: Date;
};

type EmailDeliveryRecoveryState = {
  lastStartedAt: number;
  pending?: Promise<void>;
};

const EMAIL_DELIVERY_RECOVERY_INTERVAL_MS = 5 * 60 * 1000;
const globalForEmailDeliveryRecovery = globalThis as typeof globalThis & {
  __moaEmailDeliveryRecovery?: EmailDeliveryRecoveryState;
};
const emailDeliveryRecoveryState =
  globalForEmailDeliveryRecovery.__moaEmailDeliveryRecovery ??
  (globalForEmailDeliveryRecovery.__moaEmailDeliveryRecovery = {
    lastStartedAt: 0,
  });

type DeliverySender = typeof sendOrderEmail;

const templateFor = (kind: EmailDeliveryKind) => {
  if (kind === "ORDER_CONFIRMATION") return Template.ORDER;
  if (kind === "SPECIAL_ORDER_INVITATION") {
    return Template.SPECIAL_INVITATION;
  }
  return Template.SHIPPING;
};

const recipientFingerprint = (email: string) =>
  createHash("sha256")
    .update(email.trim().toLocaleLowerCase("sv-SE"))
    .digest("hex")
    .slice(0, 16);

const safeErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Okänt mejlfel";
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .slice(0, 500);
};

const deliveryKey = (
  orderId: string,
  kind: EmailDeliveryKind,
  attempt: number
) => `${kind.toLocaleLowerCase("en-US")}:${orderId}:${attempt}`;

const toDelivery = (value: unknown) => value as OrderEmailDelivery | null;

export async function queueOrderEmail(input: {
  attempt?: number;
  kind: EmailDeliveryKind;
  orderId: string;
  recipient: string;
}) {
  const attempt = input.attempt ?? 1;
  const deduplicationKey = deliveryKey(input.orderId, input.kind, attempt);
  const delivery = await EmailDeliveries.findOneAndUpdate(
    { deduplicationKey },
    {
      $setOnInsert: {
        attempt,
        deduplicationKey,
        kind: input.kind,
        orderRef: input.orderId,
        recipientFingerprint: recipientFingerprint(input.recipient),
        status: "PENDING",
      },
    },
    { new: true, upsert: true }
  ).lean();

  return toDelivery(delivery);
}

export async function getLatestOrderEmailDelivery(
  orderId: string,
  kind: EmailDeliveryKind
) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) return null;
  return toDelivery(
    await EmailDeliveries.findOne({ kind, orderRef: orderId })
      .sort({ attempt: -1, createdAt: -1 })
      .lean()
  );
}

export async function ensureLegacyShippingDelivery(
  order: Pick<Order, "_id" | "shippingEmailAt" | "status">
) {
  const orderId = String(order._id);
  const existing = await getLatestOrderEmailDelivery(orderId, "SHIPPING");
  if (existing || (!order.shippingEmailAt && order.status !== "SHIPPED")) {
    return existing;
  }

  const status: EmailDeliveryStatus = order.shippingEmailAt ? "SENT" : "UNKNOWN";
  const delivery = await EmailDeliveries.findOneAndUpdate(
    { deduplicationKey: `shipping:${orderId}:legacy` },
    {
      $setOnInsert: {
        attempt: 1,
        deduplicationKey: `shipping:${orderId}:legacy`,
        kind: "SHIPPING",
        lastError:
          status === "UNKNOWN"
            ? "Historiskt leveransbesked saknar säker leveransinformation."
            : undefined,
        orderRef: orderId,
        sentAt: order.shippingEmailAt ? new Date(order.shippingEmailAt) : undefined,
        status,
      },
    },
    { new: true, upsert: true }
  ).lean();
  return toDelivery(delivery);
}

export function legacyShippingDeliveryView(
  order: Pick<Order, "_id" | "shippingEmailAt" | "status">
): OrderEmailDelivery | null {
  if (!order.shippingEmailAt && order.status !== "SHIPPED") return null;

  const orderId = String(order._id);
  const status: EmailDeliveryStatus = order.shippingEmailAt ? "SENT" : "UNKNOWN";
  return {
    _id: `legacy-shipping-${orderId}`,
    attempt: 1,
    kind: "SHIPPING",
    lastError:
      status === "UNKNOWN"
        ? "Historiskt leveransbesked saknar säker leveransinformation."
        : undefined,
    orderRef: orderId,
    sentAt: order.shippingEmailAt ? new Date(order.shippingEmailAt) : undefined,
    status,
  };
}

export async function deliverQueuedOrderEmail(
  deliveryId: string,
  sender: DeliverySender = sendOrderEmail
) {
  if (!mongoose.Types.ObjectId.isValid(deliveryId)) return null;

  const claimToken = randomUUID();
  const claimedAt = new Date();
  const delivery = toDelivery(
    await EmailDeliveries.findOneAndUpdate(
      { _id: deliveryId, status: "PENDING" },
      {
        $set: { claimToken, claimedAt, status: "SENDING" },
        $unset: { lastError: "" },
      },
      { new: true }
    ).lean()
  );

  if (!delivery) {
    return toDelivery(await EmailDeliveries.findById(deliveryId).lean());
  }

  const order = (await Orders.findById(delivery.orderRef).lean()) as Order | null;
  if (!order) {
    await EmailDeliveries.updateOne(
      { _id: deliveryId, claimToken, status: "SENDING" },
      { $set: { lastError: "Ordern kunde inte hittas", status: "FAILED" } }
    );
    return getDelivery(deliveryId);
  }

  let result: { messageId?: string };
  try {
    const actionUrl =
      delivery.kind === "SPECIAL_ORDER_INVITATION"
        ? specialOrderPublicUrl(order)
        : undefined;
    result = await sender(
      order,
      templateFor(delivery.kind),
      undefined,
      { actionUrl, deliveryAttempt: delivery.attempt }
    );
  } catch (error) {
    const lastError = safeErrorMessage(error);
    await EmailDeliveries.updateOne(
      { _id: deliveryId, claimToken, status: "SENDING" },
      {
        $set: { lastError, status: "FAILED" },
        $unset: { claimToken: "" },
      }
    );
    console.error("Email delivery failed", {
      deliveryId,
      error: lastError,
      kind: delivery.kind,
      orderId: String(order._id),
    });
    return getDelivery(deliveryId);
  }

  let updated: unknown;
  try {
    updated = await EmailDeliveries.findOneAndUpdate(
      { _id: deliveryId, claimToken, status: "SENDING" },
      {
        $set: {
          providerMessageId: result.messageId,
          sentAt: new Date(),
          status: "SENT",
        },
        $unset: { claimToken: "", lastError: "" },
      },
      { new: true }
    ).lean();
  } catch (error) {
    console.error("Email delivery state became ambiguous after SMTP success", {
      deliveryId,
      error: safeErrorMessage(error),
      kind: delivery.kind,
      orderId: String(order._id),
    });
    return getDelivery(deliveryId);
  }

  if (!updated) {
    console.error("Email delivery state became ambiguous after SMTP success", {
      deliveryId,
      kind: delivery.kind,
      orderId: String(order._id),
    });
    return getDelivery(deliveryId);
  }

  try {
    if (delivery.kind === "SHIPPING") {
      await Orders.updateOne(
        { _id: order._id },
        { $set: { shippingEmailAt: new Date() } }
      );
    } else if (delivery.kind === "ORDER_CONFIRMATION") {
      await Orders.updateOne(
        { _id: order._id },
        { $set: { orderConfirmationEmailAt: new Date() } }
      );
    }
  } catch (error) {
    console.error("Legacy email timestamp could not be updated", {
      deliveryId,
      error: safeErrorMessage(error),
      kind: delivery.kind,
      orderId: String(order._id),
    });
  }

  console.info("Email delivery sent", {
    deliveryId,
    kind: delivery.kind,
    orderId: String(order._id),
  });
  return toDelivery(updated);
}

export async function retryFailedOrderEmail(deliveryId: string) {
  if (!mongoose.Types.ObjectId.isValid(deliveryId)) return null;
  const delivery = await EmailDeliveries.findOneAndUpdate(
    { _id: deliveryId, status: "FAILED" },
    {
      $set: { status: "PENDING" },
      $unset: { claimToken: "", claimedAt: "", lastError: "" },
    },
    { new: true }
  ).lean();
  if (!delivery) return getDelivery(deliveryId);
  return deliverQueuedOrderEmail(deliveryId);
}

export async function createDeliberateResend(input: {
  kind: EmailDeliveryKind;
  orderId: string;
  recipient: string;
}) {
  const latest = await getLatestOrderEmailDelivery(input.orderId, input.kind);
  const queued = await queueOrderEmail({
    ...input,
    attempt: (latest?.attempt ?? 0) + 1,
  });
  if (!queued) return null;
  return deliverQueuedOrderEmail(String(queued._id));
}

export async function recoverStaleEmailDeliveries(
  staleBefore = new Date(Date.now() - 15 * 60 * 1000)
) {
  return EmailDeliveries.updateMany(
    { claimedAt: { $lt: staleBefore }, status: "SENDING" },
    {
      $set: {
        lastError:
          "Leveransen avbröts efter att den skickats till mejlservern. Kontrollera innan nytt utskick.",
        status: "UNKNOWN",
      },
      $unset: { claimToken: "" },
    }
  );
}

export function scheduleStaleEmailDeliveryRecovery() {
  const now = Date.now();
  if (
    emailDeliveryRecoveryState.pending ||
    now - emailDeliveryRecoveryState.lastStartedAt <
      EMAIL_DELIVERY_RECOVERY_INTERVAL_MS
  ) {
    return;
  }

  emailDeliveryRecoveryState.lastStartedAt = now;
  emailDeliveryRecoveryState.pending = recoverStaleEmailDeliveries()
    .then(() => undefined)
    .catch((error) => {
      console.error("Stale email delivery recovery failed", error);
    })
    .finally(() => {
      emailDeliveryRecoveryState.pending = undefined;
    });
}

async function getDelivery(deliveryId: string) {
  return toDelivery(await EmailDeliveries.findById(deliveryId).lean());
}
