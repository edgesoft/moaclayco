import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { data as json } from "react-router";
import type { ActionFunction } from "react-router";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";
import { auth } from "~/services/auth.server";
import { s3Client } from "~/services/s3.server";
import type { ItemProps } from "~/types";
import { getDomain } from "~/utils/domain";

const AWS_ITEM_PATH = process.env.AWS_ITEM_PATH;

const keyFromItemImage = (imageUrl: string) => {
  if (!AWS_ITEM_PATH) return null;
  try {
    const key = new URL(imageUrl).pathname.replace(/^\/+/, "");
    return key.startsWith(`${AWS_ITEM_PATH}/`) ? key : null;
  } catch {
    return null;
  }
};

async function deleteFileFromS3(
  id: string | null,
  collection: string,
  requestedFileName: string,
  domain: string
) {
  if (!AWS_ITEM_PATH) return false;
  const fileName = requestedFileName.split("/").pop()?.split("?")[0];
  if (!fileName || fileName !== requestedFileName.split("?")[0]) return false;

  const item: ItemProps | null = id
    ? await Items.findOne({
        _id: id,
        collectionRef: collection,
        domain,
      }).lean()
    : null;

  if (id && !item) return false;

  if (item) {
    const image = item.images.find((candidate) =>
      candidate.split("?")[0].endsWith(`/${fileName}`)
    );
    if (!image) return false;
    const key = keyFromItemImage(image);
    if (!key) return false;

    const remainingImages = item.images.filter((candidate) => candidate !== image);
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: key,
      })
    );
    await Items.updateOne(
      { _id: id, collectionRef: collection, domain },
      { images: remainingImages }
    );
    return true;
  }

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `${AWS_ITEM_PATH}/${collection}/${fileName}`,
    })
  );
  return true;
}

export const action: ActionFunction = async ({ request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const domain = getDomain(request);
  if (!domain) return json({ error: "Okänd domän." }, { status: 400 });

  const formData = await request.formData();
  const imageName = formData.get("imageName")?.toString();
  const id = formData.get("id")?.toString() || null;
  const collection = formData.get("collection")?.toString();
  if (!imageName || !collection) {
    return json({ error: "Bild eller kollektion saknas." }, { status: 400 });
  }

  const collectionExists = await Collections.exists({
    domain: domain.domain,
    shortUrl: collection,
  });
  if (!collectionExists) {
    return json({ error: "Kollektionen kunde inte hittas." }, { status: 404 });
  }

  try {
    const success = await deleteFileFromS3(
      id,
      collection,
      imageName,
      domain.domain
    );
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
