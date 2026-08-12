import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { toLoaderData } from "../app/utils/loaderData";

test("loader data converts nested Mongo ObjectIds and preserves dates", () => {
  const id = new Types.ObjectId("507f1f77bcf86cd799439011");
  const createdAt = new Date("2026-08-12T10:30:00.000Z");

  const result = toLoaderData({
    _id: id,
    createdAt,
    rows: [{ _id: id }],
  });

  assert.equal(result._id, id.toHexString());
  assert.equal(result.rows[0]._id, id.toHexString());
  assert.equal(result.createdAt, createdAt);
});

test("loader data unwraps document-like values before hydration", () => {
  const result = toLoaderData({
    toObject: () => ({ headline: "Wanja", image: "wanja.webp" }),
  });

  assert.deepEqual(result, { headline: "Wanja", image: "wanja.webp" });
});
