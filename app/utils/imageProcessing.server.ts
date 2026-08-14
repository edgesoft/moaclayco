import sharp from "sharp";

export const MAX_INPUT_IMAGE_PIXELS = 50_000_000;
export const MAX_CONCURRENT_IMAGE_JOBS = 2;
export const MAX_QUEUED_IMAGE_JOBS = 8;

const acceptedInputFormats = new Set(["heif", "jpeg", "png", "webp"]);

export class UnsupportedImageFormatError extends Error {
  constructor(format?: string) {
    super(`Unsupported image format: ${format ?? "unknown"}`);
    this.name = "UnsupportedImageFormatError";
  }
}

export class ImageProcessingBusyError extends Error {
  constructor() {
    super("The image processing queue is full");
    this.name = "ImageProcessingBusyError";
  }
}

type ImageProcessingQueueState = {
  active: number;
  waiting: Array<() => void>;
};

const globalForImageProcessing = globalThis as typeof globalThis & {
  __moaImageProcessingQueue?: ImageProcessingQueueState;
};

const queue =
  globalForImageProcessing.__moaImageProcessingQueue ??
  (globalForImageProcessing.__moaImageProcessingQueue = {
    active: 0,
    waiting: [],
  });

async function acquireImageProcessingSlot() {
  if (queue.active < MAX_CONCURRENT_IMAGE_JOBS) {
    queue.active += 1;
    return;
  }
  if (queue.waiting.length >= MAX_QUEUED_IMAGE_JOBS) {
    throw new ImageProcessingBusyError();
  }
  await new Promise<void>((resolve) => queue.waiting.push(resolve));
}

function releaseImageProcessingSlot() {
  const next = queue.waiting.shift();
  if (next) {
    next();
    return;
  }
  queue.active = Math.max(0, queue.active - 1);
}

export async function withImageProcessingSlot<T>(work: () => Promise<T>) {
  await acquireImageProcessingSlot();
  try {
    return await work();
  } finally {
    releaseImageProcessingSlot();
  }
}

const sharpInputOptions = {
  failOn: "error" as const,
  limitInputPixels: MAX_INPUT_IMAGE_PIXELS,
  sequentialRead: true,
};

async function assertSupportedImage(input: Buffer | string) {
  const metadata = await sharp(input, sharpInputOptions).metadata();
  if (!metadata.format || !acceptedInputFormats.has(metadata.format)) {
    throw new UnsupportedImageFormatError(metadata.format);
  }
}

async function optimizeImage(input: Buffer | string, maxWidth: number) {
  await assertSupportedImage(input);
  return sharp(input, sharpInputOptions)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ effort: 4, quality: 88 })
    .toBuffer({ resolveWithObject: true });
}

export function optimizeImageBuffer(inputBuffer: Buffer, maxWidth: number) {
  return optimizeImage(inputBuffer, maxWidth);
}

export function optimizeImageFile(inputPath: string, maxWidth: number) {
  return withImageProcessingSlot(() => optimizeImage(inputPath, maxWidth));
}
