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
