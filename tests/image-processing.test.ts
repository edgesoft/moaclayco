import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  MAX_CONCURRENT_IMAGE_JOBS,
  MAX_INPUT_IMAGE_PIXELS,
  optimizeImageBuffer,
  UnsupportedImageFormatError,
  withImageProcessingSlot,
} from "../app/utils/imageProcessing.server";

const svg = (width: number, height: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#b86e59"/></svg>`
  );

test("uploaded images are converted to bounded WebP output", async () => {
  const input = await sharp({
    create: {
      background: "#b86e59",
      channels: 3,
      height: 800,
      width: 1200,
    },
  })
    .png()
    .toBuffer();
  const { data, info } = await optimizeImageBuffer(input, 600);

  assert.equal(info.format, "webp");
  assert.equal(info.width, 600);
  assert.equal(info.height, 400);
  assert.ok(data.byteLength > 0);
});

test("files disguised with an image extension still need supported image content", async () => {
  await assert.rejects(
    optimizeImageBuffer(svg(1200, 800), 600),
    UnsupportedImageFormatError
  );
});

test("images with unsafe pixel dimensions are rejected before decoding", async () => {
  const unsafeSide = Math.ceil(Math.sqrt(MAX_INPUT_IMAGE_PIXELS)) + 1;

  await assert.rejects(
    optimizeImageBuffer(svg(unsafeSide, unsafeSide), 1600),
    /pixel limit/i
  );
});

test("the production pixel limit remains at 50 megapixels", () => {
  assert.equal(MAX_INPUT_IMAGE_PIXELS, 50_000_000);
});

test("image processing runs at most two jobs at once", async () => {
  let active = 0;
  let maximumActive = 0;
  let releaseJobs!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseJobs = resolve;
  });
  const jobs = Array.from({ length: 4 }, () =>
    withImageProcessingSlot(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await release;
      active -= 1;
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(maximumActive, MAX_CONCURRENT_IMAGE_JOBS);
  releaseJobs();
  await Promise.all(jobs);
});
