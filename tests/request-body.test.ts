import assert from "node:assert/strict";
import test from "node:test";
import {
  parseFormDataWithinLimit,
  readTextWithinLimit,
  RequestBodyTooLargeError,
} from "../app/utils/requestBody.server";

test("form data is parsed when the request stays within the limit", async () => {
  const request = new Request("http://localhost/upload", {
    body: "name=wanja",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  const formData = await parseFormDataWithinLimit(request, 64);
  assert.equal(formData.get("name"), "wanja");
});

test("content length is rejected before reading an oversized body", async () => {
  const request = new Request("http://localhost/upload", {
    body: "name=wanja",
    headers: {
      "Content-Length": "1000",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  await assert.rejects(
    parseFormDataWithinLimit(request, 64),
    RequestBodyTooLargeError
  );
  assert.equal(request.bodyUsed, false);
});

test("streamed bodies are limited even without content length", async () => {
  const request = new Request("http://localhost/upload", {
    body: "name=wanja",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
  });

  await assert.rejects(
    parseFormDataWithinLimit(request, 4),
    RequestBodyTooLargeError
  );
});

test("text bodies preserve their exact content within the limit", async () => {
  const payload = '{"type":"payment_intent.succeeded"}';
  const request = new Request("http://localhost/webhook", {
    body: payload,
    method: "POST",
  });

  assert.equal(await readTextWithinLimit(request, 128), payload);
});

test("streamed text bodies are limited without content length", async () => {
  const request = new Request("http://localhost/webhook", {
    body: "oversized webhook payload",
    method: "POST",
  });

  await assert.rejects(
    readTextWithinLimit(request, 8),
    RequestBodyTooLargeError
  );
});
