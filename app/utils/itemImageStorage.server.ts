const safeCollectionPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function itemStorageKeyFromUrl(
  imageUrl: string,
  itemPath: string | undefined
) {
  const normalizedPath = itemPath?.replace(/^\/+|\/+$/g, "");
  if (!normalizedPath) return null;

  try {
    const key = new URL(imageUrl).pathname.replace(/^\/+/, "");
    return key.startsWith(`${normalizedPath}/`) && key.length > normalizedPath.length + 1
      ? key
      : null;
  } catch {
    return null;
  }
}

export function itemImageStorageKey(
  imageUrl: string,
  itemPath: string | undefined,
  collection: string
) {
  const normalizedPath = itemPath?.replace(/^\/+|\/+$/g, "");
  if (!normalizedPath || !safeCollectionPattern.test(collection)) return null;

  const key = itemStorageKeyFromUrl(imageUrl, normalizedPath);
  if (!key) return null;

  const expectedPrefix = `${normalizedPath}/${collection}/`;
  if (!key.startsWith(expectedPrefix)) return null;

  const fileName = key.slice(expectedPrefix.length);
  return fileName && !fileName.includes("/") ? key : null;
}
