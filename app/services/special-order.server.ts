import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { Orders } from "~/schemas/orders";
import { sessionSecret } from "~/services/session.server";
import type { Order } from "~/types";
import { archiveOrderImages } from "~/services/order-image-storage.server";
import getFreightCost from "~/utils/getFreightCost";
import {
  resolveSpecialOrderExpiry,
  specialOrderExpiryError,
} from "~/utils/specialOrderExpiry";
import { distinctAddressLine2 } from "~/utils/customerAddress";
import stripeClient from "~/stripeClient";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((value) => value || "");

const localizedNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (value) =>
      typeof value === "string"
        ? Number(value.replace(/\s/g, "").replace(",", "."))
        : value,
    schema
  );

export const specialOrderFormSchema = z.object({
  addressLine2: optionalText(160),
  city: optionalText(100),
  country: optionalText(80).transform((value) => value || "Sverige"),
  description: z
    .string()
    .trim()
    .min(1, "Skriv en kort beskrivning")
    .max(280, "Den korta beskrivningen får vara högst 280 tecken"),
  email: z.string().trim().email("Kontrollera e-postadressen").max(254),
  expiresAt: z.string().trim().superRefine((value, context) => {
    const message = specialOrderExpiryError(value);
    if (message) context.addIssue({ code: "custom", message });
  }),
  finalImage: optionalText(2_048),
  firstname: z.string().trim().min(1, "Fyll i förnamn").max(100),
  freightMode: z.enum(["AUTO", "CUSTOM"]).default("AUTO"),
  freightCost: localizedNumber(
    z.number().finite().min(0, "Frakten kan inte vara negativ").max(100_000)
  ),
  image: optionalText(2_048),
  lastname: z.string().trim().min(1, "Fyll i efternamn").max(100),
  longDescription: optionalText(4_000),
  name: z.string().trim().min(1, "Ge beställningen ett namn").max(180),
  phone: optionalText(40),
  postaddress: optionalText(200),
  price: localizedNumber(
    z.number().finite().positive("Priset måste vara högre än 0").max(1_000_000)
  ),
  quantity: localizedNumber(
    z.number().int("Antalet måste vara ett heltal").min(1, "Antalet måste vara minst 1").max(100)
  ),
  templateItemRef: optionalText(100).refine(
    (value) => !value || mongoose.Types.ObjectId.isValid(value),
    "Ogiltig referensprodukt"
  ),
  zipcode: optionalText(20),
});

export type SpecialOrderFormInput = z.infer<typeof specialOrderFormSchema>;

const cents = (value: number) => Math.round(value * 100);
const fromCents = (value: number) => value / 100;

export const calculateSpecialOrderTotal = (input: {
  freightCost: number;
  price: number;
  quantity: number;
}) => {
  const totalCents =
    cents(input.price) * input.quantity + cents(input.freightCost);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new Error("Special order total is invalid");
  }
  return fromCents(totalCents);
};

export const resolveSpecialOrderFreightCost = (input: {
  freightCost: number;
  freightMode: "AUTO" | "CUSTOM";
  price: number;
  quantity: number;
}) =>
  input.freightMode === "AUTO"
    ? getFreightCost(fromCents(cents(input.price) * input.quantity))
    : fromCents(cents(input.freightCost));

const draftData = (input: SpecialOrderFormInput) => {
  const expiry = resolveSpecialOrderExpiry(input.expiresAt);
  if (!expiry) throw new Error("Special order expiry is invalid");
  const freightCost = resolveSpecialOrderFreightCost(input);

  return {
    customer: {
      addressLine2: distinctAddressLine2(
        input.postaddress,
        input.addressLine2
      ),
      city: input.city,
      country: input.country,
      email: input.email,
      firstname: input.firstname,
      lastname: input.lastname,
      phone: input.phone,
      postaddress: input.postaddress,
      zipcode: input.zipcode,
    },
    discount: { amount: 0 },
    freightCost,
    items: [
      {
        additionalItems: [],
        description: input.description,
        finalImage: input.finalImage,
        image: input.image,
        inventoryMode: "UNTRACKED",
        longDescription: input.longDescription,
        name: input.name,
        price: fromCents(cents(input.price)),
        quantity: input.quantity,
        templateItemRef: input.templateItemRef,
      },
    ],
    kind: "SPECIAL",
    specialOrder: {
      expiresAt: expiry.expiresAt,
      expiryIncludesTime: expiry.includesTime,
      freightMode: input.freightMode,
    },
    totalSum: calculateSpecialOrderTotal({ ...input, freightCost }),
    updatedAt: new Date(),
  };
};

export async function createSpecialOrderDraft(input: SpecialOrderFormInput) {
  return Orders.create({
    ...draftData(input),
    createdAt: new Date(),
    status: "DRAFT",
  });
}

export async function updateSpecialOrderDraft(
  orderId: string,
  input: SpecialOrderFormInput
) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) return null;
  return Orders.findOneAndUpdate(
    { _id: orderId, kind: "SPECIAL", status: "DRAFT" },
    { $set: draftData(input) },
    { new: true }
  );
}

const accessPayload = (orderId: string, version: number) =>
  Buffer.from(JSON.stringify({ orderId, version }), "utf8").toString(
    "base64url"
  );

export const createSpecialOrderAccessToken = (
  orderId: string,
  version: number
) => {
  const payload = accessPayload(orderId, version);
  const signature = createHmac("sha256", sessionSecret)
    .update(`special-order:${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
};

export const hashSpecialOrderAccessToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const readSpecialOrderAccessToken = (token: string) => {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", sessionSecret)
    .update(`special-order:${payload}`)
    .digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      !mongoose.Types.ObjectId.isValid(parsed.orderId) ||
      !Number.isInteger(parsed.version) ||
      parsed.version < 1
    ) {
      return null;
    }
    return { orderId: String(parsed.orderId), version: Number(parsed.version) };
  } catch {
    return null;
  }
};

const safePublicOrigin = (value: string) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("Special order origin must use HTTP or HTTPS");
  }
  return url.origin;
};

export const specialOrderPublicUrl = (order: Pick<Order, "_id" | "specialOrder">) => {
  const version = order.specialOrder?.accessVersion;
  const origin = order.specialOrder?.publicOrigin;
  if (!version || !origin) throw new Error("Special order access is not configured");
  return `${safePublicOrigin(origin)}/special-order/${encodeURIComponent(
    createSpecialOrderAccessToken(String(order._id), version)
  )}`;
};

const activeInvitationStatuses = new Set<Order["status"]>([
  "AWAITING_CUSTOMER",
  "OPENED",
  "PENDING",
  "FAILED",
]);

const replaceableInvitationStatuses = new Set<Order["status"]>([
  ...activeInvitationStatuses,
  "CANCELED",
]);

export type SpecialOrderInvitationState =
  | "ACTIVE"
  | "EXPIRED"
  | "INACTIVE"
  | "REVOKED";

const currentInvitationConfiguration = (
  order: Pick<Order, "_id" | "specialOrder">
) => {
  const version = order.specialOrder?.accessVersion;
  const storedTokenHash = order.specialOrder?.publicTokenHash;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    !order.specialOrder?.publicOrigin ||
    !storedTokenHash
  ) {
    return null;
  }
  try {
    safePublicOrigin(order.specialOrder.publicOrigin);
    const token = createSpecialOrderAccessToken(String(order._id), version);
    return hashSpecialOrderAccessToken(token) === storedTokenHash
      ? { storedTokenHash, version }
      : null;
  } catch {
    return null;
  }
};

export const specialOrderInvitationState = (
  order: Pick<Order, "_id" | "kind" | "specialOrder" | "status">,
  now = new Date()
): SpecialOrderInvitationState => {
  if (order.kind !== "SPECIAL") return "INACTIVE";
  if (order.status === "CANCELED" && order.specialOrder?.revokedAt) {
    return "REVOKED";
  }
  if (
    !activeInvitationStatuses.has(order.status) ||
    !currentInvitationConfiguration(order)
  ) {
    return "INACTIVE";
  }
  const expiresAt = new Date(order.specialOrder?.expiresAt ?? 0);
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > now.getTime()
    ? "ACTIVE"
    : "EXPIRED";
};

export const canReplaceSpecialOrderInvitation = (
  order: Pick<Order, "kind" | "specialOrder" | "status">
) => {
  const version = order.specialOrder?.accessVersion;
  if (
    order.kind !== "SPECIAL" ||
    !replaceableInvitationStatuses.has(order.status) ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    !order.specialOrder?.publicOrigin
  ) {
    return false;
  }
  try {
    safePublicOrigin(order.specialOrder.publicOrigin);
    return true;
  } catch {
    return false;
  }
};

export const canShareSpecialOrderInvitation = (
  order: Pick<Order, "_id" | "kind" | "specialOrder" | "status">,
  now = new Date()
) => {
  return specialOrderInvitationState(order, now) === "ACTIVE";
};

export type SpecialOrderPublicLinkState =
  | "ACTIVE"
  | "COMPLETE"
  | "EXPIRED"
  | "INVALID"
  | "REPLACED"
  | "REVOKED"
  | "UNAVAILABLE";

export const resolveSpecialOrderPublicLinkState = (
  order: Pick<Order, "_id" | "kind" | "specialOrder" | "status">,
  token: string,
  now = new Date()
): SpecialOrderPublicLinkState => {
  const access = readSpecialOrderAccessToken(token);
  if (
    !access ||
    order.kind !== "SPECIAL" ||
    String(order._id) !== access.orderId
  ) {
    return "INVALID";
  }

  const currentVersion = order.specialOrder?.accessVersion;
  const currentHash = order.specialOrder?.publicTokenHash;
  const tokenIsCurrent =
    currentVersion === access.version &&
    Boolean(currentHash) &&
    hashSpecialOrderAccessToken(token) === currentHash;

  if (!tokenIsCurrent) {
    const matchingHistory = (order.specialOrder?.invitationHistory ?? [])
      .filter((entry) => entry.fromVersion === access.version)
      .at(-1);
    if (matchingHistory?.action === "REPLACED") return "REPLACED";
    if (matchingHistory?.action === "REVOKED") return "REVOKED";
    return "INVALID";
  }

  if (["SUCCESS", "PAID_REVIEW", "SHIPPED"].includes(String(order.status))) {
    return "COMPLETE";
  }
  const expiresAt = new Date(order.specialOrder?.expiresAt ?? 0);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    return "EXPIRED";
  }
  if (activeInvitationStatuses.has(order.status)) return "ACTIVE";
  if (order.status === "CANCELED" && order.specialOrder?.revokedAt) {
    return "REVOKED";
  }
  return "UNAVAILABLE";
};

export type SpecialOrderInvitationLifecycleErrorCode =
  | "CONFLICT"
  | "INVALID_EXPIRY"
  | "NOT_AVAILABLE"
  | "PAYMENT_ALREADY_SUCCEEDED"
  | "PAYMENT_CANCEL_FAILED"
  | "PAYMENT_PROCESSING";

export class SpecialOrderInvitationLifecycleError extends Error {
  code: SpecialOrderInvitationLifecycleErrorCode;

  constructor(code: SpecialOrderInvitationLifecycleErrorCode, message: string) {
    super(message);
    this.name = "SpecialOrderInvitationLifecycleError";
    this.code = code;
  }
}

type PaymentIntentState = { id: string; status: string };
type InvitationUpdate = Record<string, unknown>;

export type SpecialOrderInvitationLifecycleDependencies = {
  cancelPaymentIntent: (id: string) => Promise<PaymentIntentState>;
  findOrder: (
    orderId: string,
    statuses: NonNullable<Order["status"]>[]
  ) => Promise<Order | null>;
  newCheckoutToken: () => string;
  now: () => Date;
  retrievePaymentIntent: (id: string) => Promise<PaymentIntentState>;
  updateOrder: (input: {
    expectedPaymentIntentId?: string;
    expectedPublicTokenHash?: string;
    expectedStatus: NonNullable<Order["status"]>;
    expectedVersion: number;
    orderId: string;
    update: InvitationUpdate;
  }) => Promise<Order | null>;
};

const defaultInvitationLifecycleDependencies: SpecialOrderInvitationLifecycleDependencies = {
  cancelPaymentIntent: async (id) => {
    const intent = await stripeClient.paymentIntents.cancel(id);
    return { id: intent.id, status: intent.status };
  },
  findOrder: async (orderId, statuses) =>
    (await Orders.findOne({
      _id: orderId,
      kind: "SPECIAL",
      status: { $in: statuses },
    }).lean()) as Order | null,
  newCheckoutToken: () => randomUUID(),
  now: () => new Date(),
  retrievePaymentIntent: async (id) => {
    const intent = await stripeClient.paymentIntents.retrieve(id);
    return { id: intent.id, status: intent.status };
  },
  updateOrder: async ({
    expectedPaymentIntentId,
    expectedPublicTokenHash,
    expectedStatus,
    expectedVersion,
    orderId,
    update,
  }) => {
    const query: Record<string, unknown> = {
      _id: orderId,
      kind: "SPECIAL",
      "specialOrder.accessVersion": expectedVersion,
      status: expectedPaymentIntentId
        ? { $in: [expectedStatus, "CANCELED"] }
        : expectedStatus,
    };
    query["paymentIntent.id"] = expectedPaymentIntentId
      ? expectedPaymentIntentId
      : { $exists: false };
    query["specialOrder.publicTokenHash"] = expectedPublicTokenHash
      ? expectedPublicTokenHash
      : { $exists: false };
    return (await Orders.findOneAndUpdate(query, update, { new: true }).lean()) as
      | Order
      | null;
  },
};

const lifecycleDependencies = (
  overrides?: Partial<SpecialOrderInvitationLifecycleDependencies>
) => ({ ...defaultInvitationLifecycleDependencies, ...overrides });

const cancelOutstandingSpecialOrderPayment = async (
  order: Order,
  dependencies: SpecialOrderInvitationLifecycleDependencies
) => {
  const paymentIntentId = order.paymentIntent?.id;
  if (!paymentIntentId) return undefined;

  const intent = await dependencies.retrievePaymentIntent(paymentIntentId);
  if (intent.status === "succeeded") {
    throw new SpecialOrderInvitationLifecycleError(
      "PAYMENT_ALREADY_SUCCEEDED",
      "The special order has already been paid"
    );
  }
  if (intent.status === "processing") {
    throw new SpecialOrderInvitationLifecycleError(
      "PAYMENT_PROCESSING",
      "The special-order payment is still processing"
    );
  }
  if (intent.status === "canceled") return paymentIntentId;

  try {
    const canceled = await dependencies.cancelPaymentIntent(paymentIntentId);
    if (canceled.status !== "canceled") {
      throw new Error(`Unexpected PaymentIntent status: ${canceled.status}`);
    }
    return paymentIntentId;
  } catch (error) {
    const latest = await dependencies.retrievePaymentIntent(paymentIntentId);
    if (latest.status === "canceled") return paymentIntentId;
    if (latest.status === "succeeded") {
      throw new SpecialOrderInvitationLifecycleError(
        "PAYMENT_ALREADY_SUCCEEDED",
        "The special order was paid while the invitation was being changed"
      );
    }
    if (latest.status === "processing") {
      throw new SpecialOrderInvitationLifecycleError(
        "PAYMENT_PROCESSING",
        "The special-order payment is still processing"
      );
    }
    throw new SpecialOrderInvitationLifecycleError(
      "PAYMENT_CANCEL_FAILED",
      error instanceof Error ? error.message : "The payment could not be canceled"
    );
  }
};

const invitationHistoryUpdate = (entry: {
  action: "REVOKED" | "REPLACED";
  at: Date;
  fromVersion: number;
  paymentIntentId?: string;
  toVersion?: number;
}) => ({
  $each: [entry],
  $slice: -20,
});

export const revokeSpecialOrderInvitation = async (
  orderId: string,
  overrides?: Partial<SpecialOrderInvitationLifecycleDependencies>
) => {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new SpecialOrderInvitationLifecycleError(
      "NOT_AVAILABLE",
      "The special-order invitation was not found"
    );
  }
  const dependencies = lifecycleDependencies(overrides);
  const order = await dependencies.findOrder(
    orderId,
    Array.from(activeInvitationStatuses) as NonNullable<Order["status"]>[]
  );
  const configuration = order ? currentInvitationConfiguration(order) : null;
  if (!order || !configuration) {
    throw new SpecialOrderInvitationLifecycleError(
      "NOT_AVAILABLE",
      "The special-order invitation is no longer active"
    );
  }

  const paymentIntentId = await cancelOutstandingSpecialOrderPayment(
    order,
    dependencies
  );
  const now = dependencies.now();
  const updated = await dependencies.updateOrder({
    expectedPaymentIntentId: order.paymentIntent?.id,
    expectedPublicTokenHash: configuration.storedTokenHash,
    expectedStatus: order.status as NonNullable<Order["status"]>,
    expectedVersion: configuration.version,
    orderId,
    update: {
      $push: {
        "specialOrder.invitationHistory": invitationHistoryUpdate({
          action: "REVOKED",
          at: now,
          fromVersion: configuration.version,
          paymentIntentId,
        }),
      },
      $set: {
        "specialOrder.revokedAt": now,
        status: "CANCELED",
        updatedAt: now,
      },
      $unset: {
        paidReviewReason: "",
        paymentIntent: "",
        "specialOrder.publicTokenHash": "",
      },
    },
  });
  if (!updated) {
    throw new SpecialOrderInvitationLifecycleError(
      "CONFLICT",
      "The special-order invitation changed while it was being revoked"
    );
  }
  return updated;
};

export const replaceSpecialOrderInvitation = async (
  input: { expiresAt: string; orderId: string },
  overrides?: Partial<SpecialOrderInvitationLifecycleDependencies>
) => {
  if (!mongoose.Types.ObjectId.isValid(input.orderId)) {
    throw new SpecialOrderInvitationLifecycleError(
      "NOT_AVAILABLE",
      "The special-order invitation was not found"
    );
  }
  const dependencies = lifecycleDependencies(overrides);
  const now = dependencies.now();
  const expiry = resolveSpecialOrderExpiry(input.expiresAt);
  if (!expiry || specialOrderExpiryError(input.expiresAt, now)) {
    throw new SpecialOrderInvitationLifecycleError(
      "INVALID_EXPIRY",
      "The replacement expiry is invalid"
    );
  }
  const statuses = Array.from(
    replaceableInvitationStatuses
  ) as NonNullable<Order["status"]>[];
  const order = await dependencies.findOrder(input.orderId, statuses);
  const version = order?.specialOrder?.accessVersion;
  if (
    !order ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    !canReplaceSpecialOrderInvitation(order)
  ) {
    throw new SpecialOrderInvitationLifecycleError(
      "NOT_AVAILABLE",
      "The special-order invitation cannot be replaced"
    );
  }

  const paymentIntentId = await cancelOutstandingSpecialOrderPayment(
    order,
    dependencies
  );
  const nextVersion = version + 1;
  const token = createSpecialOrderAccessToken(input.orderId, nextVersion);
  const updated = await dependencies.updateOrder({
    expectedPaymentIntentId: order.paymentIntent?.id,
    expectedPublicTokenHash: order.specialOrder?.publicTokenHash,
    expectedStatus: order.status as NonNullable<Order["status"]>,
    expectedVersion: version,
    orderId: input.orderId,
    update: {
      $push: {
        "specialOrder.invitationHistory": invitationHistoryUpdate({
          action: "REPLACED",
          at: now,
          fromVersion: version,
          paymentIntentId,
          toVersion: nextVersion,
        }),
      },
      $set: {
        checkoutToken: dependencies.newCheckoutToken(),
        "specialOrder.accessVersion": nextVersion,
        "specialOrder.expiresAt": expiry.expiresAt,
        "specialOrder.expiryIncludesTime": expiry.includesTime,
        "specialOrder.lockedAt": now,
        "specialOrder.publicTokenHash": hashSpecialOrderAccessToken(token),
        "specialOrder.replacedAt": now,
        status: "AWAITING_CUSTOMER",
        updatedAt: now,
      },
      $unset: {
        paidReviewReason: "",
        paymentIntent: "",
        "specialOrder.addressConfirmedAt": "",
        "specialOrder.revokedAt": "",
        "specialOrder.termsAcceptedAt": "",
        webhookAt: "",
      },
    },
  });
  if (!updated) {
    throw new SpecialOrderInvitationLifecycleError(
      "CONFLICT",
      "The special-order invitation changed while it was being replaced"
    );
  }
  return updated;
};

export async function lockAndSendSpecialOrder(input: {
  expiresAt: string;
  orderId: string;
  publicOrigin: string;
}) {
  if (!mongoose.Types.ObjectId.isValid(input.orderId)) return null;
  const existing = (await Orders.findOne({
    _id: input.orderId,
    kind: "SPECIAL",
    status: "DRAFT",
  }).lean()) as Order | null;
  if (!existing) return null;

  const now = new Date();
  const expiry = resolveSpecialOrderExpiry(input.expiresAt);
  if (!expiry || specialOrderExpiryError(input.expiresAt, now)) return null;
  const version = Number(existing.specialOrder?.accessVersion ?? 0) + 1;
  const token = createSpecialOrderAccessToken(input.orderId, version);
  const updated = (await Orders.findOneAndUpdate(
    { _id: input.orderId, kind: "SPECIAL", status: "DRAFT" },
    {
      $set: {
        checkoutToken: existing.checkoutToken || randomUUID(),
        specialOrder: {
          ...existing.specialOrder,
          accessVersion: version,
          expiresAt: expiry.expiresAt,
          expiryIncludesTime: expiry.includesTime,
          lockedAt: now,
          publicOrigin: safePublicOrigin(input.publicOrigin),
          publicTokenHash: hashSpecialOrderAccessToken(token),
          sentAt: now,
        },
        status: "AWAITING_CUSTOMER",
        updatedAt: now,
      },
    },
    { new: true }
  ).lean()) as Order | null;
  if (updated) await archiveOrderImages(updated);
  return updated;
}
