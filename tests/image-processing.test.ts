import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_INPUT_IMAGE_PIXELS,
  optimizeImageBuffer,
} from "../app/utils/imageProcessing.server";

const svg = (width: number, height: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#b86e59"/></svg>`
  );

test("uploaded images are converted to bounded WebP output", async () => {
  const { data, info } = await optimizeImageBuffer(svg(1200, 800), 600);

  assert.equal(info.format, "webp");
  assert.equal(info.width, 600);
  assert.equal(info.height, 400);
  assert.ok(data.byteLength > 0);
});

test("images with unsafe pixel dimensions are rejected before decoding", async () => {
  const unsafeSide = Math.ceil(Math.sqrt(MAX_INPUT_IMAGE_PIXELS)) + 1;

  await assert.rejects(
    optimizeImageBuffer(svg(unsafeSide, unsafeSide), 1600),
    /pixel limit/i
  );
});
