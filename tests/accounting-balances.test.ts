import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVatReportEntries,
  buildVatTaxAccountEntries,
} from "../app/utils/vat";
import {
  accountingDateKey,
  accountingMonthKey,
  accountingMonthKeyForVerification,
  accountingYear,
  formatStockholmDateTime,
  getAccountingDateBounds,
  getAccountingMonthBounds,
  getAccountingYearBounds,
  parseStockholmDateTime,
} from "../app/utils/accountingDates";
import { buildTaxAccountJournalEntries } from "../app/utils/taxAccount";
import { synchronizeIncomingBalance } from "../app/services/verification.server";

const totals = (entries: Array<{ debit: number; credit: number }>) => ({
  debit: entries.reduce((sum, entry) => sum + entry.debit, 0),
  credit: entries.reduce((sum, entry) => sum + entry.credit, 0),
});

test("existing IB is cleared when the recalculated balance is zero", async () => {
  let saveCalls = 0;
  const incomingBalance = {
    recordType: "journal",
    journalEntries: [
      { account: 1930, debit: 1_500, credit: 0 },
      { account: 2018, debit: 0, credit: 1_500 },
    ],
    save: async () => {
      saveCalls += 1;
    },
  };

  const result = await synchronizeIncomingBalance(incomingBalance, []);

  assert.equal(result, incomingBalance);
  assert.equal(incomingBalance.recordType, "incomingBalance");
  assert.deepEqual(incomingBalance.journalEntries, []);
  assert.equal(saveCalls, 1);
});

test("VAT report closes a VAT liability to credit 2650", () => {
  const entries = buildVatReportEntries(100, -250);
  assert.deepEqual(entries, [
    { account: 2640, debit: 0, credit: 100 },
    { account: 2611, debit: 250, credit: 0 },
    { account: 2650, debit: 0, credit: 150 },
  ]);
  assert.deepEqual(totals(entries), { debit: 250, credit: 250 });
});

test("VAT report closes a VAT receivable to debit 2650", () => {
  const entries = buildVatReportEntries(300, -250);
  assert.deepEqual(entries, [
    { account: 2640, debit: 0, credit: 300 },
    { account: 2611, debit: 250, credit: 0 },
    { account: 2650, debit: 50, credit: 0 },
  ]);
  assert.deepEqual(totals(entries), { debit: 300, credit: 300 });
});

test("VAT rounding is posted on 3740 and remains balanced", () => {
  const entries = buildVatReportEntries(100.25, -250.75);
  assert.deepEqual(entries.at(-1), {
    account: 3740,
    debit: 0.5,
    credit: 0,
  });
  assert.deepEqual(totals(entries), { debit: 251.25, credit: 251.25 });
});

test("zero VAT returns have no journal rows", () => {
  assert.deepEqual(buildVatReportEntries(0, 0), []);
});

test("VAT tax-account posting does not combine the separate funding event", () => {
  assert.deepEqual(buildVatTaxAccountEntries(-239), [
    { account: 2650, debit: 239, credit: 0 },
    { account: 2012, debit: 0, credit: 239 },
  ]);
  assert.deepEqual(buildVatTaxAccountEntries(50), [
    { account: 2012, debit: 50, credit: 0 },
    { account: 2650, debit: 0, credit: 50 },
  ]);
});

test("tax-account events use separate, sole-trader postings", () => {
  assert.deepEqual(
    buildTaxAccountJournalEntries({ type: "preliminaryTax", amount: 399 }),
    [
      { account: 2013, debit: 399, credit: 0 },
      { account: 2012, debit: 0, credit: 399 },
    ]
  );
  assert.deepEqual(buildTaxAccountJournalEntries({ type: "interest", amount: 4 }), [
    { account: 2012, debit: 4, credit: 0 },
    { account: 8314, debit: 0, credit: 4 },
  ]);
  assert.deepEqual(
    buildTaxAccountJournalEntries({
      type: "deposit",
      amount: 399,
      sourceAccount: 2018,
    }),
    [
      { account: 2012, debit: 399, credit: 0 },
      { account: 2018, debit: 0, credit: 399 },
    ]
  );
});

test("VAT reports are grouped by submission month while retaining their period metadata", () => {
  assert.equal(
    accountingMonthKeyForVerification({
      verificationDate: "2026-04-19T12:00:00.000Z",
      metadata: [{ key: "vatReport", value: "2026-03" }],
    }),
    "2026-04"
  );
});

test("accounting month boundaries follow Stockholm time", () => {
  const march = getAccountingMonthBounds("2026-03");
  const april = getAccountingMonthBounds("2026-04");
  assert.ok(march && april);
  assert.equal(march.start.toISOString(), "2026-02-28T23:00:00.000Z");
  assert.equal(march.end.toISOString(), "2026-03-31T22:00:00.000Z");
  assert.equal(april.start.toISOString(), "2026-03-31T22:00:00.000Z");
  assert.equal(accountingMonthKey(new Date("2026-03-31T22:30:00.000Z")), "2026-04");
});

test("accounting year boundaries follow Stockholm time", () => {
  const bounds = getAccountingYearBounds(2026);
  assert.ok(bounds);
  assert.equal(bounds.start.toISOString(), "2025-12-31T23:00:00.000Z");
  assert.equal(bounds.end.toISOString(), "2026-12-31T23:00:00.000Z");

  const stockholmNewYear = new Date("2025-12-31T23:30:00.000Z");
  assert.equal(accountingYear(stockholmNewYear), 2026);
  assert.equal(accountingDateKey(stockholmNewYear), "2026-01-01");
});

test("accounting date ranges include the full Stockholm day across DST", () => {
  const bounds = getAccountingDateBounds("2026-03-29");
  assert.ok(bounds);
  assert.equal(bounds.start.toISOString(), "2026-03-28T23:00:00.000Z");
  assert.equal(bounds.end.toISOString(), "2026-03-29T22:00:00.000Z");
  assert.equal(bounds.end.getTime() - bounds.start.getTime(), 23 * 60 * 60 * 1000);
  assert.equal(getAccountingDateBounds("2026-03-30", "2026-03-29"), null);
});

test("discount expiry keeps the selected Stockholm wall time", () => {
  const winter = parseStockholmDateTime("2026-01-15 23:59");
  const summer = parseStockholmDateTime("2026-08-15 23:59");

  assert.equal(winter?.toISOString(), "2026-01-15T22:59:00.000Z");
  assert.equal(summer?.toISOString(), "2026-08-15T21:59:00.000Z");
  assert.equal(formatStockholmDateTime(summer!), "2026-08-15 23:59");
  assert.equal(parseStockholmDateTime("2026-02-30 23:59"), null);
});
