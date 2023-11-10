import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { ActionFunction } from "@remix-run/node";
import { Items } from "~/schemas/items";
import { s3Client } from "~/services/s3.server";
import { ItemProps } from "~/types";

const AWS_ITEM_PATH = process.env.AWS_ITEM_PATH;

export async function deleteFileFromS3(
  id: string,
  collection: string,
  fileKey: string
) {
  const item: ItemProps | null = await Items.findOne({ _id: id }).lean();

  if (item) {
    const image = item.images.find((i) => i.endsWith(fileKey));
    const rest = item.images.filter((i) => !i.endsWith(fileKey));

    if (image) {
      const [nameOnS3, collectionOns3] = image.split("/").reverse().slice(0, 2);

      const deleteParams = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: `${AWS_ITEM_PATH}/${collectionOns3}/${nameOnS3}`,
      };

      try {
         await s3Client.send(new DeleteObjectCommand(deleteParams));
        console.log(`File deleted: ${fileKey}`);
        await Items.updateOne(
          { _id: id },
          {
            images: rest,
          }
        );

        return true;
      } catch (error) {
        console.error("Error deleting file:", error);
        return false;
      }
    } else {
      // this item might now have been saved yet. Try to remove it from S3
      const deleteParams = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: `${AWS_ITEM_PATH}/${collection}/${fileKey}`,
      };

      try {
        await s3Client.send(new DeleteObjectCommand(deleteParams));
        console.log(`File deleted: ${fileKey}`);
        return true
      } catch(e) {
        return false
      }
    }
  }
  return false
}

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const imageName = formData.get("imageName");
  const id = formData.get("id");
  const collection = formData.get("collection");

  if (imageName && id && collection) {
    await deleteFileFromS3(
      id.toString(),
      collection.toString(),
      imageName.toString()
    );
  }

  return null;
};
