import assert from "node:assert/strict";
import test from "node:test";
import reactRouterConfig, { actionOriginsFor } from "../react-router.config";
import {
  calculateSpecialOrderTotal,
  canReplaceSpecialOrderInvitation,
  canShareSpecialOrderInvitation,
  createSpecialOrderAccessToken,
  hashSpecialOrderAccessToken,
  readSpecialOrderAccessToken,
  replaceSpecialOrderInvitation,
  resolveSpecialOrderPublicLinkState,
  resolveSpecialOrderFreightCost,
  revokeSpecialOrderInvitation,
  SpecialOrderInvitationLifecycleError,
  specialOrderInvitationState,
  specialOrderFormSchema,
  specialOrderPublicUrl,
} from "../app/services/special-order.server";
import type {
  SpecialOrderInvitationLifecycleDependencies,
} from "../app/services/special-order.server";
import type { Order } from "../app/types";
import {
  specialOrderSourceImage,
  specialOrderSourceImages,
} from "../app/services/special-order-admin.server";
import {
  resolveSpecialOrderExpiry,
  specialOrderExpiryError,
  specialOrderExpiryFormValue,
  specialOrderExpiryFromDays,
} from "../app/utils/specialOrderExpiry";

const orderId = "64f10123456789abcdef0999";

const invitationOrder = (
  overrides: Partial<Order> = {}
): Order => {
  const version = overrides.specialOrder?.accessVersion ?? 3;
  return {
    _id: orderId,
    checkoutToken: "checkout-original",
    customer: {
      city: "Järfälla",
      email: "wicket.programmer@gmail.com",
      firstname: "Mathias",
      lastname: "Nilsson",
      postaddress: "Datavägen 2A",
      zipcode: "175 43",
    },
    discount: {
      amount: 0,
      code: undefined,
      percentage: undefined,
    },
    freightCost: 0,
    items: [
      {
        _id: "64f10123456789abcdef0888",
        additionalItems: [],
        image: "",
        name: "Wanja 2.0",
        price: 329,
        quantity: 1,
      },
    ],
    kind: "SPECIAL",
    status: "AWAITING_CUSTOMER",
    totalSum: 329,
    ...overrides,
    specialOrder: {
      accessVersion: version,
      expiresAt: "2026-09-01T21:59:00.000Z",
      publicOrigin: "https://moaclayco-stage.fly.dev",
      publicTokenHash: hashSpecialOrderAccessToken(
        createSpecialOrderAccessToken(orderId, version)
      ),
      ...overrides.specialOrder,
    },
  };
};

test("trusted special-order action origins are explicit and never wildcarded", () => {
  assert.ok(reactRouterConfig.allowedActionOrigins.includes("localhost:5175"));
  assert.ok(reactRouterConfig.allowedActionOrigins.includes("null"));
  assert.ok(
    reactRouterConfig.allowedActionOrigins.includes("moaclayco-stage.fly.dev")
  );
  assert.equal(
    reactRouterConfig.allowedActionOrigins.some((origin) => origin.includes("*")),
    false
  );
  assert.equal(actionOriginsFor("production").includes("localhost:5175"), false);
  assert.equal(actionOriginsFor("production").includes("null"), false);
});

test("special-order access tokens are signed, stable and reject tampering", () => {
  const token = createSpecialOrderAccessToken(orderId, 3);
  assert.deepEqual(readSpecialOrderAccessToken(token), { orderId, version: 3 });
  assert.equal(hashSpecialOrderAccessToken(token).length, 64);

  const [payload, signature] = token.split(".");
  assert.equal(readSpecialOrderAccessToken(`${payload}.${signature.slice(0, -1)}x`), null);
  assert.equal(readSpecialOrderAccessToken(`${payload}.invalid`), null);
});

test("active special-order invitations expose their existing signed URL to admin", () => {
  const specialOrder = {
    _id: orderId,
    kind: "SPECIAL" as const,
    specialOrder: {
      accessVersion: 3,
      expiresAt: "2026-09-01T20:00:00.000Z",
      publicOrigin: "https://moaclayco-stage.fly.dev",
      publicTokenHash: hashSpecialOrderAccessToken(
        createSpecialOrderAccessToken(orderId, 3)
      ),
    },
    status: "AWAITING_CUSTOMER" as const,
  };

  const now = new Date("2026-08-26T10:00:00.000Z");
  assert.equal(canShareSpecialOrderInvitation(specialOrder, now), true);
  const url = new URL(specialOrderPublicUrl(specialOrder));
  assert.equal(url.origin, "https://moaclayco-stage.fly.dev");
  const token = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
  assert.deepEqual(readSpecialOrderAccessToken(token), {
    orderId,
    version: 3,
  });

  assert.equal(
    canShareSpecialOrderInvitation({ ...specialOrder, status: "SUCCESS" }, now),
    false
  );
  assert.equal(
    canShareSpecialOrderInvitation({
      ...specialOrder,
      specialOrder: {
        ...specialOrder.specialOrder,
        publicTokenHash: "stale-token-hash",
      },
    }, now),
    false
  );
  assert.equal(
    canShareSpecialOrderInvitation({
      ...specialOrder,
      specialOrder: {
        ...specialOrder.specialOrder,
        expiresAt: "2026-08-25T20:00:00.000Z",
      },
    }, now),
    false
  );
});

test("special-order links explain expired, replaced and revoked states", () => {
  const now = new Date("2026-08-26T10:00:00.000Z");
  const currentToken = createSpecialOrderAccessToken(orderId, 3);
  const activeOrder = invitationOrder();

  assert.equal(specialOrderInvitationState(activeOrder, now), "ACTIVE");
  assert.equal(
    resolveSpecialOrderPublicLinkState(activeOrder, currentToken, now),
    "ACTIVE"
  );
  assert.equal(canReplaceSpecialOrderInvitation(activeOrder), true);

  const expiredOrder = invitationOrder({
    specialOrder: {
      ...activeOrder.specialOrder,
      expiresAt: "2026-08-25T20:00:00.000Z",
    },
  });
  assert.equal(specialOrderInvitationState(expiredOrder, now), "EXPIRED");
  assert.equal(
    resolveSpecialOrderPublicLinkState(expiredOrder, currentToken, now),
    "EXPIRED"
  );

  const replacementToken = createSpecialOrderAccessToken(orderId, 4);
  const replacedOrder = invitationOrder({
    specialOrder: {
      ...activeOrder.specialOrder,
      accessVersion: 4,
      invitationHistory: [
        {
          action: "REPLACED",
          at: now,
          fromVersion: 3,
          toVersion: 4,
        },
      ],
      publicTokenHash: hashSpecialOrderAccessToken(replacementToken),
    },
  });
  assert.equal(
    resolveSpecialOrderPublicLinkState(replacedOrder, currentToken, now),
    "REPLACED"
  );
  assert.equal(
    resolveSpecialOrderPublicLinkState(replacedOrder, replacementToken, now),
    "ACTIVE"
  );

  const revokedOrder = invitationOrder({
    specialOrder: {
      ...activeOrder.specialOrder,
      invitationHistory: [
        {
          action: "REVOKED",
          at: now,
          fromVersion: 3,
        },
      ],
      publicTokenHash: undefined,
      revokedAt: now,
    },
    status: "CANCELED",
  });
  assert.equal(specialOrderInvitationState(revokedOrder, now), "REVOKED");
  assert.equal(
    resolveSpecialOrderPublicLinkState(revokedOrder, currentToken, now),
    "REVOKED"
  );
  assert.equal(canReplaceSpecialOrderInvitation(revokedOrder), true);
});

test("replacing a special-order link cancels payment and rotates every access credential", async () => {
  const now = new Date("2026-08-26T10:00:00.000Z");
  const order = invitationOrder({
    paymentIntent: {
      client_secret: "secret-original",
      id: "pi_original",
    },
  });
  let canceledIntent = "";
  let captured:
    | Parameters<SpecialOrderInvitationLifecycleDependencies["updateOrder"]>[0]
    | undefined;

  await replaceSpecialOrderInvitation(
    { expiresAt: "2026-09-01", orderId },
    {
      cancelPaymentIntent: async (id) => {
        canceledIntent = id;
        return { id, status: "canceled" };
      },
      findOrder: async () => order,
      newCheckoutToken: () => "checkout-replacement",
      now: () => now,
      retrievePaymentIntent: async (id) => ({
        id,
        status: "requires_payment_method",
      }),
      updateOrder: async (input) => {
        captured = input;
        return order;
      },
    }
  );

  assert.equal(canceledIntent, "pi_original");
  assert.equal(captured?.expectedPaymentIntentId, "pi_original");
  assert.equal(captured?.expectedVersion, 3);
  const update = captured?.update as {
    $push: Record<string, { $each: Array<Record<string, unknown>> }>;
    $set: Record<string, unknown>;
    $unset: Record<string, unknown>;
  };
  assert.equal(update.$set.checkoutToken, "checkout-replacement");
  assert.equal(update.$set["specialOrder.accessVersion"], 4);
  assert.equal(update.$set.status, "AWAITING_CUSTOMER");
  assert.equal(
    update.$set["specialOrder.publicTokenHash"],
    hashSpecialOrderAccessToken(createSpecialOrderAccessToken(orderId, 4))
  );
  assert.equal(update.$unset.paymentIntent, "");
  assert.equal(update.$unset["specialOrder.termsAcceptedAt"], "");
  assert.deepEqual(
    update.$push["specialOrder.invitationHistory"].$each[0],
    {
      action: "REPLACED",
      at: now,
      fromVersion: 3,
      paymentIntentId: "pi_original",
      toVersion: 4,
    }
  );
});

test("revoking a special-order link invalidates its public token", async () => {
  const now = new Date("2026-08-26T10:00:00.000Z");
  const order = invitationOrder();
  let captured:
    | Parameters<SpecialOrderInvitationLifecycleDependencies["updateOrder"]>[0]
    | undefined;

  await revokeSpecialOrderInvitation(orderId, {
    findOrder: async () => order,
    now: () => now,
    updateOrder: async (input) => {
      captured = input;
      return order;
    },
  });

  const update = captured?.update as {
    $push: Record<string, { $each: Array<Record<string, unknown>> }>;
    $set: Record<string, unknown>;
    $unset: Record<string, unknown>;
  };
  assert.equal(update.$set.status, "CANCELED");
  assert.equal(update.$set["specialOrder.revokedAt"], now);
  assert.equal(update.$unset["specialOrder.publicTokenHash"], "");
  assert.deepEqual(
    update.$push["specialOrder.invitationHistory"].$each[0],
    {
      action: "REVOKED",
      at: now,
      fromVersion: 3,
      paymentIntentId: undefined,
    }
  );
});

test("special-order links cannot change while Stripe is processing or after payment", async () => {
  const order = invitationOrder({
    paymentIntent: {
      client_secret: "secret-original",
      id: "pi_original",
    },
  });

  for (const [status, code] of [
    ["processing", "PAYMENT_PROCESSING"],
    ["succeeded", "PAYMENT_ALREADY_SUCCEEDED"],
  ] as const) {
    let updated = false;
    await assert.rejects(
      () =>
        replaceSpecialOrderInvitation(
          { expiresAt: "2026-09-01", orderId },
          {
            findOrder: async () => order,
            now: () => new Date("2026-08-26T10:00:00.000Z"),
            retrievePaymentIntent: async (id) => ({ id, status }),
            updateOrder: async () => {
              updated = true;
              return order;
            },
          }
        ),
      (error) =>
        error instanceof SpecialOrderInvitationLifecycleError &&
        error.code === code
    );
    assert.equal(updated, false);
  }
});

test("special-order totals stay precise and include quantity plus freight", () => {
  assert.equal(
    calculateSpecialOrderTotal({ freightCost: 49, price: 329.5, quantity: 2 }),
    708
  );
});

test("special-order sources use the first real product image", () => {
  assert.equal(specialOrderSourceImage([]), "");
  assert.equal(
    specialOrderSourceImage(["", "https://example.com/own.webp"]),
    "https://example.com/own.webp"
  );
});

test("special-order sources expose every distinct product image", () => {
  assert.deepEqual(
    specialOrderSourceImages([
      "",
      " https://example.com/front.webp ",
      "https://example.com/detail.webp",
      "https://example.com/front.webp",
    ]),
    ["https://example.com/front.webp", "https://example.com/detail.webp"]
  );
});

test("special-order form accepts Swedish decimal notation and optional address", () => {
  const parsed = specialOrderFormSchema.parse({
    description: "Handdrejad kopp i valfri färg",
    email: "kund@example.com",
    expiresAt: specialOrderExpiryFromDays(7),
    firstname: "Anna",
    freightCost: "49,50",
    lastname: "Andersson",
    name: "Annas specialkopp",
    price: "329,50",
    quantity: "2",
  });

  assert.equal(parsed.price, 329.5);
  assert.equal(parsed.freightCost, 49.5);
  assert.equal(parsed.freightMode, "AUTO");
  assert.equal(parsed.postaddress, "");
  assert.equal(parsed.country, "Sverige");
});

test("special-order freight follows the storefront rule unless it is overridden", () => {
  assert.equal(
    resolveSpecialOrderFreightCost({
      freightCost: 99,
      freightMode: "AUTO",
      price: 100,
      quantity: 2,
    }),
    24
  );
  assert.equal(
    resolveSpecialOrderFreightCost({
      freightCost: 99,
      freightMode: "AUTO",
      price: 150,
      quantity: 2,
    }),
    0
  );
  assert.equal(
    resolveSpecialOrderFreightCost({
      freightCost: 79.5,
      freightMode: "CUSTOM",
      price: 150,
      quantity: 2,
    }),
    79.5
  );
});

test("special-order expiry accepts a date with an optional Swedish clock time", () => {
  const now = new Date("2026-03-28T10:00:00.000Z");
  const expiry = specialOrderExpiryFromDays(7, now, "18:00");
  const dateOnlyExpiry = specialOrderExpiryFromDays(7, now);

  assert.equal(expiry, "2026-04-04 18:00");
  assert.equal(dateOnlyExpiry, "2026-04-04");
  assert.equal(specialOrderExpiryError(expiry, now), null);
  assert.equal(specialOrderExpiryError(dateOnlyExpiry, now), null);
  assert.equal(resolveSpecialOrderExpiry(expiry)?.includesTime, true);
  assert.equal(resolveSpecialOrderExpiry(dateOnlyExpiry)?.includesTime, false);
  assert.equal(
    specialOrderExpiryFormValue(
      resolveSpecialOrderExpiry(dateOnlyExpiry)?.expiresAt,
      true
    ),
    "2026-04-04 23:59"
  );
  assert.equal(
    specialOrderExpiryFormValue(
      resolveSpecialOrderExpiry(dateOnlyExpiry)?.expiresAt,
      false
    ),
    dateOnlyExpiry
  );
  assert.equal(
    specialOrderExpiryError("2026-03-28 09:00", now),
    "Slutdatumet måste ligga framåt i tiden"
  );
  assert.equal(
    specialOrderExpiryError("2026-03-27", now),
    "Slutdatumet måste ligga framåt i tiden"
  );
  assert.equal(
    specialOrderExpiryError("2026-05-01 18:00", now),
    "Länken kan vara giltig i högst 30 dagar"
  );
});
