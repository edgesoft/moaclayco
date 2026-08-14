const PRIVATE_CACHE_CONTROL = "private, no-store";

export function appendServerTiming(target: Headers, source: Headers) {
  const timing = source.get("Server-Timing");
  if (!timing) return;

  const existing = target.get("Server-Timing");
  target.set("Server-Timing", existing ? `${existing}, ${timing}` : timing);
}

export function mergePrivateRouteHeaders(
  parentHeaders: Headers,
  loaderHeaders: Headers
) {
  const headers = new Headers(parentHeaders);
  if (!headers.has("Cache-Control")) {
    headers.set("Cache-Control", PRIVATE_CACHE_CONTROL);
  }
  appendServerTiming(headers, loaderHeaders);
  return headers;
}

export function privateRootHeaders(loaderHeaders: Headers) {
  const headers = new Headers({ "Cache-Control": PRIVATE_CACHE_CONTROL });
  appendServerTiming(headers, loaderHeaders);
  return headers;
}
