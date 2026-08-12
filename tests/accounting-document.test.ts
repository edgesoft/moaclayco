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

test("rejects an unbalanced accounting analysis", () => {
  const invalid = structuredClone(validAnalysis);
  invalid.entries[0].accounts[2].credit = 1249;

  assert.throws(
    () => validateAccountingAnalysis(invalid),
    /not balanced/
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
