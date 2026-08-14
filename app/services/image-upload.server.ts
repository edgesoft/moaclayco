import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { v4 as uuidv4 } from "uuid";
import {
  registerImageDraft,
  scheduleExpiredImageDraftCleanup,
  type ImageDraftKind,
} from "~/services/image-drafts.server";
import { s3Client } from "~/services/s3.server";
import { assetUrlFromKey } from "~/utils/assetUrl.server";
import { optimizeImageFile } from "~/utils/imageProcessing.server";

export async function processAndStoreDraftImage(input: {
  collectionRef?: string;
  draftId: string;
  inputPath: string;
  kind: ImageDraftKind;
  maxWidth: number;
  storagePath: string;
}) {
  const normalizedStoragePath = input.storagePath.replace(/^\/+|\/+$/g, "");
  if (!normalizedStoragePath) throw new Error("Image storage path is not configured");

  const { data, info } = await optimizeImageFile(input.inputPath, input.maxWidth);
  const uniqueFileName = `${uuidv4()}.webp`;
  const key = [normalizedStoragePath, input.collectionRef, uniqueFileName]
    .filter(Boolean)
    .join("/");
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!bucket) throw new Error("S3 bucket is not configured");

  const uploader = new Upload({
    client: s3Client,
    params: {
      Body: data,
      Bucket: bucket,
      ContentType: "image/webp",
      Key: key,
    },
  });
  await uploader.done();

  const url = assetUrlFromKey(key);
  try {
    await registerImageDraft({
      collectionRef: input.collectionRef,
      draftId: input.draftId,
      key,
      kind: input.kind,
      url,
    });
  } catch (error) {
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (cleanupError) {
      console.error("Unregistered image upload could not be rolled back", {
        cleanupError,
        key,
      });
    }
    throw error;
  }

  scheduleExpiredImageDraftCleanup();
  return {
    height: info.height,
    key,
    sizeBytes: info.size,
    uniqueFileName,
    url,
    width: info.width,
  };
}
