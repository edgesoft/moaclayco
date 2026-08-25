import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { Orders } from "~/schemas/orders";
import { s3Client } from "~/services/s3.server";
import { itemStorageKeyFromUrl } from "~/utils/itemImageStorage.server";

type OrderImageItem = {
  image?: string;
  itemRef?: string;
  templateItemRef?: string;
};

type OrderWithImages = {
  _id: unknown;
  orderConfirmationEmailAt?: Date | string;
  shippingEmailAt?: Date | string;
  items?: OrderImageItem[];
};

export type OrderImageArchivalResult = {
  archivedCount: number;
  failedItemRefs: string[];
};

export type OrderImageStorageDependencies = {
  copyImage(input: { destinationKey: string; sourceKey: string }): Promise<void>;
  getItemPath(): string | undefined;
  getOrderImagePath(): string | undefined;
  logArchiveError(error: unknown, context: Record<string, unknown>): void;
  replaceOrderImage(input: {
    archivedUrl: string;
    itemId: string;
    orderId: string;
    referenceField: "itemRef" | "templateItemRef";
    sourceUrl: string;
  }): Promise<boolean>;
};

const normalizeStoragePath = (path: string | undefined) =>
  path?.replace(/^\/+|\/+$/g, "") || undefined;

export const getOrderImagePath = () => {
  const configuredPath = normalizeStoragePath(process.env.AWS_ORDER_IMAGE_PATH);
  if (configuredPath) return configuredPath;
  const itemPath = normalizeStoragePath(process.env.AWS_ITEM_PATH);
  return itemPath ? `${itemPath}/order-history` : undefined;
};

export const orderImageUrl = (sourceUrl: string, destinationKey: string) => {
  const url = new URL(sourceUrl);
  url.pathname = `/${destinationKey}`;
  url.search = "";
  url.hash = "";
  return url.toString();
};

const copySource = (bucket: string, sourceKey: string) =>
  `/${bucket}/${sourceKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

export const copyOrderImage = async ({
  destinationKey,
  sourceKey,
}: {
  destinationKey: string;
  sourceKey: string;
}) => {
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!bucket) throw new Error("S3 bucket is not configured");

  await s3Client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: copySource(bucket, sourceKey),
      Key: destinationKey,
    })
  );
};

const defaultDependencies: OrderImageStorageDependencies = {
  copyImage: copyOrderImage,
  getItemPath: () => process.env.AWS_ITEM_PATH,
  getOrderImagePath,
  logArchiveError: (error, context) =>
    console.error("Order image could not be archived", { ...context, error }),
  replaceOrderImage: async ({
    archivedUrl,
    itemId,
    orderId,
    referenceField,
    sourceUrl,
  }) => {
    const result = await Orders.updateOne(
      {
        _id: orderId,
        items: {
          $elemMatch: { image: sourceUrl, [referenceField]: itemId },
        },
      },
      { $set: { "items.$[item].image": archivedUrl } },
      {
        arrayFilters: [
          {
            "item.image": sourceUrl,
            [`item.${referenceField}`]: itemId,
          },
        ],
      }
    );
    return result.modifiedCount === 1;
  },
};

export async function archiveOrderImages(
  order: OrderWithImages,
  dependencies: OrderImageStorageDependencies = defaultDependencies
): Promise<OrderImageArchivalResult> {
  const itemPath = dependencies.getItemPath();
  const orderImagePath = normalizeStoragePath(dependencies.getOrderImagePath());
  const orderId = String(order._id);
  let archivedCount = 0;
  const failedItemRefs = new Set<string>();
  const references = [
    ...new Map(
      (order.items ?? [])
        .filter((item) => Boolean(item.image && (item.itemRef || item.templateItemRef)))
        .map((item) => [
          `${item.itemRef ?? item.templateItemRef}:${item.image}`,
          item,
        ])
    ).values(),
  ];

  for (const reference of references) {
    const referenceField = reference.itemRef ? "itemRef" : "templateItemRef";
    const itemId = String(reference.itemRef ?? reference.templateItemRef);
    const sourceUrl = String(reference.image);
    const sourceKey = itemStorageKeyFromUrl(sourceUrl, itemPath);
    if (!sourceKey) continue;
    if (orderImagePath && sourceKey.startsWith(`${orderImagePath}/`)) continue;

    const fileName = sourceKey.split("/").pop();
    if (!orderImagePath || !fileName) {
      failedItemRefs.add(itemId);
      continue;
    }

    const destinationKey = `${orderImagePath}/${orderId}/${itemId}/${fileName}`;
    try {
      await dependencies.copyImage({ destinationKey, sourceKey });
      const replaced = await dependencies.replaceOrderImage({
        archivedUrl: orderImageUrl(sourceUrl, destinationKey),
        itemId,
        orderId,
        referenceField,
        sourceUrl,
      });
      if (!replaced) {
        throw new Error(`Order ${orderId} image reference was not updated`);
      }
      archivedCount += 1;
    } catch (error) {
      failedItemRefs.add(itemId);
      dependencies.logArchiveError(error, {
        destinationKey,
        itemId,
        orderId,
        sourceKey,
      });
    }
  }

  return { archivedCount, failedItemRefs: [...failedItemRefs] };
}

export async function canDeleteItemImageSource(input: {
  itemId: string;
  sourceKey: string;
}) {
  const itemPath = process.env.AWS_ITEM_PATH;
  const orders = await Orders.find({ "items.itemRef": input.itemId })
    .select("items.itemRef items.image orderConfirmationEmailAt shippingEmailAt")
    .lean<OrderWithImages[]>();
  const referencesSource = (order: OrderWithImages) =>
    (order.items ?? []).some(
      (item) =>
        item.itemRef === input.itemId &&
        Boolean(item.image) &&
        itemStorageKeyFromUrl(String(item.image), itemPath) === input.sourceKey
    );

  const relevantOrders = orders.filter(referencesSource);
  const sourceMustRemainForSentEmail = relevantOrders.some(
    (order) => order.orderConfirmationEmailAt || order.shippingEmailAt
  );
  for (const order of relevantOrders) await archiveOrderImages(order);

  const refreshedOrders = await Orders.find({ "items.itemRef": input.itemId })
    .select("items.itemRef items.image")
    .lean<OrderWithImages[]>();
  const sourceStillReferenced = refreshedOrders.some(referencesSource);
  return !sourceMustRemainForSentEmail && !sourceStillReferenced;
}

export async function retainOrderImageSourcesBeforeCollectionDeletion(
  itemIds: string[]
) {
  const itemIdSet = new Set(itemIds);
  const itemPath = process.env.AWS_ITEM_PATH;
  const orders = await Orders.find({ "items.itemRef": { $in: itemIds } })
    .select("items.itemRef items.image orderConfirmationEmailAt shippingEmailAt")
    .lean<OrderWithImages[]>();
  const retainedKeys = new Set<string>();
  const sourceKeys = (order: OrderWithImages) =>
    (order.items ?? [])
      .filter((item) => itemIdSet.has(String(item.itemRef)) && Boolean(item.image))
      .map((item) => itemStorageKeyFromUrl(String(item.image), itemPath))
      .filter((key): key is string => Boolean(key));

  for (const order of orders) {
    if (order.orderConfirmationEmailAt || order.shippingEmailAt) {
      sourceKeys(order).forEach((key) => retainedKeys.add(key));
    }
    await archiveOrderImages(order);
  }

  const refreshedOrders = await Orders.find({ "items.itemRef": { $in: itemIds } })
    .select("items.itemRef items.image")
    .lean<OrderWithImages[]>();
  refreshedOrders.forEach((order) => {
    sourceKeys(order).forEach((key) => retainedKeys.add(key));
  });
  return retainedKeys;
}
