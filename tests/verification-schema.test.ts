import assert from "node:assert/strict";
import test from "node:test";
import { Verifications } from "../app/schemas/verifications";

const baseVerification = {
  domain: "moaclayco",
  description: "Momsdeklaration för April 2026",
  verificationNumber: 1,
  verificationDate: new Date("2026-04-30T12:00:00.000Z"),
  metadata: [{ key: "vatReport", value: "2026-04" }],
};

test("allows a non-posting zero VAT report", async () => {
  const report = new Verifications({
    ...baseVerification,
    recordType: "vatReport",
    journalEntries: [],
  });

  await report.validate();
  assert.deepEqual(report.journalEntries, []);
});

test("collapses legacy zero rows on a VAT report", async () => {
  const report = new Verifications({
    ...baseVerification,
    recordType: "vatReport",
    journalEntries: [
      { account: 2640, debit: 0, credit: 0 },
      { account: 2611, debit: 0, credit: 0 },
    ],
  });

  await report.validate();
  assert.deepEqual(report.journalEntries, []);
});

test("allows a zero incoming balance without deleting its audit record", async () => {
  const incomingBalance = new Verifications({
    ...baseVerification,
    description: "Ingående balans",
    metadata: [{ key: "IB", value: "2026" }],
    recordType: "incomingBalance",
    journalEntries: [],
  });

  await incomingBalance.validate();
  assert.deepEqual(incomingBalance.journalEntries, []);
});

test("still rejects an empty ordinary journal verification", async () => {
  const verification = new Verifications({
    ...baseVerification,
    recordType: "journal",
    journalEntries: [],
  });

  await assert.rejects(() => verification.validate(), /minst två konteringsrader/);
});

test("allows 2050 in an explicitly marked legacy correction", async () => {
  const correction = new Verifications({
    ...baseVerification,
    description: "Rättelse av äldre skattekontokontering",
    recordType: "journal",
    metadata: [{ key: "legacy2050Correction", value: "true" }],
    journalEntries: [
      { account: 2050, debit: 1 },
      { account: 8314, credit: 1 },
    ],
  });

  await correction.validate();
  assert.deepEqual(
    correction.journalEntries.map((entry: any) => ({
      account: entry.account,
      debit: entry.debit,
      credit: entry.credit,
    })),
    [
      { account: 2050, debit: 1, credit: 0 },
      { account: 8314, debit: 0, credit: 1 },
    ]
  );
});
