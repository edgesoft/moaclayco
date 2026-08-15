import assert from "node:assert/strict";
import test from "node:test";
import {
  CollectionRemovalConflictError,
  CollectionRemovalUndoConflictError,
  CollectionRemovalUndoExpiredError,
  CollectionRemovalValidationError,
  parseCollectionRemovalPlan,
  removeCollectionWithPlan,
  undoCollectionRemoval,
  type CollectionRemovalDependencies,
  type CollectionRemovalDecision,
} from "../app/services/collection-removal.server";

const firstItemId = "64b7f3aa50f6cb2f16ab0101";
const secondItemId = "64b7f3aa50f6cb2f16ab0102";
const operationId = "4e022f4d-17e8-4f57-9837-2926c32b7f9e";
const now = new Date("2026-08-15T08:00:00.000Z");

const decisions: CollectionRemovalDecision[] = [
  {
    action: "move",
    itemId: firstItemId,
    targetCollectionRef: "siv",
  },
  { action: "retire", itemId: secondItemId },
];

function makeDependencies(
  overrides: Partial<CollectionRemovalDependencies> = {}
): CollectionRemovalDependencies {
  return {
    applyDecisions: async ({ decisions: received }) => received.length,
    archiveCollection: async () => true,
    createOperationId: () => operationId,
    findActiveItems: async () => [
      { _id: firstItemId, images: ["https://cdn.test/items/first.webp"] },
      { _id: secondItemId, images: ["https://cdn.test/items/second.webp"] },
    ],
    findCollection: async () => ({
      _id: "64b7f3aa50f6cb2f16ab0001",
      shortUrl: "wanja",
    }),
    findUndoCollection: async () => ({
      _id: "64b7f3aa50f6cb2f16ab0001",
      deletionDecisions: decisions,
      deletionUndoExpiresAt: new Date(now.getTime() + 5_000),
      shortUrl: "wanja",
    }),
    invalidate: () => undefined,
    listTargetCollectionRefs: async (refs) => refs,
    now: () => now,
    restoreCollection: async () => true,
    restoreItems: async ({ decisions: received }) => received.length,
    retainOrderImages: async () => new Set(),
    startSession: async () => ({
      endSession: async () => undefined,
      withTransaction: async (work) => work(),
    }),
    ...overrides,
  };
}

test("collection removal parsing accepts one decision per product", () => {
  assert.deepEqual(parseCollectionRemovalPlan(JSON.stringify(decisions)), decisions);
});

test("collection removal parsing rejects malformed and duplicate decisions", () => {
  assert.throws(
    () => parseCollectionRemovalPlan("not-json"),
    CollectionRemovalValidationError
  );
  assert.throws(
    () =>
      parseCollectionRemovalPlan(
        JSON.stringify([decisions[0], { ...decisions[0], action: "retire" }])
      ),
    CollectionRemovalValidationError
  );
});

test("collection removal archives a reversible operation in one transaction", async () => {
  const events: string[] = [];
  let applied: CollectionRemovalDecision[] = [];
  let archived: CollectionRemovalDecision[] = [];
  let retainedIds: string[] = [];

  const result = await removeCollectionWithPlan(
    { collectionRef: "wanja", decisions },
    makeDependencies({
      applyDecisions: async ({ decisions: received }) => {
        events.push("items:update");
        applied = received;
        return received.length;
      },
      archiveCollection: async ({ decisions: received }) => {
        events.push("collection:archive");
        archived = received;
        return true;
      },
      invalidate: () => events.push("cache:invalidate"),
      retainOrderImages: async (ids) => {
        events.push("orders:archive");
        retainedIds = ids;
        return new Set();
      },
      startSession: async () => ({
        endSession: async () => {
          events.push("session:end");
        },
        withTransaction: async (work) => {
          events.push("transaction:start");
          const transactionResult = await work();
          events.push("transaction:commit");
          return transactionResult;
        },
      }),
    })
  );

  assert.deepEqual(result, {
    collectionRef: "wanja",
    movedCount: 1,
    operationId,
    retiredCount: 1,
    undoExpiresAt: new Date(now.getTime() + 10_000),
  });
  assert.deepEqual(applied, decisions);
  assert.deepEqual(archived, decisions);
  assert.deepEqual(retainedIds, [secondItemId]);
  assert.deepEqual(events, [
    "orders:archive",
    "transaction:start",
    "items:update",
    "collection:archive",
    "transaction:commit",
    "session:end",
    "cache:invalidate",
  ]);
});

test("collection removal never overlaps operations on one transaction session", async () => {
  let sessionOperationActive = false;
  const guardSessionOperation = async <T>(value: T) => {
    if (sessionOperationActive) {
      throw new Error("overlapping transaction operation");
    }
    sessionOperationActive = true;
    await new Promise<void>((resolve) => setImmediate(resolve));
    sessionOperationActive = false;
    return value;
  };

  await removeCollectionWithPlan(
    { collectionRef: "wanja", decisions },
    makeDependencies({
      findActiveItems: async (_collectionRef, session) =>
        session
          ? guardSessionOperation([
              { _id: firstItemId },
              { _id: secondItemId },
            ])
          : [{ _id: firstItemId }, { _id: secondItemId }],
      findCollection: async (_collectionRef, session) =>
        session
          ? guardSessionOperation({
              _id: "64b7f3aa50f6cb2f16ab0001",
              shortUrl: "wanja",
            })
          : {
              _id: "64b7f3aa50f6cb2f16ab0001",
              shortUrl: "wanja",
            },
      listTargetCollectionRefs: async (refs) =>
        guardSessionOperation(refs),
    })
  );

  assert.equal(sessionOperationActive, false);
});

test("collection removal refuses a product list that changed after opening", async () => {
  let itemRead = 0;
  let applied = false;
  const dependencies = makeDependencies({
    applyDecisions: async () => {
      applied = true;
      return 2;
    },
    findActiveItems: async () => {
      itemRead += 1;
      return itemRead === 1
        ? [{ _id: firstItemId }, { _id: secondItemId }]
        : [
            { _id: firstItemId },
            { _id: secondItemId },
            { _id: "64b7f3aa50f6cb2f16ab0103" },
          ];
    },
  });

  await assert.rejects(
    removeCollectionWithPlan(
      { collectionRef: "wanja", decisions },
      dependencies
    ),
    CollectionRemovalConflictError
  );
  assert.equal(applied, false);
});

test("collection removal refuses a destination that disappeared", async () => {
  await assert.rejects(
    removeCollectionWithPlan(
      { collectionRef: "wanja", decisions },
      makeDependencies({ listTargetCollectionRefs: async () => [] })
    ),
    CollectionRemovalConflictError
  );
});

test("undo restores every product before reactivating the Collection", async () => {
  const events: string[] = [];
  const result = await undoCollectionRemoval(
    operationId,
    makeDependencies({
      invalidate: () => events.push("cache:invalidate"),
      restoreCollection: async () => {
        events.push("collection:restore");
        return true;
      },
      restoreItems: async ({ decisions: received }) => {
        events.push("items:restore");
        return received.length;
      },
      startSession: async () => ({
        endSession: async () => {
          events.push("session:end");
        },
        withTransaction: async (work) => {
          events.push("transaction:start");
          const transactionResult = await work();
          events.push("transaction:commit");
          return transactionResult;
        },
      }),
    })
  );

  assert.deepEqual(result, { collectionRef: "wanja" });
  assert.deepEqual(events, [
    "transaction:start",
    "items:restore",
    "collection:restore",
    "transaction:commit",
    "session:end",
    "cache:invalidate",
  ]);
});

test("undo expires after ten seconds", async () => {
  await assert.rejects(
    undoCollectionRemoval(
      operationId,
      makeDependencies({
        findUndoCollection: async () => ({
          _id: "64b7f3aa50f6cb2f16ab0001",
          deletionDecisions: decisions,
          deletionUndoExpiresAt: new Date(now.getTime() - 1),
          shortUrl: "wanja",
        }),
      })
    ),
    CollectionRemovalUndoExpiredError
  );
});

test("undo refuses to overwrite a product changed after deletion", async () => {
  let collectionRestored = false;
  await assert.rejects(
    undoCollectionRemoval(
      operationId,
      makeDependencies({
        restoreCollection: async () => {
          collectionRestored = true;
          return true;
        },
        restoreItems: async () => decisions.length - 1,
      })
    ),
    CollectionRemovalUndoConflictError
  );
  assert.equal(collectionRestored, false);
});
