import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { s3Client } from "~/services/s3.server";
import { v4 as uuidv4 } from "uuid";

export const MAX_VERIFICATION_FILE_SIZE = 20 * 1024 * 1024;

export const isSupportedVerificationFile = (file: File) =>
  file.type === "application/pdf" || file.type.startsWith("image/");

export function validateVerificationFile(file: File) {
  if (file.size <= 0) throw new Error("Filen är tom");
  if (file.size > MAX_VERIFICATION_FILE_SIZE) throw new Error("Filen är för stor");
  if (!isSupportedVerificationFile(file)) throw new Error("Filtypen stöds inte");
}

export async function uploadVerificationFile(file: File, folder = "documents") {
  validateVerificationFile(file);
  const prefix = process.env.AWS_VERIFICATIONS_PATH?.replace(/^\/+|\/+$/g, "");
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!prefix || !bucket) throw new Error("S3-konfiguration för verifikationer saknas");

  const safeOriginalName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180);
  const key = `${prefix}/${folder}/${uuidv4()}-${safeOriginalName || "underlag"}`;
  const result = await new Upload({
    client: s3Client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: file.type,
    },
  }).done();
  if (!result.Location) throw new Error("S3-uppladdningen saknar filadress");
  return { key, name: file.name.slice(0, 255), path: result.Location };
}

export async function deleteUploadedVerificationFile(key: string) {
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!bucket) return;
  await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
