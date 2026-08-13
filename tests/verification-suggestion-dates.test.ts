import assert from "node:assert/strict";
import test from "node:test";
import { getVerificationSuggestionDateNotice } from "../app/utils/verificationSuggestionDates";

test("blocks a suggested date outside the selected accounting year", () => {
  const notice = getVerificationSuggestionDateNotice({
    dateKey: "2024-10-30",
    fiscalYear: 2025,
    now: new Date("2026-08-13T12:00:00Z"),
  });

  assert.equal(notice?.kind, "outside_year");
  assert.equal(notice?.blocksAutomaticDate, true);
  assert.match(notice?.message ?? "", /bokföringsår 2025/);
});

test("warns about an old date in the selected accounting year", () => {
  const notice = getVerificationSuggestionDateNotice({
    dateKey: "2025-01-15",
    fiscalYear: 2025,
    now: new Date("2025-08-13T12:00:00Z"),
  });

  assert.equal(notice?.kind, "old");
  assert.equal(notice?.blocksAutomaticDate, false);
  assert.match(notice?.message ?? "", /mer än 90 dagar/);
});

test("accepts a recent date in the selected accounting year", () => {
  assert.equal(
    getVerificationSuggestionDateNotice({
      dateKey: "2026-08-12",
      fiscalYear: 2026,
      now: new Date("2026-08-13T12:00:00Z"),
    }),
    null
  );
});
