import assert from "node:assert/strict";
import test from "node:test";
import {
  CollectionOrderConflictError,
  CollectionOrderValidationError,
  parseCollectionOrder,
  persistCollectionOrder,
  type CollectionOrderDependencies,
} from "../app/services/collection-order.server";

const firstId = "64b7f3aa50f6cb2f16ab0001";
const secondId = "64b7f3aa50f6cb2f16ab0002";
const thirdId = "64b7f3aa50f6cb2f16ab0003";

test("collection order parsing accepts a unique list of Mongo ids", () => {
  assert.deepEqual(
    parseCollectionOrder(JSON.stringify([secondId, firstId])),
    [secondId, firstId]
  );
});

test("collection order parsing rejects malformed and duplicate values", () => {
  assert.throws(
    () => parseCollectionOrder("not-json"),
    CollectionOrderValidationError
  );
  assert.throws(
    () => parseCollectionOrder(JSON.stringify([firstId, firstId])),
    CollectionOrderValidationError
  );
  assert.throws(
    () => parseCollectionOrder(JSON.stringify(["wanja"])),
    CollectionOrderValidationError
  );
});

test("collection ordering writes one contiguous order and invalidates the cache", async () => {
  const events: string[] = [];
  let writtenOrder: string[] = [];
  const session = {
    endSession: async () => {
      events.push("session:end");
    },
    withTransaction: async (work: () => Promise<void>) => {
      events.push("transaction:start");
      await work();
      events.push("transaction:commit");
    },
  };
  const dependencies: CollectionOrderDependencies = {
    invalidate: () => events.push("cache:invalidate"),
    listCollectionIds: async () => [firstId, secondId, thirdId],
    startSession: async () => session,
    updateCollectionOrder: async (order) => {
      writtenOrder = order;
      events.push("collections:update");
      return order.length;
    },
  };

  await persistCollectionOrder([thirdId, firstId, secondId], dependencies);

  assert.deepEqual(writtenOrder, [thirdId, firstId, secondId]);
  assert.deepEqual(events, [
    "transaction:start",
    "collections:update",
    "transaction:commit",
    "session:end",
    "cache:invalidate",
  ]);
});

test("collection ordering refuses a stale list", async () => {
  let updated = false;
  let invalidated = false;
  let ended = false;
  const dependencies: CollectionOrderDependencies = {
    invalidate: () => {
      invalidated = true;
    },
    listCollectionIds: async () => [firstId, secondId, thirdId],
    startSession: async () => ({
      endSession: async () => {
        ended = true;
      },
      withTransaction: async (work) => work(),
    }),
    updateCollectionOrder: async () => {
      updated = true;
      return 2;
    },
  };

  await assert.rejects(
    persistCollectionOrder([firstId, secondId], dependencies),
    CollectionOrderConflictError
  );
  assert.equal(updated, false);
  assert.equal(invalidated, false);
  assert.equal(ended, true);
});
