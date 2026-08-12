const safeCollectionPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function itemImageStorageKey(
  imageUrl: string,
  itemPath: string | undefined,
  collection: string
) {
  const normalizedPath = itemPath?.replace(/^\/+|\/+$/g, "");
  if (!normalizedPath || !safeCollectionPattern.test(collection)) return null;

  try {
    const key = new URL(imageUrl).pathname.replace(/^\/+/, "");
    const expectedPrefix = `${normalizedPath}/${collection}/`;
    if (!key.startsWith(expectedPrefix)) return null;

    const fileName = key.slice(expectedPrefix.length);
    return fileName && !fileName.includes("/") ? key : null;
  } catch {
    return null;
  }
}
