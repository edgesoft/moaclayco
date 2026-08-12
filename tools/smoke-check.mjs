const argumentsByName = new Map(
  process.argv.slice(2).map((argument) => {
    const [name, ...valueParts] = argument.split("=");
    return [name, valueParts.join("=")];
  })
);

const url =
  argumentsByName.get("--url") ??
  process.env.SMOKE_BASE_URL ??
  "http://localhost:3000";
const timeout = Number(
  argumentsByName.get("--timeout") ?? process.env.SMOKE_TIMEOUT_MS ?? 10_000
);

if (!Number.isFinite(timeout) || timeout <= 0) {
  console.error("Smoke check timeout must be a positive number.");
  process.exit(1);
}

try {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) {
    throw new Error(`Expected a successful response, received ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    throw new Error(`Expected HTML, received ${contentType || "no content type"}.`);
  }

  const html = await response.text();
  const buildAssetPaths = [
    ...html.matchAll(/(?:src|href)="(\/build[^"?#]+(?:\?[^"#]*)?)"/g),
  ].map((match) => match[1]);
  const representativeAssets = [
    buildAssetPaths.find((path) => path.includes(".css")),
    buildAssetPaths.find((path) => path.includes(".js")),
  ].filter((path, index, paths) => path && paths.indexOf(path) === index);

  if (representativeAssets.length === 0) {
    throw new Error("HTML did not reference any CSS or JavaScript build assets.");
  }

  for (const assetPath of representativeAssets) {
    const assetUrl = new URL(assetPath, response.url);
    const assetResponse = await fetch(assetUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });

    if (!assetResponse.ok) {
      throw new Error(
        `Build asset ${assetUrl.pathname} returned ${assetResponse.status}.`
      );
    }
  }

  console.log(
    `Smoke check passed: ${response.status} ${response.url} (${representativeAssets.length} build assets)`
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke check failed for ${url}: ${message}`);
  process.exit(1);
}
