import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  readVerifiedVerificationFile,
  VerificationFileValidationError,
} from "../app/services/verification-files.server";

const validPng = () =>
  sharp({
    create: {
      background: "#b86e59",
      channels: 3,
      height: 10,
      width: 10,
    },
  })
    .png()
    .toBuffer();

test("verification images are inspected and receive a normalized MIME type", async () => {
  const file = new File([await validPng()], "kvitto.png", {
    type: "image/png",
  });

  const verified = await readVerifiedVerificationFile(file);
  assert.equal(verified.mimeType, "image/png");
  assert.ok(verified.buffer.byteLength > 0);
});

test("verification files reject a declared MIME type that differs from content", async () => {
  const file = new File([await validPng()], "kvitto.pdf", {
    type: "application/pdf",
  });

  await assert.rejects(
    readVerifiedVerificationFile(file),
    VerificationFileValidationError
  );
});

test("verification files reject arbitrary data disguised as an image", async () => {
  const file = new File(["<script>alert('x')</script>"], "kvitto.png", {
    type: "image/png",
  });

  await assert.rejects(
    readVerifiedVerificationFile(file),
    /inte en giltig PDF eller bild/
  );
});

test("verification files require an explicitly supported browser MIME type", async () => {
  const file = new File([await validPng()], "kvitto.bin", {
    type: "application/octet-stream",
  });

  await assert.rejects(readVerifiedVerificationFile(file), /Filtypen stöds inte/);
});
