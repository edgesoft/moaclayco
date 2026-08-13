import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  readVerifiedVerificationFile,
  VerificationFileValidationError,
  verificationStorageKeyFromPath,
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

test("derives only owned verification storage keys from saved file paths", () => {
  const config = {
    prefix: "moaclayco/verifications",
    bucket: "moaclayco-files",
  };

  assert.equal(
    verificationStorageKeyFromPath(
      "https://moaclayco-files.s3.eu-north-1.amazonaws.com/moaclayco/verifications/216/kvitto.pdf",
      config
    ),
    "moaclayco/verifications/216/kvitto.pdf"
  );
  assert.equal(
    verificationStorageKeyFromPath(
      "https://s3.eu-north-1.amazonaws.com/moaclayco-files/moaclayco/verifications/documents/faktura.pdf",
      config
    ),
    "moaclayco/verifications/documents/faktura.pdf"
  );
  assert.equal(
    verificationStorageKeyFromPath(
      "https://example.com/other-prefix/private.pdf",
      config
    ),
    null
  );
  assert.equal(
    verificationStorageKeyFromPath(
      "https://example.com/moaclayco/verifications/private.pdf",
      config
    ),
    null
  );
  assert.equal(
    verificationStorageKeyFromPath(
      "https://moaclayco-files.evil.example/moaclayco/verifications/private.pdf",
      config
    ),
    null
  );
  assert.equal(
    verificationStorageKeyFromPath("https://example.com/%E0%A4%A", config),
    null
  );
});
