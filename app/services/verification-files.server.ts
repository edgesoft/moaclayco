import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { s3Client } from "~/services/s3.server";
import { v4 as uuidv4 } from "uuid";
import sharp from "sharp";
import { MAX_INPUT_IMAGE_PIXELS } from "~/utils/imageProcessing.server";

export const MAX_VERIFICATION_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_VERIFICATION_REQUEST_SIZE =
  MAX_VERIFICATION_FILE_SIZE + 1024 * 1024;

const supportedDeclaredTypes = new Set([
  "application/pdf",
  "application/x-pdf",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/x-png",
  "image/tiff",
  "image/x-tiff",
  "image/webp",
]);

const genericDeclaredTypes = new Set(["", "application/octet-stream"]);

export const isSupportedVerificationFile = (file: File) =>
  supportedDeclaredTypes.has(file.type.toLowerCase()) ||
  genericDeclaredTypes.has(file.type.toLowerCase());

export class VerificationFileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationFileValidationError";
  }
}

export function validateVerificationFile(file: File) {
  if (file.size <= 0) throw new Error("Filen är tom");
  if (file.size > MAX_VERIFICATION_FILE_SIZE) throw new Error("Filen är för stor");
  if (!isSupportedVerificationFile(file)) throw new Error("Filtypen stöds inte");
}

const normalizeMimeType = (mimeType: string) => {
  if (mimeType === "application/x-pdf") return "application/pdf";
  if (mimeType === "image/jpg" || mimeType === "image/pjpeg") {
    return "image/jpeg";
  }
  if (mimeType === "image/x-png") return "image/png";
  if (mimeType === "image/x-tiff") return "image/tiff";
  return mimeType;
};

const imageMimeTypes: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  heif: "image/heif",
  jpeg: "image/jpeg",
  png: "image/png",
  tiff: "image/tiff",
  webp: "image/webp",
};

const isPdf = (buffer: Buffer) => {
  if (
    buffer.length < 12 ||
    !buffer.subarray(0, 8).toString("ascii").match(/^%PDF-1\.[0-9]$/)
  ) {
    return false;
  }

  const trailerStart = Math.max(0, buffer.length - 4096);
  return buffer.lastIndexOf("%%EOF") >= trailerStart;
};

export type VerifiedVerificationFile = {
  buffer: Buffer;
  mimeType: string;
};

export async function readVerifiedVerificationFile(
  file: File
): Promise<VerifiedVerificationFile> {
  validateVerificationFile(file);
  const buffer = Buffer.from(await file.arrayBuffer());

  let mimeType: string | undefined;
  if (isPdf(buffer)) {
    mimeType = "application/pdf";
  } else {
    try {
      const metadata = await sharp(buffer, {
        failOn: "error",
        limitInputPixels: MAX_INPUT_IMAGE_PIXELS,
        sequentialRead: true,
      }).metadata();
      mimeType = metadata.format ? imageMimeTypes[metadata.format] : undefined;
    } catch {
      throw new VerificationFileValidationError(
        "Filen är inte en giltig PDF eller bild"
      );
    }
  }

  if (!mimeType) {
    throw new VerificationFileValidationError("Filformatet stöds inte");
  }

  const declaredMimeType = normalizeMimeType(file.type.toLowerCase());
  const hasOnlyGenericDeclaredType = genericDeclaredTypes.has(declaredMimeType);
  const compatibleHeifTypes =
    declaredMimeType === "image/heic" && mimeType === "image/heif";
  if (
    !hasOnlyGenericDeclaredType &&
    declaredMimeType !== mimeType &&
    !compatibleHeifTypes
  ) {
    throw new VerificationFileValidationError(
      "Filens innehåll stämmer inte med den angivna filtypen"
    );
  }

  return { buffer, mimeType };
}

export async function uploadVerificationFile(
  file: File,
  folder = "documents",
  verifiedFile?: VerifiedVerificationFile
) {
  validateVerificationFile(file);
  const { buffer, mimeType } =
    verifiedFile ?? (await readVerifiedVerificationFile(file));
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
      Body: buffer,
      ContentType: mimeType,
    },
  }).done();
  if (!result.Location) throw new Error("S3-uppladdningen saknar filadress");
  return { key, name: file.name.slice(0, 255), path: result.Location };
}

export async function deleteUploadedVerificationFile(key: string) {
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!bucket) return false;
  await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  return true;
}

export function verificationStorageKeyFromPath(
  path: string,
  config: { prefix?: string; bucket?: string } = {}
) {
  const prefix = (
    config.prefix ?? process.env.AWS_VERIFICATIONS_PATH ?? ""
  ).replace(/^\/+|\/+$/g, "");
  const bucket = (
    config.bucket ?? process.env.AWS_S3_BUCKET_NAME ?? ""
  ).replace(/^\/+|\/+$/g, "");
  if (!prefix || !bucket || !path || path.length > 4_096) return null;

  let pathname: string;
  try {
    if (path.includes("://")) {
      const url = new URL(path);
      pathname = url.pathname;
      const normalizedPath = pathname.replace(/^\/+/, "");
      const isAmazonS3Host =
        url.hostname === "s3.amazonaws.com" ||
        (url.hostname.startsWith("s3.") &&
          url.hostname.endsWith(".amazonaws.com"));
      const usesVirtualHostedBucket =
        url.hostname.startsWith(`${bucket}.s3`) &&
        url.hostname.endsWith(".amazonaws.com");
      const usesPathStyleBucket =
        isAmazonS3Host && normalizedPath.startsWith(`${bucket}/`);
      if (!usesVirtualHostedBucket && !usesPathStyleBucket) return null;
    } else {
      pathname = path;
    }
    pathname = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }

  const key =
    bucket && pathname.startsWith(`${bucket}/${prefix}/`)
      ? pathname.slice(bucket.length + 1)
      : pathname;
  return key.startsWith(`${prefix}/`) ? key : null;
}
