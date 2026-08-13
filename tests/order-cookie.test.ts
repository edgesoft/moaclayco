import assert from "node:assert/strict";
import test from "node:test";
import { orderCookie } from "../app/services/order-cookie.server";

test("order cookie rejects a forged order id", async () => {
  const orderId = "64f10123456789abcdef0123";
  const cookieHeader = await orderCookie.serialize(orderId);

  assert.equal(await orderCookie.parse(cookieHeader), orderId);

  const tamperedHeader = cookieHeader.replace(
    /order=([^;]+)/,
    (_match, value: string) =>
      `order=${value.slice(0, -1)}${value.endsWith("a") ? "b" : "a"}`
  );
  assert.equal(await orderCookie.parse(tamperedHeader), null);
});
