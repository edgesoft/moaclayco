import { MetaFunction } from "@remix-run/react";
import { Items } from "../schemas/items";
import { Orders } from "../schemas/orders";
import { Discounts } from "~/schemas/discounts";
import getFreightCost from "~/utils/getFreightCost";
import { ActionFunction, json, redirect } from "@remix-run/node";
import ClientOnly from "~/components/ClientOnly";
import { getDomain } from "~/utils/domain";
import { z } from "zod";
import mongoose from "mongoose";
import stripeClient from "~/stripeClient";
import { themes } from "~/components/Theme";
import type Stripe from "stripe";
import { orderCookie } from "~/services/order-cookie.server";
import CartView from "~/components/cart/CartView";

export let meta: MetaFunction = () => {
  return [
    {
      title: "Varukorg — Moa Clay Collection",
    },
    {
      name: "description",
      content: "Moa Clay Collection",
    },
  ];
};

enum ItemError {
  PRICE,
  BALANCE,
}

type ErrorItemVal = {
  [key: string]: {
    error: string;
    clientValue: string;
    serverValue: string;
    type: ItemError;
  };
};

const cartLineSchema = z
  .object({
    id: z.string().min(1).max(100),
    parentId: z.string().max(100).nullable().optional(),
    quantity: z.number().int().positive().max(100),
    price: z.number().finite().nonnegative().optional(),
  })
  .passthrough();

const cartSchema = z.array(cartLineSchema).min(1).max(500);

const customerSchema = z.object({
  firstname: z.string().trim().min(1).max(100),
  lastname: z.string().trim().min(1).max(100),
  postaddress: z.string().trim().min(1).max(200),
  zipcode: z.string().trim().min(1).max(20),
  city: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
});

const toCents = (amount: number) => Math.round(amount * 100);
const fromCents = (amount: number) => amount / 100;

const cartError = (message: string, items: true | ErrorItemVal = true) =>
  json(
    {
      key: Date.now(),
      errors: { items, message },
    },
    { status: 400 }
  );

export let action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const resolvedDomain = getDomain(request);
  if (!resolvedDomain || !themes[resolvedDomain.domain]) {
    throw new Response("Okänd butik", { status: 404 });
  }

  let untrustedItems: unknown;
  try {
    untrustedItems = JSON.parse(String(formData.get("items") ?? ""));
  } catch {
    return cartError("Kundvagnen kunde inte läsas. Ladda om sidan och försök igen.");
  }

  const parsedCart = cartSchema.safeParse(untrustedItems);
  const parsedCustomer = customerSchema.safeParse({
    firstname: formData.get("firstname"),
    lastname: formData.get("lastname"),
    postaddress: formData.get("postaddress"),
    zipcode: formData.get("zipcode"),
    city: formData.get("city"),
    email: formData.get("email"),
  });
  if (!parsedCart.success) {
    return cartError("Kundvagnen innehåller ogiltiga antal eller artiklar. Ladda om sidan.");
  }
  if (!parsedCustomer.success) {
    return cartError("Kontrollera att leveransadress och e-postadress är korrekt ifyllda.");
  }

  const data = parsedCart.data;
  const parentLines = data.filter((line) => !line.parentId);
  const childLines = data.filter((line) => Boolean(line.parentId));
  const parentIds = parentLines.map((line) => line.id);
  if (
    parentIds.length === 0 ||
    new Set(parentIds).size !== parentIds.length ||
    parentIds.some((id) => !mongoose.Types.ObjectId.isValid(id))
  ) {
    return cartError("Kundvagnen innehåller dubbla eller ogiltiga artiklar. Ladda om sidan.");
  }

  const products = await Items.find({
    _id: { $in: parentIds },
    domain: resolvedDomain.domain,
  })
    .select("headline price images amount collectionRef additionalItems")
    .lean();
  if (products.length !== parentLines.length) {
    return cartError("En eller flera artiklar finns inte längre kvar. Ladda om sidan.");
  }

  const productsById = new Map(
    products.map((product: any) => [String(product._id), product])
  );
  const itemErrors: ErrorItemVal = {};
  for (const line of parentLines) {
    const product: any = productsById.get(line.id);
    if (!product) continue;
    if (line.price !== undefined && toCents(line.price) !== toCents(product.price)) {
      itemErrors[line.id] = {
        error: "Priset är uppdaterat",
        clientValue: `${line.price}`,
        serverValue: `${product.price}`,
        type: ItemError.PRICE,
      };
    }
    if (line.quantity > product.amount) {
      itemErrors[line.id] = {
        error: "Saldot överstiger",
        clientValue: `${line.quantity}`,
        serverValue: `${product.amount}`,
        type: ItemError.BALANCE,
      };
    }
  }
  if (Object.keys(itemErrors).length > 0) {
    return cartError(itemErrors[Object.keys(itemErrors)[0]].error, itemErrors);
  }

  const seenChildIds = new Set<string>();
  const additionsByParent = new Map<string, Array<{
    name: string;
    price: number;
    packinfo: string;
  }>>();
  let merchandiseCents = 0;

  for (const line of parentLines) {
    const product: any = productsById.get(line.id);
    merchandiseCents += toCents(product.price) * line.quantity;
    additionsByParent.set(line.id, []);
  }

  for (const line of childLines) {
    const parts = line.id.split("_");
    const parentId = line.parentId ?? "";
    const parentLine = parentLines.find((parent) => parent.id === parentId);
    const product: any = productsById.get(parentId);
    const instanceIndex = Number(parts[1]);
    const additionalIndex = Number(parts[2]);
    const additionalItem = product?.additionalItems?.[additionalIndex];
    const isValidAddition =
      parts.length === 3 &&
      parts[0] === parentId &&
      line.quantity === 1 &&
      !seenChildIds.has(line.id) &&
      parentLine &&
      Number.isInteger(instanceIndex) &&
      instanceIndex >= 0 &&
      instanceIndex < parentLine.quantity &&
      Number.isInteger(additionalIndex) &&
      additionalIndex >= 0 &&
      additionalItem &&
      Number.isFinite(additionalItem.price) &&
      additionalItem.price >= 0;

    if (!isValidAddition) {
      return cartError("Ett tillval i kundvagnen är ogiltigt. Ladda om sidan.");
    }

    seenChildIds.add(line.id);
    merchandiseCents += toCents(additionalItem.price);
    additionsByParent.get(parentId)?.push({
      name: additionalItem.name,
      price: fromCents(toCents(additionalItem.price)),
      packinfo: `Till artikel ${instanceIndex + 1}`,
    });
  }

  const totalSum = fromCents(merchandiseCents);
  const freightCents = toCents(getFreightCost(totalSum));
  const discountCode = String(formData.get("discount") ?? "").trim();
  const now = new Date();
  const discount: any = discountCode
    ? await Discounts.findOne({
        domain: resolvedDomain.domain,
        code: discountCode,
        balance: { $gt: 0 },
        percentage: { $gt: 0, $lte: 100 },
        $or: [
          { expireAt: { $exists: false } },
          { expireAt: null },
          { expireAt: { $gt: now } },
        ],
      }).lean()
    : null;
  const discountCents = discount
    ? Math.min(
        merchandiseCents,
        Math.round(merchandiseCents * (discount.percentage / 100))
      )
    : 0;
  const orderTotalCents = merchandiseCents + freightCents - discountCents;
  if (!Number.isSafeInteger(orderTotalCents) || orderTotalCents <= 0) {
    return cartError("Ordersumman är ogiltig. Kontrollera kundvagnen och försök igen.");
  }

  const mappedItems = parentLines.map((line) => {
    const product: any = productsById.get(line.id);
    return {
      itemRef: line.id,
      name: product.headline,
      image: product.images?.[0] ?? "",
      price: fromCents(toCents(product.price)),
      quantity: line.quantity,
      additionalItems: additionsByParent.get(line.id) ?? [],
    };
  });

  const discountData = discount
    ? {
        code: discount.code,
        percentage: discount.percentage,
        amount: fromCents(discountCents),
      }
    : { amount: 0 };

  const orderData = {
    domain: resolvedDomain.domain,
    items: mappedItems,
    status: "OPENED",
    customer: parsedCustomer.data,
    totalSum: fromCents(orderTotalCents),
    freightCost: fromCents(freightCents),
    discount: discountData,
  };

  let order: any = null;
  const cookieOrderId = await orderCookie.parse(request.headers.get("Cookie"));
  if (mongoose.Types.ObjectId.isValid(String(cookieOrderId ?? ""))) {
    order = await Orders.findOne({
      _id: cookieOrderId,
      domain: resolvedDomain.domain,
      status: "OPENED",
      "paymentIntent.id": { $exists: false },
    });
    if (order) {
      order.set({ ...orderData, updatedAt: new Date() });
      await order.save();
    }
  }
  if (!order) {
    order = await Orders.create({
      createdAt: new Date(),
      ...orderData,
    });
  }

  const theme = themes[resolvedDomain.domain];
  const paymentIntentData: Stripe.PaymentIntentCreateParams = {
    amount: orderTotalCents,
    currency: "sek",
    payment_method_types:
      theme.paymentMethods as Stripe.PaymentIntentCreateParams["payment_method_types"],
    metadata: {
      domain: resolvedDomain.domain,
      orderId: String(order._id),
    },
  };
  const paymentIntent = await stripeClient.paymentIntents.create(paymentIntentData);
  if (!paymentIntent.client_secret) {
    throw new Response("Betalningen kunde inte startas", { status: 502 });
  }
  order.set({
    status: "PENDING",
    updatedAt: new Date(),
    paymentIntent: {
      id: paymentIntent.id,
      client_secret: paymentIntent.client_secret,
    },
  });
  await order.save();

  return redirect(`/checkout?order=${order._id}`, {
    headers: {
      "Set-Cookie": await orderCookie.serialize(String(order._id)),
    },
  });
};

export default function Index() {
  return <ClientOnly fallback={null}>{() => <CartView />}</ClientOnly>;
}
