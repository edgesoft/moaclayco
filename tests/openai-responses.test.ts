import assert from "node:assert/strict";
import test from "node:test";
import { suggestVerificationFileLabel } from "../app/services/verification-file-label.server";

test("OpenAI Responses SDK parses a structured file-label response", async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;

  process.env.OPENAI_API_KEY = "test-openai-key";
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));

    return new Response(
      JSON.stringify({
        id: "resp_test",
        object: "response",
        created_at: 1,
        status: "completed",
        model: "gpt-5.6-terra",
        output: [
          {
            id: "msg_test",
            type: "message",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                annotations: [],
                logprobs: [],
                text: JSON.stringify({
                  label: "  Leverantörsfaktura 1234.pdf  ",
                  documentType: "supplier_invoice",
                  summary: "Faktura för bokföringen.",
                  confidence: 0.98,
                  warnings: [],
                }),
              },
            ],
          },
        ],
      }),
      { headers: { "content-type": "application/json" }, status: 200 }
    );
  }) as typeof fetch;

  try {
    const suggestion = await suggestVerificationFileLabel({
      buffer: Buffer.from("not-a-real-image"),
      fileName: "scan.png",
      mimeType: "image/png",
    });

    assert.equal(suggestion.label, "Leverantörsfaktura 1234.pdf");
    assert.equal(suggestion.documentType, "supplier_invoice");
    assert.equal(requestBody?.model, "gpt-5.6-terra");
    assert.equal(requestBody?.store, false);
    assert.deepEqual(requestBody?.reasoning, { effort: "low" });
    assert.equal(
      (requestBody?.text as { format?: { type?: string } })?.format?.type,
      "json_schema"
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  }
});
