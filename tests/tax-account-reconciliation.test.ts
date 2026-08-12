import assert from "node:assert/strict";
import test from "node:test";
import { validateTaxAccountStatement } from "../app/services/tax-account-document.server";
import {
  assignTaxAccountRowIds,
  applyLinkedLegacyCorrections,
  buildTaxAccountPosting,
  calculateTaxAccountBalance,
  calculateTaxAccountOpeningState,
  reconcileTaxAccountRows,
} from "../app/utils/taxAccountReconciliation";

test("tax-account deposits use the selected real bank account", () => {
  const row = {
    description: "Inbetalning bokförd 260410",
    amount: 399,
  };
  assert.deepEqual(buildTaxAccountPosting(row, "business")?.journalEntries, [
    { account: 2012, debit: 399, credit: 0 },
    { account: 1930, debit: 0, credit: 399 },
  ]);
  assert.deepEqual(buildTaxAccountPosting(row, "private")?.journalEntries, [
    { account: 2012, debit: 399, credit: 0 },
    { account: 2018, debit: 0, credit: 399 },
  ]);
});

test("tax-account payouts distinguish company and private destinations", () => {
  const row = { description: "Utbetalning", amount: -500 };
  assert.deepEqual(buildTaxAccountPosting(row, "business")?.journalEntries, [
    { account: 1930, debit: 500, credit: 0 },
    { account: 2012, debit: 0, credit: 500 },
  ]);
  assert.deepEqual(buildTaxAccountPosting(row, "private")?.journalEntries, [
    { account: 2013, debit: 500, credit: 0 },
    { account: 2012, debit: 0, credit: 500 },
  ]);
});

test("identical source rows keep separate stable occurrence ids", () => {
  const rows = assignTaxAccountRowIds([
    {
      date: "2026-06-27",
      description: "Inbetalning bokförd",
      amount: 366,
      balanceAfter: 370,
      sourceReference: "rad 1",
    },
    {
      date: "2026-06-27",
      description: "Inbetalning bokförd",
      amount: 366,
      balanceAfter: 736,
      sourceReference: "rad 2",
    },
  ]);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.match(rows[0].id, /:1$/);
  assert.match(rows[1].id, /:2$/);
});

test("reconciliation consumes one verification per duplicate row", () => {
  const rows = assignTaxAccountRowIds([
    {
      date: "2026-06-27",
      description: "Inbetalning bokförd",
      amount: 366,
      balanceAfter: 370,
      sourceReference: "rad 1",
    },
    {
      date: "2026-06-27",
      description: "Inbetalning bokförd",
      amount: 366,
      balanceAfter: 736,
      sourceReference: "rad 2",
    },
  ]);
  const reconciled = reconcileTaxAccountRows(rows, [
    {
      verificationNumber: 227,
      verificationDate: "2026-06-27",
      description: "Inbetalning till skattekontot från privatkontot",
      journalEntries: [
        { account: 2012, debit: 366, credit: 0 },
        { account: 2018, debit: 0, credit: 366 },
      ],
    },
  ]);
  assert.equal(reconciled.filter((row) => row.status === "booked").length, 1);
  assert.equal(reconciled.filter((row) => row.status === "missing").length, 1);
  const missing = reconciled.find((row) => row.status === "missing");
  assert.equal(missing?.bankChoice, "private");
  assert.deepEqual(missing?.posting?.journalEntries, [
    { account: 2012, debit: 366, credit: 0 },
    { account: 2018, debit: 0, credit: 366 },
  ]);
});

test("unmatched tax-account payouts default to the private account", () => {
  const [row] = assignTaxAccountRowIds([
    {
      date: "2026-07-01",
      description: "Utbetalning",
      amount: -500,
      balanceAfter: 0,
      sourceReference: "Utbetalning",
    },
  ]);
  const [result] = reconcileTaxAccountRows([row], []);
  assert.equal(result.status, "missing");
  assert.equal(result.bankChoice, "private");
  assert.deepEqual(result.posting?.journalEntries, [
    { account: 2013, debit: 500, credit: 0 },
    { account: 2012, debit: 0, credit: 500 },
  ]);
});

test("same-date legacy 2050 posting is flagged for review instead of accepted", () => {
  const [row] = assignTaxAccountRowIds([
    {
      date: "2026-04-13",
      description: "Moms feb 2026",
      amount: -239,
      balanceAfter: 0,
      sourceReference: "Moms feb 2026",
    },
  ]);
  const [result] = reconcileTaxAccountRows([row], [
    {
      verificationNumber: 224,
      verificationDate: "2026-04-13",
      description: "Moms feb 2026",
      journalEntries: [
        { account: 2650, debit: 239, credit: 0 },
        { account: 2050, debit: 0, credit: 239 },
      ],
    },
  ]);
  assert.equal(result.status, "review");
  assert.equal(result.match?.verificationNumber, 224);
});

test("book balance reports current and legacy tax accounts separately", () => {
  assert.deepEqual(
    calculateTaxAccountBalance([
      {
        verificationNumber: 1,
        verificationDate: "2026-01-01",
        description: "IB",
        journalEntries: [
          { account: 2012, debit: 171, credit: 0 },
          { account: 2999, debit: 0, credit: 171 },
        ],
      },
      {
        verificationNumber: 2,
        verificationDate: "2026-01-02",
        description: "Äldre saldo",
        journalEntries: [
          { account: 2050, debit: 10, credit: 0 },
          { account: 2999, debit: 0, credit: 10 },
        ],
      },
    ]),
    { account2012: 171, legacy2050: 10, total: 171 }
  );
});

test("legacy journal records are recognized as IB through metadata", () => {
  const state = calculateTaxAccountOpeningState({
    fiscalYear: 2026,
    periodStart: "2026-01-01",
    expectedOpeningBalance: 171,
    verifications: [
      {
        verificationNumber: 217,
        verificationDate: "2026-01-01",
        description: "Ingående balans",
        recordType: "journal",
        metadata: [{ key: "IB", value: "2026" }],
        journalEntries: [
          { account: 2012, debit: 171, credit: 0 },
          { account: 2999, debit: 0, credit: 171 },
        ],
      },
    ],
  });

  assert.equal(state.sourceVerificationNumber, 217);
  assert.equal(state.bookBalance, 171);
  assert.equal(state.difference, 0);
});

test("linked legacy corrections expose the effective posting", () => {
  const effective = applyLinkedLegacyCorrections([
    {
      verificationNumber: 223,
      verificationDate: "2026-02-01",
      description: "Intäktsränta",
      journalEntries: [
        { account: 2012, debit: 1, credit: 0 },
        { account: 2050, debit: 0, credit: 1 },
      ],
    },
    {
      verificationNumber: 252,
      verificationDate: "2026-08-12",
      description: "Rättelse av äldre skattekontokontering A223",
      metadata: [
        { key: "legacy2050Correction", value: "true" },
        { key: "correctionForVerification", value: "223" },
      ],
      journalEntries: [
        { account: 2050, debit: 1, credit: 0 },
        { account: 8314, debit: 0, credit: 1 },
      ],
    },
  ]);

  assert.deepEqual(effective, [
    {
      verificationNumber: 223,
      verificationDate: "2026-02-01",
      description: "Intäktsränta",
      journalEntries: [
        { account: 2012, debit: 1, credit: 0 },
        { account: 8314, debit: 0, credit: 1 },
      ],
    },
  ]);
});

test("tax-account statement validation accepts an unbroken balance chain", () => {
  assert.doesNotThrow(() =>
    validateTaxAccountStatement({
      documentType: "tax_account_statement",
      accountHolder: "Moa Clay Co",
      organizationNumber: "",
      accountNumber: "",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      openingBalance: 171,
      closingBalance: 172,
      transactions: [
        {
          date: "2026-01-31",
          description: "Intäktsränta",
          amount: 1,
          balanceAfter: 172,
          sourceReference: "Intäktsränta",
        },
      ],
      warnings: [],
    })
  );
});

test("tax-account statement validation rejects a broken balance chain", () => {
  assert.throws(
    () =>
      validateTaxAccountStatement({
        documentType: "tax_account_statement",
        accountHolder: "Moa Clay Co",
        organizationNumber: "",
        accountNumber: "",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        openingBalance: 171,
        closingBalance: 999,
        transactions: [
          {
            date: "2026-01-31",
            description: "Intäktsränta",
            amount: 1,
            balanceAfter: 172,
            sourceReference: "Intäktsränta",
          },
        ],
        warnings: [],
      }),
    /slutsaldo/
  );
});
