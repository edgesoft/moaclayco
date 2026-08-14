import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  FormDataParseError,
  MaxFileSizeExceededError,
  MaxFilesExceededError,
  MaxHeaderSizeExceededError,
  MaxPartsExceededError,
  MaxTotalSizeExceededError,
  parseFormData,
  type FileUpload,
} from "@remix-run/form-data-parser";
import {
  MAX_IMAGE_REQUEST_SIZE,
  MAX_IMAGE_SIZE,
  MAX_PARALLEL_IMAGE_UPLOADS,
} from "~/utils/imageUpload.shared";

const MAX_QUEUED_IMAGE_UPLOADS = 4;

export class InvalidImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImageUploadError";
  }
}

export class ImageUploadTooLargeError extends Error {
  constructor() {
    super("Image upload is too large");
    this.name = "ImageUploadTooLargeError";
  }
}

export class ImageUploadBusyError extends Error {
  constructor() {
    super("The image upload queue is full");
    this.name = "ImageUploadBusyError";
  }
}

export type TemporaryImageUpload = {
  cleanup(): Promise<void>;
  fields: FormData;
  file: {
    name: string;
    path: string;
    size: number;
    type: string;
  };
};

const isSizeLimitError = (error: unknown) =>
  error instanceof MaxFileSizeExceededError ||
  error instanceof MaxTotalSizeExceededError;

type ImageUploadQueueState = {
  active: number;
  waiting: Array<() => void>;
};

const globalForImageUploads = globalThis as typeof globalThis & {
  __moaImageUploadQueue?: ImageUploadQueueState;
};

const uploadQueue =
  globalForImageUploads.__moaImageUploadQueue ??
  (globalForImageUploads.__moaImageUploadQueue = {
    active: 0,
    waiting: [],
  });

async function acquireImageUploadSlot() {
  if (uploadQueue.active < MAX_PARALLEL_IMAGE_UPLOADS) {
    uploadQueue.active += 1;
    return;
  }
  if (uploadQueue.waiting.length >= MAX_QUEUED_IMAGE_UPLOADS) {
    throw new ImageUploadBusyError();
  }
  await new Promise<void>((resolve) => uploadQueue.waiting.push(resolve));
}

function releaseImageUploadSlot() {
  const next = uploadQueue.waiting.shift();
  if (next) {
    next();
    return;
  }
  uploadQueue.active = Math.max(0, uploadQueue.active - 1);
}

export async function parseTemporaryImageUpload(
  request: Request
): Promise<TemporaryImageUpload> {
  await acquireImageUploadSlot();
  let slotReleased = false;
  const releaseSlot = () => {
    if (slotReleased) return;
    slotReleased = true;
    releaseImageUploadSlot();
  };
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_REQUEST_SIZE) {
    releaseSlot();
    throw new ImageUploadTooLargeError();
  }

  let temporaryDirectory: string | undefined;
  let uploadedFile: TemporaryImageUpload["file"] | undefined;

  const cleanup = async () => {
    try {
      if (temporaryDirectory) {
        const directory = temporaryDirectory;
        temporaryDirectory = undefined;
        await rm(directory, { force: true, recursive: true });
      }
    } finally {
      releaseSlot();
    }
  };

  try {
    const fields = await parseFormData(
      request,
      {
        maxFileSize: MAX_IMAGE_SIZE,
        maxFiles: 1,
        maxHeaderSize: 16 * 1024,
        maxParts: 4,
        maxTotalSize: MAX_IMAGE_REQUEST_SIZE,
      },
      async (file: FileUpload) => {
        if (file.fieldName !== "file" || uploadedFile) {
          throw new InvalidImageUploadError("Unexpected image upload field");
        }

        temporaryDirectory = await mkdtemp(join(tmpdir(), "moaclay-image-"));
        const path = join(temporaryDirectory, "source");
        await pipeline(
          Readable.fromWeb(file.stream() as import("node:stream/web").ReadableStream),
          createWriteStream(path, { flags: "wx" })
        );
        uploadedFile = {
          name: file.name,
          path,
          size: file.size,
          type: file.type,
        };
        return "stored-temporarily";
      }
    );

    if (!uploadedFile || uploadedFile.size === 0) {
      throw new InvalidImageUploadError("No image was uploaded");
    }

    return { cleanup, fields, file: uploadedFile };
  } catch (error) {
    await cleanup();
    if (isSizeLimitError(error)) throw new ImageUploadTooLargeError();
    if (
      error instanceof MaxFilesExceededError ||
      error instanceof MaxHeaderSizeExceededError ||
      error instanceof MaxPartsExceededError ||
      error instanceof FormDataParseError
    ) {
      throw new InvalidImageUploadError("Image upload could not be parsed");
    }
    throw error;
  }
}
