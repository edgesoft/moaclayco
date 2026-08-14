import assert from "node:assert/strict";
import test from "node:test";
import {
  itemImageStorageKey,
  itemStorageKeyFromUrl,
} from "../app/utils/itemImageStorage.server";

test("item image keys are limited to the selected collection", () => {
  assert.equal(
    itemImageStorageKey(
      "https://38vabcm3.twic.pics/items-stage/wanja/image.webp?width=800",
      "items-stage",
      "wanja"
    ),
    "items-stage/wanja/image.webp"
  );

  assert.equal(
    itemImageStorageKey(
      "https://38vabcm3.twic.pics/items-stage/molly/image.webp",
      "items-stage",
      "wanja"
    ),
    null
  );
});

test("item image keys reject prefix collisions and nested paths", () => {
  assert.equal(
    itemImageStorageKey(
      "https://example.com/items-stage/wanja-archive/image.webp",
      "items-stage",
      "wanja"
    ),
    null
  );
  assert.equal(
    itemImageStorageKey(
      "https://example.com/items-stage/wanja/archive/image.webp",
      "items-stage",
      "wanja"
    ),
    null
  );
});

test("stored item keys remain removable after a collection is renamed", () => {
  assert.equal(
    itemStorageKeyFromUrl(
      "https://38vabcm3.twic.pics/items-stage/tidigare-namn/image.webp?width=800",
      "/items-stage/"
    ),
    "items-stage/tidigare-namn/image.webp"
  );
  assert.equal(
    itemStorageKeyFromUrl(
      "https://38vabcm3.twic.pics/items-production/wanja/image.webp",
      "items-stage"
    ),
    null
  );
});
