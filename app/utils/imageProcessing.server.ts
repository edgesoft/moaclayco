import sharp from "sharp";

export const MAX_INPUT_IMAGE_PIXELS = 50_000_000;

export function optimizeImageBuffer(inputBuffer: Buffer, maxWidth: number) {
  return sharp(inputBuffer, {
    failOn: "error",
    limitInputPixels: MAX_INPUT_IMAGE_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ effort: 4, quality: 88 })
    .toBuffer({ resolveWithObject: true });
}
