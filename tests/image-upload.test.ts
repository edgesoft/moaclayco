import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import {
  ImageUploadBusyError,
  ImageUploadTooLargeError,
  parseTemporaryImageUpload,
} from "../app/utils/imageUpload.server";
import { MAX_IMAGE_REQUEST_SIZE } from "../app/utils/imageUpload.shared";

const imageUploadRequest = (name = "wanja.jpg") => {
  const formData = new FormData();
  formData.append("collectionRef", "wanja");
  formData.append("draftId", "draft-12345678");
  formData.append(
    "file",
    new File([new Uint8Array([1, 2, 3, 4])], name, {
      type: "image/jpeg",
    })
  );
  return new Request("http://localhost/admin/upload", {
    body: formData,
    method: "POST",
  });
};

test("image multipart data is persisted temporarily and cleaned explicitly", async () => {
  const upload = await parseTemporaryImageUpload(imageUploadRequest());

  assert.equal(upload.file.name, "wanja.jpg");
  assert.equal(upload.file.size, 4);
  assert.equal(upload.fields.get("collectionRef"), "wanja");
  await access(upload.file.path);
  await upload.cleanup();
  await assert.rejects(access(upload.file.path));
});

test("image multipart content length is rejected before reading", async () => {
  const request = new Request("http://localhost/admin/upload", {
    body: new Uint8Array([1]),
    headers: {
      "content-length": String(MAX_IMAGE_REQUEST_SIZE + 1),
      "content-type": "multipart/form-data; boundary=test",
    },
    method: "POST",
  });

  await assert.rejects(
    parseTemporaryImageUpload(request),
    ImageUploadTooLargeError
  );
});

test("the server rejects uploads beyond its bounded active and waiting queue", async () => {
  const active = await Promise.all([
    parseTemporaryImageUpload(imageUploadRequest("active-1.jpg")),
    parseTemporaryImageUpload(imageUploadRequest("active-2.jpg")),
  ]);
  const waiting = Array.from({ length: 4 }, (_, index) =>
    parseTemporaryImageUpload(imageUploadRequest(`waiting-${index}.jpg`))
  );

  await assert.rejects(
    parseTemporaryImageUpload(imageUploadRequest("overflow.jpg")),
    ImageUploadBusyError
  );

  const completed = [];
  for (const upload of active) await upload.cleanup();
  for (const pending of waiting) {
    const upload = await pending;
    completed.push(upload.file.name);
    await upload.cleanup();
  }
  assert.deepEqual(completed, [
    "waiting-0.jpg",
    "waiting-1.jpg",
    "waiting-2.jpg",
    "waiting-3.jpg",
  ]);
});
