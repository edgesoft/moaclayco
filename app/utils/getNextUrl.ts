export function getNextUrl(request: Request) {
  let url = new URL(request.url);
  let hostname = url.hostname;
  let proto = request.headers.get("X-Forwarded-Proto") ?? url.protocol;

  url.host =
    request.headers.get("X-Forwarded-Host") ??
    request.headers.get("host") ??
    url.host;
  url.protocol = "https:";

  return { url: url.toString(), proto, hostname, port: url.port };
}
