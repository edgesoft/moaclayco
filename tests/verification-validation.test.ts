import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeJournalEntries,
  VerificationValidationError,
} from "../app/utils/verificationValidation";

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

test("allows account 2050 only for an explicit legacy correction", () => {
  assert.deepEqual(
    normalizeJournalEntries(
      [
        { account: 2050, debit: 1 },
        { account: 8314, credit: 1 },
      ],
      { allowLegacyAccount2050: true }
    ),
    [
      { account: 2050, debit: 1, credit: 0 },
      { account: 8314, debit: 0, credit: 1 },
    ]
  );
});
