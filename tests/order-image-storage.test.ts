import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveOrderImages,
  type OrderImageStorageDependencies,
} from "../app/services/order-image-storage.server";

const dependencies = (
  overrides: Partial<OrderImageStorageDependencies> = {}
): OrderImageStorageDependencies => ({
  copyImage: async () => undefined,
  getItemPath: () => "items-stage",
  getOrderImagePath: () => "order-images-stage",
  logArchiveError: () => undefined,
  replaceOrderImage: async () => true,
  ...overrides,
});

test("order creation replaces product URLs with permanent order image URLs", async () => {
  const copies: Array<{ destinationKey: string; sourceKey: string }> = [];
  const replacements: Array<{
    archivedUrl: string;
    itemId: string;
    orderId: string;
    sourceUrl: string;
  }> = [];

  const result = await archiveOrderImages(
    {
      _id: "order-1",
      items: [
        {
          image:
            "https://38vabcm3.twic.pics/items-stage/wanja/first image.webp?width=800",
          itemRef: "item-1",
        },
        {
          image:
            "https://38vabcm3.twic.pics/order-images-stage/order-1/item-2/second.webp",
          itemRef: "item-2",
        },
      ],
    },
    dependencies({
      copyImage: async (input) => {
        copies.push(input);
      },
      replaceOrderImage: async (input) => {
        replacements.push(input);
        return true;
      },
    })
  );

  assert.deepEqual(result, { archivedCount: 1, failedItemRefs: [] });
  assert.deepEqual(copies, [
    {
      destinationKey: "order-images-stage/order-1/item-1/first%20image.webp",
      sourceKey: "items-stage/wanja/first%20image.webp",
    },
  ]);
  assert.deepEqual(replacements, [
    {
      archivedUrl:
        "https://38vabcm3.twic.pics/order-images-stage/order-1/item-1/first%20image.webp",
      itemId: "item-1",
      orderId: "order-1",
      sourceUrl:
        "https://38vabcm3.twic.pics/items-stage/wanja/first image.webp?width=800",
    },
  ]);
});

test("an archival failure leaves the original order URL untouched", async () => {
  const failure = new Error("S3 unavailable");
  const logged: unknown[] = [];
  let replacements = 0;

  const result = await archiveOrderImages(
    {
      _id: "order-1",
      items: [
        {
          image: "https://38vabcm3.twic.pics/items-stage/wanja/first.webp",
          itemRef: "item-1",
        },
      ],
    },
    dependencies({
      copyImage: async () => {
        throw failure;
      },
      logArchiveError: (error) => logged.push(error),
      replaceOrderImage: async () => {
        replacements += 1;
        return true;
      },
    })
  );

  assert.deepEqual(result, {
    archivedCount: 0,
    failedItemRefs: ["item-1"],
  });
  assert.deepEqual(logged, [failure]);
  assert.equal(replacements, 0);
});
