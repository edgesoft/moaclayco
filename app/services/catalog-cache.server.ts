const DEFAULT_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

type CatalogCacheEntry = {
  expiresAt: number;
  value: unknown;
};

type CatalogCacheState = {
  entries: Map<string, CatalogCacheEntry>;
  generation: number;
  pending: Map<string, Promise<unknown>>;
};

type CatalogCacheOptions = {
  now?: () => number;
  onStatus?: (status: "hit" | "miss" | "shared") => void;
  ttlMs?: number;
};

const globalForCatalogCache = globalThis as typeof globalThis & {
  __moaCatalogCache?: CatalogCacheState;
};

const cache =
  globalForCatalogCache.__moaCatalogCache ??
  (globalForCatalogCache.__moaCatalogCache = {
    entries: new Map(),
    generation: 0,
    pending: new Map(),
  });

export const catalogCacheKeys = {
  collections: "catalog:collections",
  collection: (shortUrl: string) => `catalog:collection:${shortUrl}`,
  latestItems: "catalog:latest-items",
};

export async function readCatalogCache<T>(
  key: string,
  load: () => Promise<T>,
  options: CatalogCacheOptions = {}
): Promise<T> {
  const now = options.now ?? Date.now;
  const existing = cache.entries.get(key);
  if (existing && existing.expiresAt > now()) {
    options.onStatus?.("hit");
    return existing.value as T;
  }

  const pending = cache.pending.get(key);
  if (pending) {
    options.onStatus?.("shared");
    return pending as Promise<T>;
  }

  options.onStatus?.("miss");
  const generationAtStart = cache.generation;
  let pendingLoad: Promise<T>;
  pendingLoad = load()
    .then((value) => {
      if (cache.generation === generationAtStart) {
        cache.entries.set(key, {
          expiresAt: now() + (options.ttlMs ?? DEFAULT_CATALOG_CACHE_TTL_MS),
          value,
        });
      }
      return value;
    })
    .finally(() => {
      if (cache.pending.get(key) === pendingLoad) {
        cache.pending.delete(key);
      }
    });

  cache.pending.set(key, pendingLoad);
  return pendingLoad;
}

export function invalidateCatalogCache() {
  cache.generation += 1;
  cache.entries.clear();
  cache.pending.clear();
}
