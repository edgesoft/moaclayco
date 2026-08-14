import assert from "node:assert/strict";
import test from "node:test";
import {
  invalidateCatalogCache,
  readCatalogCache,
} from "../app/services/catalog-cache.server";
import {
  formatServerTiming,
  measureServerTiming,
  type ServerTimingMetric,
} from "../app/utils/serverTiming.server";
import { mergePrivateRouteHeaders } from "../app/utils/responseHeaders";

test("catalog cache reuses values until its fallback TTL expires", async () => {
  invalidateCatalogCache();
  let now = 100;
  let loads = 0;
  const statuses: string[] = [];
  const load = async () => ({ revision: ++loads });
  const options = {
    now: () => now,
    onStatus: (status: "hit" | "miss" | "shared") => statuses.push(status),
    ttlMs: 50,
  };

  const first = await readCatalogCache("ttl", load, options);
  const second = await readCatalogCache("ttl", load, options);
  now = 151;
  const third = await readCatalogCache("ttl", load, options);

  assert.deepEqual(first, { revision: 1 });
  assert.equal(second, first);
  assert.deepEqual(third, { revision: 2 });
  assert.deepEqual(statuses, ["miss", "hit", "miss"]);
});

test("catalog cache shares concurrent reads", async () => {
  invalidateCatalogCache();
  let resolveLoad: ((value: string) => void) | undefined;
  let loads = 0;
  const statuses: string[] = [];
  const load = () => {
    loads += 1;
    return new Promise<string>((resolve) => {
      resolveLoad = resolve;
    });
  };
  const options = {
    onStatus: (status: "hit" | "miss" | "shared") => statuses.push(status),
  };

  const first = readCatalogCache("concurrent", load, options);
  const second = readCatalogCache("concurrent", load, options);
  resolveLoad?.("catalog");

  assert.equal(await first, "catalog");
  assert.equal(await second, "catalog");
  assert.equal(loads, 1);
  assert.deepEqual(statuses, ["miss", "shared"]);
});

test("invalidation prevents an older in-flight read from repopulating cache", async () => {
  invalidateCatalogCache();
  let resolveOldLoad: ((value: string) => void) | undefined;
  const oldRead = readCatalogCache(
    "race",
    () =>
      new Promise<string>((resolve) => {
        resolveOldLoad = resolve;
      })
  );

  invalidateCatalogCache();
  resolveOldLoad?.("old");
  assert.equal(await oldRead, "old");
  assert.equal(
    await readCatalogCache("race", async () => "fresh"),
    "fresh"
  );
});

test("server timing is preserved while child routes stay private", async () => {
  const metrics: ServerTimingMetric[] = [];
  await measureServerTiming(metrics, "catalog", async () => "ok", "query");
  const loaderHeaders = new Headers({
    "Server-Timing": formatServerTiming(metrics),
  });
  const parentHeaders = new Headers({
    "Cache-Control": "private, no-store",
    "Server-Timing": 'root;dur=1.0;desc="layout"',
  });
  const headers = mergePrivateRouteHeaders(parentHeaders, loaderHeaders);

  assert.equal(headers.get("Cache-Control"), "private, no-store");
  assert.match(headers.get("Server-Timing") ?? "", /root;dur=1\.0/);
  assert.match(headers.get("Server-Timing") ?? "", /catalog;dur=/);
});
