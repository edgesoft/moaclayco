import assert from "node:assert/strict";
import test from "node:test";
import {
  fallbackVerificationFileLabel,
  hasMeaningfulVerificationInput,
  sanitizeVerificationFileLabel,
} from "../app/utils/verificationFiles";

test("turns a technical upload name into a readable fallback label", () => {
  assert.equal(
    fallbackVerificationFileLabel(
      "1776595745796-Bokförda transaktioner _ Skatteverket.pdf"
    ),
    "Bokförda transaktioner – Skatteverket"
  );
});

test("normalizes and limits labels before they are stored", () => {
  assert.equal(
    sanitizeVerificationFileLabel("  Momsrapport   mars 2026  "),
    "Momsrapport mars 2026"
  );
  assert.equal(sanitizeVerificationFileLabel("x".repeat(200)).length, 120);
});

test("recognizes user-entered text without treating an empty starter row as input", () => {
  assert.equal(
    hasMeaningfulVerificationInput({
      description: "",
      journalEntries: [{ account: 0, debit: 0, credit: 0 }],
    }),
    false
  );
  assert.equal(
    hasMeaningfulVerificationInput({
      description: "Egen beskrivning",
      journalEntries: [{ account: 0, debit: 0, credit: 0 }],
    }),
    true
  );
  assert.equal(
    hasMeaningfulVerificationInput({
      description: "",
      journalEntries: [{ account: 1930, debit: 100, credit: 0 }],
    }),
    true
  );
  assert.equal(
    hasMeaningfulVerificationInput({
      description: "",
      journalEntries: [{ account: 0, debit: 0, credit: 0 }],
      verificationDate: "2026-08-11",
      initialVerificationDate: "2026-08-12",
    }),
    true
  );
});
