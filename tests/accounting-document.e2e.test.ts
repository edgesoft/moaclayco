import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  interpretAccountingDocument,
  toVerificationSuggestion,
} from "../app/services/accounting-document.server";

type ExpectedEntry = {
  date: string;
  total: number;
  accounts: Record<string, { debit: number; credit: number }>;
};

type ExpectedAnalysis = {
  documentType: string;
  entries: ExpectedEntry[];
};

const fixturePath = process.env.ACCOUNTING_E2E_FIXTURE;
const expectedPath = process.env.ACCOUNTING_E2E_EXPECTED;

test(
  "interprets an accounting PDF into the expected balanced entries",
  { skip: !fixturePath || !expectedPath },
  async () => {
    const fixture = await readFile(fixturePath as string);
    const expected = JSON.parse(
      await readFile(expectedPath as string, "utf8")
    ) as ExpectedAnalysis;

    const analysis = await interpretAccountingDocument({
      buffer: fixture,
      mimeType: "application/pdf",
      fileName: path.basename(fixturePath as string),
    });

    assert.equal(analysis.documentType, expected.documentType);
    assert.equal(analysis.entries.length, expected.entries.length);

    const suggestions = analysis.entries.map(toVerificationSuggestion);
    expected.entries.forEach((expectedEntry) => {
      const actualIndex = analysis.entries.findIndex(
        (entry) =>
          entry.date === expectedEntry.date &&
          Math.abs(entry.total - expectedEntry.total) < 0.01
      );

      assert.notEqual(
        actualIndex,
        -1,
        `Missing transaction ${expectedEntry.date} ${expectedEntry.total}`
      );
      assert.deepEqual(suggestions[actualIndex].accounts, expectedEntry.accounts);
    });
  }
);
