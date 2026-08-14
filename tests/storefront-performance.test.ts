import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("public root does not eagerly load editor or toast assets", async () => {
  const root = await readFile(path.resolve("app/root.tsx"), "utf8");

  assert.doesNotMatch(root, /item-editor\.css\?url/);
  assert.doesNotMatch(root, /react-toastify\/dist\/ReactToastify\.css\?url/);
  assert.doesNotMatch(root, /styles\/toast\.css\?url/);
  assert.match(root, /lazy\(\(\) => import\("\.\/components\/ToastRegion"\)\)/);
});

test("below-fold storefront images stay lazy and the hero remains prioritized", async () => {
  const home = await readFile(path.resolve("app/routes/_index.tsx"), "utf8");
  const collection = await readFile(
    path.resolve("app/routes/collections.$collection.tsx"),
    "utf8"
  );

  assert.match(home, /fetchPriority=\{index === 0 \? "high" : "auto"\}/);
  assert.match(home, /className="mcc-product-journey__detail-image"[\s\S]*?loading="lazy"/);
  assert.match(home, /className="mcc-collection-scene__parallax"[\s\S]*?loading="lazy"/);
  assert.match(collection, /fetchPriority="high"/);
  assert.match(collection, /position < 2 \? 1_200 : 1_800/);
  assert.doesNotMatch(collection, /position < 2 \? 80 : 240/);
});

test("production context excludes local development bundles", async () => {
  const dockerIgnore = await readFile(path.resolve(".dockerignore"), "utf8");
  assert.match(dockerIgnore, /^\/public\/build\*$/m);
});
