import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { data as json } from "react-router";
import type { ActionFunction } from "react-router";
import { Collections } from "~/schemas/collections";
import { activeCatalogCollectionFilter } from "~/utils/catalogCollections.server";
import { Items } from "~/schemas/items";
import { auth } from "~/services/auth.server";
import { canDeleteItemImageSource } from "~/services/order-image-storage.server";
import { s3Client } from "~/services/s3.server";
import type { ItemProps } from "~/types";
import { itemStorageKeyFromUrl } from "~/utils/itemImageStorage.server";
import { invalidateCatalogCache } from "~/services/catalog-cache.server";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";
import { activeCatalogItemFilter } from "~/utils/catalogItems.server";

const AWS_ITEM_PATH = process.env.AWS_ITEM_PATH;

async function deleteFileFromS3(
  id: string,
  collection: string,
  requestedFileName: string
) {
  if (!AWS_ITEM_PATH) return false;
  const fileName = requestedFileName.split("/").pop()?.split("?")[0];
  if (!fileName || fileName !== requestedFileName.split("?")[0]) return false;

  const item = await Items.findOne({
    ...activeCatalogItemFilter,
    _id: id,
    collectionRef: collection,
  }).lean<ItemProps>();

  if (item) {
    const image = item.images.find((candidate) =>
      candidate.split("?")[0].endsWith(`/${fileName}`)
    );
    if (!image) return false;
    const key = itemStorageKeyFromUrl(image, AWS_ITEM_PATH);
    if (!key) return false;

    const canDeleteSource = await canDeleteItemImageSource({
      itemId: id,
      sourceKey: key,
    });

    const updateResult = await Items.updateOne(
      { _id: id, collectionRef: collection, images: image },
      { $pull: { images: image } }
    );
    if (updateResult.modifiedCount !== 1) return false;

    if (!canDeleteSource) return true;
    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: key,
        })
      );
    } catch (error) {
      // The database is the source of truth. A stale, unreferenced S3 object is
      // safer than leaving the product with a permanently broken image URL.
      console.error("Unreferenced item image could not be removed from S3", error);
    }
    return true;
  }
  return false;
}

export const action: ActionFunction = async ({ request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });

  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(
      request,
      MAX_STANDARD_FORM_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json(
        { error: "Formuläret är för stort.", success: false },
        { status: 413 }
      );
    }
    throw error;
  }
  const imageName = formData.get("imageName")?.toString();
  const id = formData.get("id")?.toString();
  const collection = formData.get("collection")?.toString();
  if (!imageName || !collection || !id) {
    return json({ error: "Bild, produkt eller kollektion saknas." }, { status: 400 });
  }

  const collectionExists = await Collections.exists({
    ...activeCatalogCollectionFilter,
    shortUrl: collection,
  });
  if (!collectionExists) {
    return json({ error: "Kollektionen kunde inte hittas." }, { status: 404 });
  }

  try {
    const success = await deleteFileFromS3(id, collection, imageName);
    if (success) invalidateCatalogCache();
    return success
      ? json({ success: true })
      : json({ error: "Bilden kunde inte hittas.", success: false }, { status: 404 });
  } catch (error) {
    console.error("Image delete failed", error);
    return json(
      { error: "Bilden kunde inte tas bort.", success: false },
      { status: 500 }
    );
  }
};
