import assert from "node:assert/strict";
import test from "node:test";
import reactRouterConfig, { actionOriginsFor } from "../react-router.config";
import {
  calculateSpecialOrderTotal,
  createSpecialOrderAccessToken,
  hashSpecialOrderAccessToken,
  readSpecialOrderAccessToken,
  resolveSpecialOrderFreightCost,
  specialOrderFormSchema,
} from "../app/services/special-order.server";
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
