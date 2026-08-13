import assert from "node:assert/strict";
import test from "node:test";
import type { AccountingDocumentAnalysis } from "../app/services/accounting-document.server";
import {
  toAccountingDocumentLabel,
  toVerificationSuggestion,
  validateAccountingAnalysis,
} from "../app/services/accounting-document.server";

const validAnalysis: AccountingDocumentAnalysis = {
  documentType: "supplier_invoice",
  warnings: [],
  entries: [
    {
      date: "2026-07-15",
      description: "Keramikmaterial, faktura 2026-100",
      total: 1250,
      sourceReference: "2026-100",
      sourceAccount: "business_bank",
      confidence: 0.99,
      warnings: [],
      accounts: [
        { account: "4000", debit: 1000, credit: 0 },
        { account: "2640", debit: 250, credit: 0 },
        { account: "1930", debit: 0, credit: 1250 },
      ],
    },
  ],
};

test("accepts a balanced accounting analysis", () => {
  assert.equal(validateAccountingAnalysis(validAnalysis), validAnalysis);
});

test("repairs a small invoice rounding discrepancy and keeps it reviewable", () => {
  const analysis: AccountingDocumentAnalysis = {
    documentType: "supplier_invoice",
    warnings: [],
    entries: [
      {
        date: "2024-10-30",
        description: "Löpande kostnader och material, faktura 108",
        total: 10998,
        sourceReference: "108",
        sourceAccount: "unknown",
        confidence: 0.95,
        warnings: [],
        accounts: [
          { account: "6990", debit: 8798.4, credit: 0 },
          { account: "2640", debit: 2199.66, credit: 0 },
          { account: "2440", debit: 0, credit: 10998 },
        ],
      },
    ],
  };

  assert.equal(validateAccountingAnalysis(analysis), analysis);
  assert.deepEqual(analysis.entries[0].accounts.at(-1), {
    account: "3740",
    debit: 0,
    credit: 0.06,
  });
  assert.match(analysis.entries[0].warnings[0], /avviker med 0,06 kr/);
  assert.equal(analysis.entries[0].confidence, 0.8);
});

test("still rejects material invoice imbalances", () => {
  const invalid = structuredClone(validAnalysis);
  invalid.entries[0].accounts[2].credit = 1240;

  assert.throws(() => validateAccountingAnalysis(invalid), /not balanced/);
});

test("rejects an unbalanced accounting analysis", () => {
  const invalid = structuredClone(validAnalysis);
  invalid.entries[0].accounts[2].credit = 1248;

  assert.throws(
    () => validateAccountingAnalysis(invalid),
    /not balanced/
  );
});

test("rejects an account that is not configured in the app", () => {
  const invalid = structuredClone(validAnalysis);
  invalid.entries[0].accounts[0].account = "6540";

  assert.throws(
    () => validateAccountingAnalysis(invalid),
    /account 6540, which is not configured in the app/
  );
});

test("requires Moa sales invoices to use account 3001", () => {
  const invalid = structuredClone(validAnalysis);
  invalid.documentType = "sales_invoice";
  invalid.entries[0].accounts = [
    { account: "1510", debit: 1250, credit: 0 },
    { account: "2611", debit: 0, credit: 250 },
    { account: "6990", debit: 0, credit: 1000 },
  ];

  assert.throws(
    () => validateAccountingAnalysis(invalid),
    /does not use the configured sales account 3001/
  );
});

test("converts an entry to the current verification form shape", () => {
  const suggestion = toVerificationSuggestion(validAnalysis.entries[0]);

  assert.deepEqual(suggestion.accounts, {
    "1930": { debit: 0, credit: 1250 },
    "2640": { debit: 250, credit: 0 },
    "4000": { debit: 1000, credit: 0 },
  });
  assert.equal(suggestion.date, "2026-07-15");
  assert.equal(
    toAccountingDocumentLabel(validAnalysis, "1776595745796-document.pdf"),
    "Keramikmaterial, faktura 2026-100"
  );
});

test("accepts separate, correctly posted tax-account transactions", () => {
  const taxAccountAnalysis: AccountingDocumentAnalysis = {
    documentType: "tax_account_statement",
    warnings: [],
    entries: [
      {
        date: "2026-04-13",
        description: "Moms febr 2026",
        total: -239,
        sourceReference: "Moms febr 2026",
        sourceAccount: "tax_account",
        confidence: 1,
        warnings: [],
        accounts: [
          { account: "2650", debit: 239, credit: 0 },
          { account: "2012", debit: 0, credit: 239 },
        ],
      },
      {
        date: "2026-04-20",
        description: "Inbetalning bokförd 260419",
        total: 399,
        sourceReference: "260419",
        sourceAccount: "unknown",
        confidence: 0.7,
        warnings: ["Kontrollera om inbetalningen kom från privat- eller företagskonto."],
        accounts: [
          { account: "2012", debit: 399, credit: 0 },
          { account: "2018", debit: 0, credit: 399 },
        ],
      },
    ],
  };

  assert.equal(validateAccountingAnalysis(taxAccountAnalysis), taxAccountAnalysis);
});

test("rejects a VAT charge combined with a tax-account deposit", () => {
  const invalid: AccountingDocumentAnalysis = {
    documentType: "tax_account_statement",
    warnings: [],
    entries: [
      {
        date: "2026-04-13",
        description: "Moms febr 2026",
        total: -239,
        sourceReference: "Moms febr 2026",
        sourceAccount: "tax_account",
        confidence: 1,
        warnings: [],
        accounts: [
          { account: "2650", debit: 239, credit: 0 },
          { account: "2012", debit: 0, credit: 478 },
          { account: "2018", debit: 239, credit: 0 },
        ],
      },
    ],
  };

  assert.throws(
    () => validateAccountingAnalysis(invalid),
    /invalid VAT tax-account posting|combines a VAT charge/
  );
});

test("accepts a business-bank statement entry on account 1930", () => {
  const analysis: AccountingDocumentAnalysis = {
    documentType: "bank_statement",
    warnings: [],
    entries: [
      {
        date: "2025-08-07",
        description: "Stripe-utbetalning",
        total: 1270.59,
        sourceReference: "5490990543",
        sourceAccount: "business_bank",
        confidence: 1,
        warnings: [],
        accounts: [
          { account: "1930", debit: 1270.59, credit: 0 },
          { account: "1580", debit: 0, credit: 1270.59 },
        ],
      },
    ],
  };

  assert.equal(validateAccountingAnalysis(analysis), analysis);
});

test("accepts a tax payment from the private bank account", () => {
  const analysis: AccountingDocumentAnalysis = {
    documentType: "bank_statement",
    warnings: [],
    entries: [
      {
        date: "2026-08-10",
        description: "Inbetalning till skattekontot",
        total: -366,
        sourceReference: "7633981",
        sourceAccount: "private_bank",
        confidence: 1,
        warnings: [],
        accounts: [
          { account: "2012", debit: 366, credit: 0 },
          { account: "2018", debit: 0, credit: 366 },
        ],
      },
    ],
  };

  assert.equal(validateAccountingAnalysis(analysis), analysis);
});

test("rejects a bank statement whose selected account and posting disagree", () => {
  const analysis: AccountingDocumentAnalysis = {
    documentType: "bank_statement",
    warnings: [],
    entries: [
      {
        date: "2025-03-24",
        description: "Eget uttag",
        total: -4568,
        sourceReference: "PCB21P00250324125305410803000001",
        sourceAccount: "private_bank",
        confidence: 1,
        warnings: [],
        accounts: [
          { account: "2013", debit: 4568, credit: 0 },
          { account: "1930", debit: 0, credit: 4568 },
        ],
      },
    ],
  };

  assert.throws(
    () => validateAccountingAnalysis(analysis),
    /identifies private_bank but does not use account 2018/
  );
});
