import assert from "node:assert/strict";
import test from "node:test";
import { Verifications } from "../app/schemas/verifications";
import { AccountingYears } from "../app/schemas/accounting-years";

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

test("keeps the previous values in a verification edit history", async () => {
  const previousDate = new Date("2026-03-10T12:00:00.000Z");
  const verification = new Verifications({
    ...baseVerification,
    recordType: "journal",
    metadata: [],
    journalEntries: [
      { account: 1930, debit: 500, credit: 0 },
      { account: 3001, debit: 0, credit: 500 },
    ],
    editHistory: [
      {
        editedAt: new Date("2026-04-20T09:00:00.000Z"),
        editedBy: "admin@moaclayco.se",
        reason: "Rättat felaktigt belopp",
        previousDescription: "Försäljning",
        previousVerificationDate: previousDate,
        previousJournalEntries: [
          { account: 1930, debit: 450, credit: 0 },
          { account: 3001, debit: 0, credit: 450 },
        ],
      },
    ],
  });

  await verification.validate();
  assert.equal(verification.editHistory.length, 1);
  assert.equal(verification.editHistory[0].reason, "Rättat felaktigt belopp");
  assert.equal(
    verification.editHistory[0].previousVerificationDate.toISOString(),
    previousDate.toISOString()
  );
  assert.deepEqual(
    verification.editHistory[0].previousJournalEntries.map((entry: any) => ({
      account: entry.account,
      debit: entry.debit,
      credit: entry.credit,
    })),
    [
      { account: 1930, debit: 450, credit: 0 },
      { account: 3001, debit: 0, credit: 450 },
    ]
  );
});

test("keeps an audit record when a verification file is removed", async () => {
  const changedAt = new Date("2026-04-21T10:30:00.000Z");
  const verification = new Verifications({
    ...baseVerification,
    recordType: "journal",
    metadata: [],
    journalEntries: [
      { account: 1930, debit: 500, credit: 0 },
      { account: 3001, debit: 0, credit: 500 },
    ],
    fileHistory: [
      {
        action: "removed",
        changedAt,
        changedBy: "admin@moaclayco.se",
        name: "Leverantörsfaktura april",
        path: "https://files.example/verifications/faktura.pdf",
      },
    ],
  });

  await verification.validate();
  assert.equal(verification.fileHistory.length, 1);
  assert.equal(verification.fileHistory[0].action, "removed");
  assert.equal(
    verification.fileHistory[0].changedAt.toISOString(),
    changedAt.toISOString()
  );
  assert.equal(
    verification.fileHistory[0].name,
    "Leverantörsfaktura april"
  );
});

test("accounting years only accept controlled open and closed states", async () => {
  const openYear = new AccountingYears({
    domain: "moaclayco",
    year: 2025,
    status: "open",
  });
  await openYear.validate();

  const invalidYear = new AccountingYears({
    domain: "moaclayco",
    year: 2025,
    status: "archived",
  });
  await assert.rejects(() => invalidYear.validate(), /not a valid enum value/);
});
