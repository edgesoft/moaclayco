import { Upload } from "@aws-sdk/lib-storage";
import { data as json } from "react-router";
import type { ActionFunction, LoaderFunction } from "react-router";
import sharp from "sharp";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import { auth } from "~/services/auth.server";
import { s3Client } from "~/services/s3.server";
import {
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";

const awsCollectionPath = process.env.AWS_COLLECTION_PATH;
const MAX_IMAGE_SIZE = 18 * 1024 * 1024;
const MAX_IMAGE_REQUEST_SIZE = MAX_IMAGE_SIZE + 512 * 1024;
const acceptedImagePattern = /\.(jpe?g|png|webp|heic|heif)$/i;

if (!awsCollectionPath) {
  throw new Error(
    "AWS configuration is not complete. Please check your environment variables."
  );
}

function bufferToStream(buffer: Buffer) {
  return new Readable({
    read() {
      this.push(buffer);
      this.push(null);
    },
  });
}

async function uploadToS3(file: File) {
  const inputBuffer = Buffer.from(await file.arrayBuffer());
  const { data: optimizedBuffer, info } = await sharp(inputBuffer)
    .rotate()
    .resize({ width: 1800, withoutEnlargement: true })
    .webp({ effort: 4, quality: 88 })
    .toBuffer({ resolveWithObject: true });
  const uniqueFileName = `${uuidv4()}.webp`;
  const key = `${awsCollectionPath}/${uniqueFileName}`;

  const uploader = new Upload({
    client: s3Client,
    params: {
      Body: bufferToStream(optimizedBuffer),
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      ContentType: "image/webp",
      Key: key,
    },
  });
  await uploader.done();

  return {
    height: info.height,
    key,
    sizeBytes: info.size,
    uniqueFileName,
    width: info.width,
  };
}

export const action: ActionFunction = async ({ request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(request, MAX_IMAGE_REQUEST_SIZE);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ error: "Bilden är större än 18 MB." }, { status: 413 });
    }
    throw error;
  }
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return json({ error: "Ingen bild valdes." }, { status: 400 });
  }
  if (!acceptedImagePattern.test(file.name)) {
    return json(
      { error: "Välj en bild i JPG-, PNG-, WebP- eller HEIC-format." },
      { status: 415 }
    );
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return json({ error: "Bilden är större än 18 MB." }, { status: 413 });
  }

  try {
    return json(await uploadToS3(file));
  } catch (error) {
    console.error("Collection image upload failed", error);
    return json(
      { error: "Bilden kunde inte bearbetas eller laddas upp." },
      { status: 500 }
    );
  }
};

export const loader: LoaderFunction = async ({ request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  return null;
};
