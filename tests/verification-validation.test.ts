import assert from "node:assert/strict";
import test from "node:test";
import {
  isEmptyJournalEntry,
  normalizeJournalEntries,
  VerificationValidationError,
  withoutEmptyJournalEntries,
} from "../app/utils/verificationValidation";
import {
  journalEntryAmountsForSide,
  journalEntrySide,
} from "../app/components/admin/JournalEntryAmountField";

test("moves the full journal-entry amount when debit or credit is switched", () => {
  assert.deepEqual(
    journalEntryAmountsForSide({ debit: 125.5, credit: 0 }, "credit"),
    { debit: 0, credit: 125.5 }
  );
  assert.deepEqual(
    journalEntryAmountsForSide({ debit: 0, credit: 42 }, "debit"),
    { debit: 42, credit: 0 }
  );
  assert.equal(journalEntrySide({ debit: 0, credit: 42 }), "credit");
});

test("normalizes and accepts a balanced verification", () => {
  assert.deepEqual(
    normalizeJournalEntries([
      { account: 1930, debit: 125.5 },
      { account: 3001, credit: 100.4 },
      { account: 2611, credit: 25.1 },
    ]),
    [
      { account: 1930, debit: 125.5, credit: 0 },
      { account: 3001, debit: 0, credit: 100.4 },
      { account: 2611, debit: 0, credit: 25.1 },
    ]
  );
});

test("ignores a completely empty trailing draft row", () => {
  const entries = [
    { account: 1930, debit: 100, credit: 0 },
    { account: 3001, debit: 0, credit: 100 },
    { account: 0, debit: 0, credit: 0 },
  ];

  assert.equal(isEmptyJournalEntry(entries[2]), true);
  assert.deepEqual(withoutEmptyJournalEntries(entries), entries.slice(0, 2));
});

test("keeps a partially completed draft row for validation", () => {
  const partialEntry = { account: 3001, debit: 0, credit: 0 };

  assert.equal(isEmptyJournalEntry(partialEntry), false);
  assert.deepEqual(withoutEmptyJournalEntries([partialEntry]), [partialEntry]);
});

test("rejects an unbalanced verification", () => {
  assert.throws(
    () =>
      normalizeJournalEntries([
        { account: 1930, debit: 100 },
        { account: 3001, credit: 99 },
      ]),
    VerificationValidationError
  );
});

test("rejects a row with amounts on both sides", () => {
  assert.throws(
    () =>
      normalizeJournalEntries([
        { account: 1930, debit: 100, credit: 100 },
        { account: 3001, credit: 100 },
      ]),
    /exakt en av debet eller kredit/
  );
});

test("rejects fractions smaller than one öre", () => {
  assert.throws(
    () =>
      normalizeJournalEntries([
        { account: 1930, debit: 100.001 },
        { account: 3001, credit: 100.001 },
      ]),
    /högst två decimaler/
  );
});

test("rejects legacy account 2050 for new entries", () => {
  assert.throws(
    () =>
      normalizeJournalEntries([
        { account: 2050, debit: 100 },
        { account: 2012, credit: 100 },
      ]),
    /utgångna kontot 2050/
  );
});
