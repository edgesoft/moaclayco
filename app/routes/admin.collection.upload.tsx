import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { ActionFunction, LoaderFunction, json } from "@remix-run/node";
import { Readable } from "stream";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import { s3Client } from "~/services/s3.server";

const awsCollectionPath = process.env.AWS_COLLECTION_PATH;

if (!awsCollectionPath) {
  throw new Error(
    "AWS configuration is not complete. Please check your environment variables."
  );
}

export async function uploadToS3(file: File | Blob) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const thumbnailBuffer = await sharp(buffer)
    .resize(700) // Resize the image to have the given width
    .webp({ quality: 90 }) // Convert the image to webp format with a quality of 90
    .toBuffer();

  const fileSize = thumbnailBuffer.length; // This is the size of the thumbnail file in bytes
  const fileStream = bufferToStream(thumbnailBuffer);
  const uniqueFileName = `${uuidv4()}.webp`;

  const uploadParams = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: `${awsCollectionPath}/${uniqueFileName}`,
    Body: fileStream,
    ContentType: "webp",
  };

  try {
    // Create a managed upload, which allows for pausing and resuming uploads.
    const uploader = new Upload({
      client: s3Client,
      params: uploadParams,
    });

    uploader.on("httpUploadProgress", (progress) => {
      console.log(progress); // This will print upload progress.
      console.log(fileSize);
    });

    await uploader.done();
    return { key: uploadParams.Key, uniqueFileName };
  } catch (error) {
    const e = error as Error;
    console.error("Error uploading file: ", e);
    throw new Error(`Failed to upload file: ${e.message}`);
  }
}

function bufferToStream(buffer: Buffer) {
  const stream = new Readable({
    read() {
      this.push(buffer);
      this.push(null);
    },
  });

  return stream;
}

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file) return json({ error: "No file uploaded" }, { status: 400 });

  if (file instanceof File) {
    try {
      const result = await uploadToS3(file); // The utility function to upload the file to S3
      return json(result);
    } catch (error) {
      console.error(error);
      return json({ error: "Failed to upload file" }, { status: 500 });
    }
  }
  return json({ error: "Failed to upload file" }, { status: 500 });
};

export const loader: LoaderFunction = () => {
  return null;
};
