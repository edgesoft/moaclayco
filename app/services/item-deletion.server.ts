import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import mongoose from "mongoose";
import type { ClientSession } from "mongoose";
import { Items } from "~/schemas/items";
import { Orders } from "~/schemas/orders";
import {
  copyOrderImage,
  getOrderImagePath,
  orderImageUrl,
} from "~/services/order-image-storage.server";
import { s3Client } from "~/services/s3.server";
import {
  itemStorageKeyFromUrl,
} from "~/utils/itemImageStorage.server";

type ItemForDeletion = {
  _id: unknown;
  headline?: string;
  images?: string[];
};

type OrderForImageRetention = {
  _id: unknown;
  orderConfirmationEmailAt?: Date;
  shippingEmailAt?: Date;
  items?: Array<{
    image?: string;
    itemRef?: string;
  }>;
};

type OrderImageReference = {
  imageUrl: string;
  orderId: string;
  preserveSource: boolean;
};

type DeletionSession = {
  endSession(): Promise<void>;
  withTransaction<T>(callback: () => Promise<T>): Promise<T>;
};

type DeleteItemInput = {
  collection: string;
  id: string;
};

export type ItemDeletionResult =
  | { status: "not_found" }
  | {
      affectedOrderCount: number;
      deletedImageCount: number;
      imageCleanup: "complete" | "failed";
      status: "deleted";
    };

export type ItemDeletionDependencies = {
  archiveOrderImage(input: {
    destinationKey: string;
    sourceKey: string;
  }): Promise<void>;
  deleteImageKeys(keys: string[]): Promise<void>;
  deleteItem(
    input: { collection: string; id: unknown },
    session: DeletionSession
  ): Promise<boolean>;
  findItem(
    input: { collection: string; id: string },
    session: DeletionSession
  ): Promise<ItemForDeletion | null>;
  findOrderImageReferences(
    itemId: string,
    session: DeletionSession
  ): Promise<{ orderCount: number; references: OrderImageReference[] }>;
  getItemPath(): string | undefined;
  getOrderImagePath(): string | undefined;
  logCleanupError(error: unknown, context: Record<string, unknown>): void;
  replaceOrderImage(input: {
    archivedUrl: string;
    itemId: string;
    orderId: string;
    sourceUrl: string;
  }): Promise<boolean>;
  startSession(): Promise<DeletionSession>;
};

const deleteImageKeys = async (keys: string[]) => {
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  const uniqueKeys = [...new Set(keys)];
  if (!bucket || !uniqueKeys.length) return;

  for (let start = 0; start < uniqueKeys.length; start += 1000) {
    const response = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: uniqueKeys.slice(start, start + 1000).map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );

    if (response.Errors?.length) {
      throw new Error(
        `S3 could not remove ${response.Errors.length} product image object(s)`
      );
    }
  }
};

const defaultDependencies: ItemDeletionDependencies = {
  archiveOrderImage: copyOrderImage,
  deleteImageKeys,
  deleteItem: async ({ collection, id }, session) => {
    const result = await Items.deleteOne(
      { _id: id, collectionRef: collection },
      { session: session as ClientSession }
    );
    return result.deletedCount === 1;
  },
  findItem: ({ collection, id }, session) =>
    Items.findOne({ _id: id, collectionRef: collection })
      .select("headline images")
      .session(session as ClientSession)
      .lean<ItemForDeletion>()
      .exec(),
  findOrderImageReferences: async (itemId, session) => {
    const orders = await Orders.find({ "items.itemRef": itemId })
      .select("items.itemRef items.image orderConfirmationEmailAt shippingEmailAt")
      .session(session as ClientSession)
      .lean<OrderForImageRetention[]>()
      .exec();
    return {
      orderCount: orders.length,
      references: orders.flatMap((order) =>
        (order.items ?? [])
          .filter((item) => item.itemRef === itemId && Boolean(item.image))
          .map((item) => ({
            imageUrl: item.image as string,
            orderId: String(order._id),
            preserveSource: Boolean(
              order.orderConfirmationEmailAt || order.shippingEmailAt
            ),
          }))
      ),
    };
  },
  getItemPath: () => process.env.AWS_ITEM_PATH,
  getOrderImagePath,
  logCleanupError: (error, context) =>
    console.error("Product image cleanup could not be fully completed", {
      ...context,
      error,
    }),
  replaceOrderImage: async ({ archivedUrl, itemId, orderId, sourceUrl }) => {
    const result = await Orders.updateOne(
      { _id: orderId, items: { $elemMatch: { image: sourceUrl, itemRef: itemId } } },
      { $set: { "items.$[item].image": archivedUrl } },
      {
        arrayFilters: [{ "item.image": sourceUrl, "item.itemRef": itemId }],
      }
    );
    return result.modifiedCount === 1;
  },
  startSession: () => mongoose.startSession(),
};

export async function deleteItemWithAssets(
  input: DeleteItemInput,
  dependencies: ItemDeletionDependencies = defaultDependencies
): Promise<ItemDeletionResult> {
  const session = await dependencies.startSession();
  let deletion:
    | {
        affectedOrderCount: number;
        item: ItemForDeletion;
        orderImageReferences: OrderImageReference[];
      }
    | null;

  try {
    deletion = await session.withTransaction(async () => {
      const item = await dependencies.findItem(input, session);
      if (!item) return null;

      const itemId = String(item._id);
      const orderReferences = await dependencies.findOrderImageReferences(
        itemId,
        session
      );
      const deleted = await dependencies.deleteItem(
        { collection: input.collection, id: item._id },
        session
      );
      if (!deleted) {
        throw new Error(`Product ${itemId} could not be deleted`);
      }

      return {
        affectedOrderCount: orderReferences.orderCount,
        item,
        orderImageReferences: orderReferences.references,
      };
    });
  } finally {
    await session.endSession();
  }

  if (!deletion) return { status: "not_found" };

  const itemPath = dependencies.getItemPath();
  const storedKeys = (deletion.item.images ?? []).map((imageUrl) =>
    itemStorageKeyFromUrl(imageUrl, itemPath)
  );
  const orderImagePath = dependencies.getOrderImagePath();
  const retainedOrderKeys = new Set<string>();
  const orderSourceKeys: string[] = [];
  let imageCleanupFailed = false;

  const uniqueOrderReferences = [
    ...new Map(
      deletion.orderImageReferences.map((reference) => [
        `${reference.orderId}:${reference.imageUrl}`,
        reference,
      ])
    ).values(),
  ];

  for (const reference of uniqueOrderReferences) {
    const sourceKey = itemStorageKeyFromUrl(reference.imageUrl, itemPath);
    if (!sourceKey) continue;
    orderSourceKeys.push(sourceKey);

    const fileName = sourceKey.split("/").pop();
    if (!orderImagePath || !fileName) {
      retainedOrderKeys.add(sourceKey);
      imageCleanupFailed = true;
      continue;
    }

    const destinationKey = `${orderImagePath}/${reference.orderId}/${input.id}/${fileName}`;
    try {
      await dependencies.archiveOrderImage({ destinationKey, sourceKey });
      const replaced = await dependencies.replaceOrderImage({
        archivedUrl: orderImageUrl(reference.imageUrl, destinationKey),
        itemId: input.id,
        orderId: reference.orderId,
        sourceUrl: reference.imageUrl,
      });
      if (!replaced) {
        throw new Error(`Order ${reference.orderId} image reference was not updated`);
      }
      if (reference.preserveSource) retainedOrderKeys.add(sourceKey);
    } catch (error) {
      retainedOrderKeys.add(sourceKey);
      imageCleanupFailed = true;
      dependencies.logCleanupError(error, {
        destinationKey,
        itemId: input.id,
        orderId: reference.orderId,
        phase: "archive_order_image",
        sourceKey,
      });
    }
  }

  const imageKeys = [
    ...new Set(
      [...storedKeys, ...orderSourceKeys].filter(
        (key): key is string =>
          typeof key === "string" && !retainedOrderKeys.has(key)
      )
    ),
  ];

  try {
    await dependencies.deleteImageKeys(imageKeys);
    return {
      affectedOrderCount: deletion.affectedOrderCount,
      deletedImageCount: imageKeys.length,
      imageCleanup: imageCleanupFailed ? "failed" : "complete",
      status: "deleted",
    };
  } catch (error) {
    dependencies.logCleanupError(error, {
      collection: input.collection,
      imageKeys,
      itemId: input.id,
    });
    return {
      affectedOrderCount: deletion.affectedOrderCount,
      deletedImageCount: imageKeys.length,
      imageCleanup: "failed",
      status: "deleted",
    };
  }
}
