import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteItemWithAssets,
  type ItemDeletionDependencies,
} from "../app/services/item-deletion.server";

const itemId = "64f10123456789abcdef0123";

function makeDependencies(
  overrides: Partial<ItemDeletionDependencies> = {}
): ItemDeletionDependencies {
  return {
    archiveOrderImage: async () => undefined,
    deleteImageKeys: async () => undefined,
    deleteItem: async () => true,
    findItem: async () => ({
      _id: itemId,
      headline: "Wanja",
      images: [
        "https://38vabcm3.twic.pics/items-stage/wanja/first.webp",
        "https://38vabcm3.twic.pics/items-stage/old-name/second.webp?width=800",
        "https://38vabcm3.twic.pics/items-stage/wanja/unused.webp",
        "https://example.com/collections-stage/wanja/not-an-item.webp",
      ],
    }),
    findOrderImageReferences: async () => ({ orderCount: 2, references: [] }),
    getItemPath: () => "items-stage",
    getOrderImagePath: () => "order-images-stage",
    logCleanupError: () => undefined,
    replaceOrderImage: async () => true,
    startSession: async () => ({
      endSession: async () => undefined,
      withTransaction: async (callback) => callback(),
    }),
    ...overrides,
  };
}

test("product deletion archives ordered images and removes unreferenced keys", async () => {
  const archivedImages: Array<{ destinationKey: string; sourceKey: string }> = [];
  const events: string[] = [];
  let deletedInput: { collection: string; id: unknown } | undefined;
  let deletedKeys: string[] = [];
  const replacements: Array<{
    archivedUrl: string;
    itemId: string;
    orderId: string;
    sourceUrl: string;
  }> = [];

  const result = await deleteItemWithAssets(
    {
      collection: "wanja",
      id: itemId,
    },
    makeDependencies({
      archiveOrderImage: async (archive) => {
        events.push("archive");
        archivedImages.push(archive);
      },
      findOrderImageReferences: async (receivedItemId) => {
        events.push("orders");
        assert.equal(receivedItemId, itemId);
        return {
          orderCount: 2,
          references: [
            {
              imageUrl:
                "https://38vabcm3.twic.pics/items-stage/wanja/first.webp?width=480",
              orderId: "order-1",
              preserveSource: false,
            },
            {
              imageUrl:
                "https://38vabcm3.twic.pics/items-stage/old-name/second.webp",
              orderId: "order-2",
              preserveSource: false,
            },
          ],
        };
      },
      deleteImageKeys: async (keys) => {
        events.push("s3");
        deletedKeys = keys;
      },
      deleteItem: async (input) => {
        events.push("item");
        deletedInput = input;
        return true;
      },
      findItem: async () => {
        events.push("find");
        return {
          _id: itemId,
          images: [
            "https://38vabcm3.twic.pics/items-stage/wanja/first.webp",
            "https://38vabcm3.twic.pics/items-stage/old-name/second.webp?width=800",
            "https://38vabcm3.twic.pics/items-stage/wanja/unused.webp",
            "https://example.com/collections-stage/wanja/not-an-item.webp",
          ],
        };
      },
      replaceOrderImage: async (replacement) => {
        events.push("replace");
        replacements.push(replacement);
        return true;
      },
      startSession: async () => ({
        endSession: async () => {
          events.push("session-end");
        },
        withTransaction: async (callback) => {
          events.push("transaction-start");
          const transactionResult = await callback();
          events.push("transaction-end");
          return transactionResult;
        },
      }),
    })
  );

  assert.deepEqual(result, {
    affectedOrderCount: 2,
    deletedImageCount: 3,
    imageCleanup: "complete",
    status: "deleted",
  });
  assert.deepEqual(deletedInput, { collection: "wanja", id: itemId });
  assert.deepEqual(deletedKeys, [
    "items-stage/wanja/first.webp",
    "items-stage/old-name/second.webp",
    "items-stage/wanja/unused.webp",
  ]);
  assert.deepEqual(archivedImages, [
    {
      destinationKey: `order-images-stage/order-1/${itemId}/first.webp`,
      sourceKey: "items-stage/wanja/first.webp",
    },
    {
      destinationKey: `order-images-stage/order-2/${itemId}/second.webp`,
      sourceKey: "items-stage/old-name/second.webp",
    },
  ]);
  assert.deepEqual(replacements, [
    {
      archivedUrl: `https://38vabcm3.twic.pics/order-images-stage/order-1/${itemId}/first.webp`,
      itemId,
      orderId: "order-1",
      sourceUrl:
        "https://38vabcm3.twic.pics/items-stage/wanja/first.webp?width=480",
    },
    {
      archivedUrl: `https://38vabcm3.twic.pics/order-images-stage/order-2/${itemId}/second.webp`,
      itemId,
      orderId: "order-2",
      sourceUrl:
        "https://38vabcm3.twic.pics/items-stage/old-name/second.webp",
    },
  ]);
  assert.deepEqual(events, [
    "transaction-start",
    "find",
    "orders",
    "item",
    "transaction-end",
    "session-end",
    "archive",
    "replace",
    "archive",
    "replace",
    "s3",
  ]);
});

test("a missing product leaves orders and S3 untouched", async () => {
  let readOrders = false;
  let deletedImages = false;
  let ended = false;

  const result = await deleteItemWithAssets(
    { collection: "wanja", id: itemId },
    makeDependencies({
      deleteImageKeys: async () => {
        deletedImages = true;
      },
      findItem: async () => null,
      findOrderImageReferences: async () => {
        readOrders = true;
        return { orderCount: 0, references: [] };
      },
      startSession: async () => ({
        endSession: async () => {
          ended = true;
        },
        withTransaction: async (callback) => callback(),
      }),
    })
  );

  assert.deepEqual(result, { status: "not_found" });
  assert.equal(readOrders, false);
  assert.equal(deletedImages, false);
  assert.equal(ended, true);
});

test("an order keeps its original image when archival fails", async () => {
  const deletedKeys: string[][] = [];
  const cleanupError = new Error("copy failed");
  const loggedErrors: unknown[] = [];
  let replacements = 0;

  const result = await deleteItemWithAssets(
    { collection: "wanja", id: itemId },
    makeDependencies({
      archiveOrderImage: async () => {
        throw cleanupError;
      },
      deleteImageKeys: async (keys) => {
        deletedKeys.push(keys);
      },
      findItem: async () => ({
        _id: itemId,
        images: [
          "https://38vabcm3.twic.pics/items-stage/wanja/ordered.webp",
          "https://38vabcm3.twic.pics/items-stage/wanja/unused.webp",
        ],
      }),
      findOrderImageReferences: async () => ({
        orderCount: 1,
        references: [
          {
            imageUrl:
              "https://38vabcm3.twic.pics/items-stage/wanja/ordered.webp",
            orderId: "order-1",
            preserveSource: false,
          },
        ],
      }),
      logCleanupError: (error) => {
        loggedErrors.push(error);
      },
      replaceOrderImage: async () => {
        replacements += 1;
        return true;
      },
    })
  );

  assert.deepEqual(result, {
    affectedOrderCount: 1,
    deletedImageCount: 1,
    imageCleanup: "failed",
    status: "deleted",
  });
  assert.deepEqual(deletedKeys, [["items-stage/wanja/unused.webp"]]);
  assert.equal(replacements, 0);
  assert.deepEqual(loggedErrors, [cleanupError]);
});

test("an image used by a sent email remains at its original URL", async () => {
  let deletedKeys: string[] = [];

  const result = await deleteItemWithAssets(
    { collection: "wanja", id: itemId },
    makeDependencies({
      deleteImageKeys: async (keys) => {
        deletedKeys = keys;
      },
      findItem: async () => ({
        _id: itemId,
        images: [
          "https://38vabcm3.twic.pics/items-stage/wanja/emailed.webp",
          "https://38vabcm3.twic.pics/items-stage/wanja/unused.webp",
        ],
      }),
      findOrderImageReferences: async () => ({
        orderCount: 1,
        references: [
          {
            imageUrl:
              "https://38vabcm3.twic.pics/items-stage/wanja/emailed.webp",
            orderId: "order-1",
            preserveSource: true,
          },
        ],
      }),
    })
  );

  assert.deepEqual(result, {
    affectedOrderCount: 1,
    deletedImageCount: 1,
    imageCleanup: "complete",
    status: "deleted",
  });
  assert.deepEqual(deletedKeys, ["items-stage/wanja/unused.webp"]);
});

test("S3 cleanup failures never restore or hide a deleted product", async () => {
  const cleanupError = new Error("S3 unavailable");
  let loggedError: unknown;

  const result = await deleteItemWithAssets(
    { collection: "wanja", id: itemId },
    makeDependencies({
      deleteImageKeys: async () => {
        throw cleanupError;
      },
      logCleanupError: (error) => {
        loggedError = error;
      },
    })
  );

  assert.equal(result.status, "deleted");
  assert.equal(result.imageCleanup, "failed");
  assert.equal(loggedError, cleanupError);
});
