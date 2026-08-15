import type {
  ActionFunction,
  LoaderFunction,
  MetaFunction,
} from "react-router";
import { Items } from "../schemas/items";
import { Orders } from "../schemas/orders";
import { Discounts } from "~/schemas/discounts";
import getFreightCost from "~/utils/getFreightCost";
import { data as json, redirect } from "react-router";
import ClientOnly from "~/components/ClientOnly";
import { z } from "zod";
import mongoose from "mongoose";
import stripeClient from "~/stripeClient";
import { theme } from "~/components/Theme";
import { orderCookie } from "~/services/order-cookie.server";
import { archiveOrderImages } from "~/services/order-image-storage.server";
import CartView from "~/components/cart/CartView";
import {
  buildCheckoutPaymentIntent,
  checkoutAttemptCookie,
  createCheckoutAttemptToken,
  createCheckoutFingerprint,
  isCheckoutAttemptToken,
} from "~/services/checkout-payment.server";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";
import { activeCatalogItemFilter } from "~/utils/catalogItems.server";

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

const cartError = (
  message: string,
  items: true | ErrorItemVal = true,
  init: ResponseInit = {}
) =>
  json(
    {
      key: Date.now(),
      errors: { items, message },
    },
    { ...init, status: init.status ?? 400 }
  );

const isDuplicateKeyError = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
  );

export const loader: LoaderFunction = async ({ request }) => {
  const checkoutToken = await checkoutAttemptCookie.parse(
    request.headers.get("Cookie")
  );
  if (isCheckoutAttemptToken(checkoutToken)) return json({});

  return json(
    {},
    {
      headers: {
        "Set-Cookie": await checkoutAttemptCookie.serialize(
          createCheckoutAttemptToken()
        ),
      },
    }
  );
};

const redirectToCheckout = async (orderId: string) => {
  const headers = new Headers();
  headers.append("Set-Cookie", await orderCookie.serialize(orderId));
  headers.append(
    "Set-Cookie",
    await checkoutAttemptCookie.serialize("", { maxAge: 0 })
  );
  return redirect(`/checkout?order=${orderId}`, { headers });
};

export let action: ActionFunction = async ({ request }) => {
  const checkoutToken = await checkoutAttemptCookie.parse(
    request.headers.get("Cookie")
  );
  if (!isCheckoutAttemptToken(checkoutToken)) {
    return cartError(
      "Betalningssessionen saknas. Försök igen.",
      true,
      {
        status: 409,
        headers: {
          "Set-Cookie": await checkoutAttemptCookie.serialize(
            createCheckoutAttemptToken()
          ),
        },
      }
    );
  }

  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(
      request,
      MAX_STANDARD_FORM_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return cartError("Kundvagnen innehåller för mycket data.", true, {
        status: 413,
      });
    }
    throw error;
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
    ...activeCatalogItemFilter,
    _id: { $in: parentIds },
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
    items: mappedItems,
    status: "OPENED",
    customer: parsedCustomer.data,
    totalSum: fromCents(orderTotalCents),
    freightCost: fromCents(freightCents),
    discount: discountData,
  };

  const checkoutFingerprint = createCheckoutFingerprint(orderData);
  let order: any;
  // Index creation errors must not be mistaken for an upsert race.
  await Orders.init();
  try {
    order = await Orders.findOneAndUpdate(
      { checkoutToken },
      {
        $setOnInsert: {
          ...orderData,
          checkoutFingerprint,
          checkoutToken,
          createdAt: new Date(),
        },
      },
      { new: true, setDefaultsOnInsert: true, upsert: true }
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    order = await Orders.findOne({
      checkoutToken,
    });
  }

  if (!order) throw new Error("Checkout order could not be created");
  if (
    order.checkoutFingerprint !== checkoutFingerprint ||
    !["OPENED", "PENDING"].includes(order.status)
  ) {
    return cartError(
      "Kundvagnen ändrades under betalningsförsöket. Kontrollera uppgifterna och försök igen.",
      true,
      {
        status: 409,
        headers: {
          "Set-Cookie": await checkoutAttemptCookie.serialize(
            createCheckoutAttemptToken()
          ),
        },
      }
    );
  }

  // Order rows must point to a permanent snapshot before payment and email.
  // If S3 is temporarily unavailable, the original URL remains as a safe fallback.
  await archiveOrderImages(order);

  if (order.paymentIntent?.client_secret) {
    return redirectToCheckout(String(order._id));
  }

  const paymentIntentRequest = buildCheckoutPaymentIntent({
    checkoutToken,
    order,
    paymentMethods: theme.paymentMethods,
  });
  const paymentIntent = await stripeClient.paymentIntents.create(
    paymentIntentRequest.params,
    paymentIntentRequest.options
  );
  if (!paymentIntent.client_secret) {
    throw new Response("Betalningen kunde inte startas", { status: 502 });
  }

  const updatedOrder = await Orders.findOneAndUpdate(
    {
      _id: order._id,
      checkoutFingerprint,
      checkoutToken,
      status: "OPENED",
      "paymentIntent.id": { $exists: false },
    },
    {
      $set: {
        status: "PENDING",
        updatedAt: new Date(),
        paymentIntent: {
          id: paymentIntent.id,
          client_secret: paymentIntent.client_secret,
        },
      },
    },
    { new: true }
  );
  const persistedOrder =
    updatedOrder ??
    (await Orders.findOne({
      _id: order._id,
      checkoutToken,
    }));
  if (persistedOrder?.paymentIntent?.id !== paymentIntent.id) {
    throw new Error(
      `PaymentIntent ${paymentIntent.id} could not be attached to order ${String(
        order._id
      )}`
    );
  }

  return redirectToCheckout(String(order._id));
};

export default function Index() {
  return <ClientOnly fallback={null}>{() => <CartView />}</ClientOnly>;
}
