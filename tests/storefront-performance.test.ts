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

test("storefront image loading prioritizes visible products and defers later media", async () => {
  const home = await readFile(path.resolve("app/routes/_index.tsx"), "utf8");
  const collection = await readFile(
    path.resolve("app/routes/collections.$collection.tsx"),
    "utf8"
  );
  const imageZoom = await readFile(
    path.resolve("app/hooks/useInlineImageZoom.ts"),
    "utf8"
  );
  const styles = await readFile(path.resolve("app/styles/app.css"), "utf8");

  assert.match(home, /fetchPriority=\{index === 0 \? "high" : "auto"\}/);
  assert.match(home, /className="mcc-product-journey__detail-image"[\s\S]*?loading="lazy"/);
  assert.match(home, /className="mcc-collection-scene__parallax"[\s\S]*?loading="lazy"/);
  assert.match(collection, /fetchPriority="high"/);
  assert.match(collection, /loading=\{position < 2 \? "eager" : "lazy"\}/);
  assert.match(collection, /position < 2 \? 1_200 : 1_800/);
  assert.doesNotMatch(collection, /position < 2 \? 80 : 240/);
  assert.match(collection, /const detailPreloadRef = useRef/);
  assert.match(
    collection,
    /preload\.decode\(\)\.then\(commitDetailImage\)\.catch\(clearRequest\)/
  );
  assert.doesNotMatch(
    collection,
    /const handleZoomIntent = useCallback\(\(\) => \{\s*if \(activeImage\) setDetailImage/
  );

  const pointerEnterHandler = imageZoom.match(
    /const handlePointerEnter[\s\S]*?\n {2}};/
  );
  assert.ok(pointerEnterHandler);
  assert.doesNotMatch(pointerEnterHandler[0], /onZoomIntent\(\)/);
  assert.doesNotMatch(
    styles,
    /\.mcc-shop-item\s*\{[^}]*content-visibility:\s*auto/
  );
});

test("production context excludes local development bundles", async () => {
  const dockerIgnore = await readFile(path.resolve(".dockerignore"), "utf8");
  assert.match(dockerIgnore, /^\/public\/build\*$/m);
});
