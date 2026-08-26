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
const EMAIL_PENDING_RECOVERY_DELAY_MS = 60 * 1000;
const globalForEmailDeliveryRecovery = globalThis as typeof globalThis & {
  __moaEmailDeliveryRecovery?: EmailDeliveryRecoveryState;
};
const emailDeliveryRecoveryState =
  globalForEmailDeliveryRecovery.__moaEmailDeliveryRecovery ??
  (globalForEmailDeliveryRecovery.__moaEmailDeliveryRecovery = {
    lastStartedAt: 0,
  });

type DeliverySender = typeof sendOrderEmail;

type EmailDeliveryModel = {
  findById(id: string): { lean(): Promise<unknown> };
  find(filter: Record<string, unknown>): {
    sort(sort: Record<string, number>): {
      limit(limit: number): { lean(): Promise<unknown[]> };
    };
  };
  findOne(filter: Record<string, unknown>): {
    lean(): Promise<unknown>;
    sort(sort: Record<string, number>): { lean(): Promise<unknown> };
  };
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>
  ): { lean(): Promise<unknown> };
  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<unknown>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<unknown>;
};

type OrderModel = {
  findById(id: string): { lean(): Promise<unknown> };
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<unknown>;
};

export type EmailDeliveryDependencies = {
  deliveries?: EmailDeliveryModel;
  now?: () => Date;
  orders?: OrderModel;
  randomId?: () => string;
};

const deliveryModel = (dependencies: EmailDeliveryDependencies) =>
  dependencies.deliveries ??
  (EmailDeliveries as unknown as EmailDeliveryModel);

const orderModel = (dependencies: EmailDeliveryDependencies) =>
  dependencies.orders ?? (Orders as unknown as OrderModel);

const now = (dependencies: EmailDeliveryDependencies) =>
  dependencies.now?.() ?? new Date();

const randomId = (dependencies: EmailDeliveryDependencies) =>
  dependencies.randomId?.() ?? randomUUID();

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

const duplicateKeyError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === 11000;

const errorProperty = (error: unknown, property: string) => {
  if (typeof error !== "object" || error === null || !(property in error)) {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[property];
  return typeof value === "string" || typeof value === "number"
    ? value
    : undefined;
};

/**
 * Only failures that prove SMTP never accepted the message are directly
 * retryable. Timeouts, socket failures during DATA and unknown transport
 * errors remain ambiguous to avoid presenting a potentially accepted message
 * as a safe retry.
 */
export function classifyEmailSendFailure(
  error: unknown
): Extract<EmailDeliveryStatus, "FAILED" | "UNKNOWN"> {
  const responseCode = errorProperty(error, "responseCode");
  if (
    typeof responseCode === "number" &&
    responseCode >= 400 &&
    responseCode <= 599
  ) {
    return "FAILED";
  }

  const code = String(errorProperty(error, "code") ?? "").toUpperCase();
  if (["EAUTH", "EENVELOPE", "EMESSAGE"].includes(code)) {
    return "FAILED";
  }

  const command = String(errorProperty(error, "command") ?? "").toUpperCase();
  if (
    ["CONN", "EHLO", "HELO", "AUTH", "MAIL FROM", "RCPT TO"].includes(
      command
    )
  ) {
    return "FAILED";
  }

  return "UNKNOWN";
}

const deliveryKey = (
  orderId: string,
  kind: EmailDeliveryKind,
  attempt: number
) => `${kind.toLocaleLowerCase("en-US")}:${orderId}:${attempt}`;

const toDelivery = (value: unknown) => value as OrderEmailDelivery | null;

export async function queueOrderEmail(
  input: {
    attempt?: number;
    kind: EmailDeliveryKind;
    orderId: string;
    recipient: string;
  },
  dependencies: EmailDeliveryDependencies = {}
) {
  const attempt = input.attempt ?? 1;
  const deduplicationKey = deliveryKey(input.orderId, input.kind, attempt);
  const deliveries = deliveryModel(dependencies);
  try {
    const delivery = await deliveries.findOneAndUpdate(
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
  } catch (error) {
    if (!duplicateKeyError(error)) throw error;

    // A competing request inserted the same deterministic first-send row.
    // Re-read it so both callers converge on the same atomic claim instead of
    // surfacing a harmless E11000 to one administrator.
    return toDelivery(await deliveries.findOne({ deduplicationKey }).lean());
  }
}

export async function getLatestOrderEmailDelivery(
  orderId: string,
  kind: EmailDeliveryKind,
  dependencies: EmailDeliveryDependencies = {}
) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) return null;
  return toDelivery(
    await deliveryModel(dependencies)
      .findOne({ kind, orderRef: orderId })
      .sort({ attempt: -1, createdAt: -1 })
      .lean()
  );
}

export async function ensureLegacyShippingDelivery(
  order: Pick<Order, "_id" | "shippingEmailAt" | "status">,
  dependencies: EmailDeliveryDependencies = {}
) {
  const orderId = String(order._id);
  const existing = await getLatestOrderEmailDelivery(
    orderId,
    "SHIPPING",
    dependencies
  );
  if (existing || (!order.shippingEmailAt && order.status !== "SHIPPED")) {
    return existing;
  }

  const status: EmailDeliveryStatus = order.shippingEmailAt ? "SENT" : "UNKNOWN";
  const deduplicationKey = `shipping:${orderId}:legacy`;
  const deliveries = deliveryModel(dependencies);
  try {
    const delivery = await deliveries.findOneAndUpdate(
      { deduplicationKey },
      {
        $setOnInsert: {
          attempt: 1,
          deduplicationKey,
          kind: "SHIPPING",
          lastError:
            status === "UNKNOWN"
              ? "Historiskt leveransbesked saknar säker leveransinformation."
              : undefined,
          orderRef: orderId,
          sentAt: order.shippingEmailAt
            ? new Date(order.shippingEmailAt)
            : undefined,
          status,
        },
      },
      { new: true, upsert: true }
    ).lean();
    return toDelivery(delivery);
  } catch (error) {
    if (!duplicateKeyError(error)) throw error;
    return toDelivery(await deliveries.findOne({ deduplicationKey }).lean());
  }
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
  sender: DeliverySender = sendOrderEmail,
  dependencies: EmailDeliveryDependencies = {}
) {
  if (!mongoose.Types.ObjectId.isValid(deliveryId)) return null;

  const deliveries = deliveryModel(dependencies);
  const orders = orderModel(dependencies);
  const claimToken = randomId(dependencies);
  const claimedAt = now(dependencies);
  const delivery = toDelivery(
    await deliveries.findOneAndUpdate(
      { _id: deliveryId, status: "PENDING" },
      {
        $set: { claimToken, claimedAt, status: "SENDING" },
        $unset: { lastError: "" },
      },
      { new: true }
    ).lean()
  );

  if (!delivery) {
    return toDelivery(await deliveries.findById(deliveryId).lean());
  }

  const order = (await orders.findById(delivery.orderRef).lean()) as Order | null;
  if (!order) {
    await deliveries.updateOne(
      { _id: deliveryId, claimToken, status: "SENDING" },
      { $set: { lastError: "Ordern kunde inte hittas", status: "FAILED" } }
    );
    return getDelivery(deliveryId, dependencies);
  }

  if (delivery.kind === "SHIPPING" && order.status !== "SHIPPED") {
    await deliveries.updateOne(
      { _id: deliveryId, claimToken, status: "SENDING" },
      {
        $set: { status: "PENDING" },
        $unset: { claimToken: "", claimedAt: "" },
      }
    );
    return getDelivery(deliveryId, dependencies);
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
    const status = classifyEmailSendFailure(error);
    await deliveries.updateOne(
      { _id: deliveryId, claimToken, status: "SENDING" },
      {
        $set: { lastError, status },
        $unset: { claimToken: "" },
      }
    );
    console.error("Email delivery failed", {
      attempt: delivery.attempt,
      deliveryId,
      error: lastError,
      kind: delivery.kind,
      orderId: String(order._id),
      status,
    });
    return getDelivery(deliveryId, dependencies);
  }

  let updated: unknown;
  try {
    updated = await deliveries.findOneAndUpdate(
      { _id: deliveryId, claimToken, status: "SENDING" },
      {
        $set: {
          providerMessageId: result.messageId,
          sentAt: now(dependencies),
          status: "SENT",
        },
        $unset: { claimToken: "", lastError: "" },
      },
      { new: true }
    ).lean();
  } catch (error) {
    await markDeliveryUnknownAfterAcceptedMessage({
      claimToken,
      delivery,
      deliveryId,
      error,
      dependencies,
    });
    console.error("Email delivery state became ambiguous after SMTP success", {
      attempt: delivery.attempt,
      deliveryId,
      error: safeErrorMessage(error),
      kind: delivery.kind,
      orderId: String(order._id),
    });
    return getDelivery(deliveryId, dependencies);
  }

  if (!updated) {
    await markDeliveryUnknownAfterAcceptedMessage({
      claimToken,
      delivery,
      deliveryId,
      error: new Error("The sent-state write matched no delivery"),
      dependencies,
    });
    console.error("Email delivery state became ambiguous after SMTP success", {
      attempt: delivery.attempt,
      deliveryId,
      kind: delivery.kind,
      orderId: String(order._id),
    });
    return getDelivery(deliveryId, dependencies);
  }

  try {
    if (delivery.kind === "SHIPPING") {
      await orders.updateOne(
        { _id: order._id },
        { $set: { shippingEmailAt: now(dependencies) } }
      );
    } else if (delivery.kind === "ORDER_CONFIRMATION") {
      await orders.updateOne(
        { _id: order._id },
        { $set: { orderConfirmationEmailAt: now(dependencies) } }
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
    attempt: delivery.attempt,
    deliveryId,
    kind: delivery.kind,
    orderId: String(order._id),
  });
  return toDelivery(updated);
}

export async function retryFailedOrderEmail(
  deliveryId: string,
  sender: DeliverySender = sendOrderEmail,
  dependencies: EmailDeliveryDependencies = {}
) {
  if (!mongoose.Types.ObjectId.isValid(deliveryId)) return null;
  const delivery = await deliveryModel(dependencies).findOneAndUpdate(
    { _id: deliveryId, status: "FAILED" },
    {
      $set: { status: "PENDING" },
      $unset: { claimToken: "", claimedAt: "", lastError: "" },
    },
    { new: true }
  ).lean();
  if (!delivery) return getDelivery(deliveryId, dependencies);
  return deliverQueuedOrderEmail(deliveryId, sender, dependencies);
}

export async function createDeliberateResend(
  input: {
    kind: EmailDeliveryKind;
    orderId: string;
    previousAttempt: number;
    recipient: string;
  },
  sender: DeliverySender = sendOrderEmail,
  dependencies: EmailDeliveryDependencies = {}
) {
  const queued = await queueOrderEmail(
    {
      attempt: input.previousAttempt + 1,
      kind: input.kind,
      orderId: input.orderId,
      recipient: input.recipient,
    },
    dependencies
  );
  if (!queued) return null;
  return deliverQueuedOrderEmail(String(queued._id), sender, dependencies);
}

export async function recoverStaleEmailDeliveries(
  staleBefore = new Date(Date.now() - 15 * 60 * 1000),
  dependencies: EmailDeliveryDependencies = {}
) {
  return deliveryModel(dependencies).updateMany(
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

export async function recoverPendingEmailDeliveries(
  pendingBefore = new Date(Date.now() - EMAIL_PENDING_RECOVERY_DELAY_MS),
  limit = 10,
  sender: DeliverySender = sendOrderEmail,
  dependencies: EmailDeliveryDependencies = {}
) {
  const pending = (await deliveryModel(dependencies)
    .find({ createdAt: { $lt: pendingBefore }, status: "PENDING" })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean()) as unknown as OrderEmailDelivery[];

  for (const delivery of pending) {
    try {
      await deliverQueuedOrderEmail(String(delivery._id), sender, dependencies);
    } catch (error) {
      console.error("Pending email delivery recovery failed", {
        attempt: delivery.attempt,
        deliveryId: String(delivery._id),
        error: safeErrorMessage(error),
        kind: delivery.kind,
        orderId: String(delivery.orderRef),
      });
    }
  }

  return pending.length;
}

async function markDeliveryUnknownAfterAcceptedMessage(input: {
  claimToken: string;
  delivery: OrderEmailDelivery;
  deliveryId: string;
  error: unknown;
  dependencies: EmailDeliveryDependencies;
}) {
  try {
    await deliveryModel(input.dependencies).updateOne(
      {
        _id: input.deliveryId,
        claimToken: input.claimToken,
        status: "SENDING",
      },
      {
        $set: {
          lastError:
            "Mejlservern accepterade utskicket, men leveransstatusen kunde inte sparas säkert.",
          status: "UNKNOWN",
        },
        $unset: { claimToken: "" },
      }
    );
  } catch (recoveryError) {
    console.error("Ambiguous email delivery could not be persisted", {
      attempt: input.delivery.attempt,
      deliveryId: input.deliveryId,
      error: safeErrorMessage(recoveryError),
      originalError: safeErrorMessage(input.error),
      kind: input.delivery.kind,
      orderId: input.delivery.orderRef,
    });
  }
}

export function scheduleEmailDeliveryRecovery() {
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
    .then(() => recoverPendingEmailDeliveries())
    .then(() => undefined)
    .catch((error) => {
      console.error("Email delivery recovery failed", {
        error: safeErrorMessage(error),
      });
    })
    .finally(() => {
      emailDeliveryRecoveryState.pending = undefined;
    });
}

async function getDelivery(
  deliveryId: string,
  dependencies: EmailDeliveryDependencies = {}
) {
  return toDelivery(
    await deliveryModel(dependencies).findById(deliveryId).lean()
  );
}
