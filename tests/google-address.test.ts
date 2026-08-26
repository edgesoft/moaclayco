import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSwedishPostalCode,
  shouldUseNativeAddressAutocomplete,
  swedishAddressFromGoogle,
} from "../app/utils/googleAddress";

test("only enables native address suggestions when Google is unavailable", () => {
  assert.equal(shouldUseNativeAddressAutocomplete("browser-key", false), false);
  assert.equal(shouldUseNativeAddressAutocomplete("browser-key", true), true);
  assert.equal(shouldUseNativeAddressAutocomplete("", false), true);
});

test("maps Swedish Google address components to the special-order fields", () => {
  const address = swedishAddressFromGoogle([
    { longText: "Datavägen", types: ["route"] },
    { longText: "2A", types: ["street_number"] },
    { longText: "17543", types: ["postal_code"] },
    { longText: "Järfälla", types: ["postal_town"] },
  ]);

  assert.deepEqual(address, {
    city: "Järfälla",
    postaddress: "Datavägen 2A",
    zipcode: "175 43",
  });
});

test("supports locality fallback and legacy component field names", () => {
  const address = swedishAddressFromGoogle([
    { long_name: "Storgatan", types: ["route"] },
    { long_name: "1", types: ["street_number"] },
    { long_name: "114 44", types: ["postal_code"] },
    { long_name: "Stockholm", types: ["locality"] },
  ]);

  assert.deepEqual(address, {
    city: "Stockholm",
    postaddress: "Storgatan 1",
    zipcode: "114 44",
  });
});

test("keeps the selected suggestion when Google omits street components", () => {
  const address = swedishAddressFromGoogle(
    [{ longText: "Göteborg", types: ["postal_town"] }],
    "Lilla Nygatan 8"
  );

  assert.equal(address.postaddress, "Lilla Nygatan 8");
  assert.equal(address.city, "Göteborg");
  assert.equal(address.zipcode, "");
});

test("only inserts a Swedish postal-code space for five digits", () => {
  assert.equal(formatSwedishPostalCode("12345"), "123 45");
  assert.equal(formatSwedishPostalCode("SE-123 45"), "SE-123 45");
});
