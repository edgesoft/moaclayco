export class RequestBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

export const MAX_STANDARD_FORM_REQUEST_SIZE = 256 * 1024;

async function readRequestBodyWithinLimit(
  request: Request,
  maxBytes: number
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive integer");
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes);
  }

  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

export async function parseFormDataWithinLimit(
  request: Request,
  maxBytes: number
) {
  const contentType = request.headers.get("content-type");
  if (!contentType) throw new Error("Request is missing Content-Type");

  const body = await readRequestBodyWithinLimit(request, maxBytes);
  return new Response(body, {
    headers: { "Content-Type": contentType },
  }).formData();
}

export async function readTextWithinLimit(request: Request, maxBytes: number) {
  const body = await readRequestBodyWithinLimit(request, maxBytes);
  return new TextDecoder().decode(body);
}
