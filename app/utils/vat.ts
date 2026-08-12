import { normalizeJournalEntries, type NormalizedJournalEntry } from "./verificationValidation";
import { buildTaxAccountJournalEntries } from "./taxAccount";

const toCents = (amount: number) => Math.round(amount * 100);

const closingEntry = (account: number, balanceInCents: number): NormalizedJournalEntry => ({
  account,
  debit: balanceInCents < 0 ? Math.abs(balanceInCents) / 100 : 0,
  credit: balanceInCents > 0 ? balanceInCents / 100 : 0,
});

export const buildVatReportEntries = (
  incomingVatBalance: number,
  outgoingVatBalance: number
) => {
  const entries: NormalizedJournalEntry[] = [];
  const incomingCents = toCents(incomingVatBalance);
  const outgoingCents = toCents(outgoingVatBalance);
  if (incomingCents !== 0) entries.push(closingEntry(2640, incomingCents));
  if (outgoingCents !== 0) entries.push(closingEntry(2611, outgoingCents));
  if (entries.length === 0) return [];

  let debitCents = entries.reduce((sum, entry) => sum + toCents(entry.debit), 0);
  let creditCents = entries.reduce((sum, entry) => sum + toCents(entry.credit), 0);
  const vatImbalanceCents = debitCents - creditCents;
  const roundedVatCents = Math.round(Math.abs(vatImbalanceCents) / 100) * 100;

  if (roundedVatCents > 0) {
    entries.push({
      account: 2650,
      debit: vatImbalanceCents < 0 ? roundedVatCents / 100 : 0,
      credit: vatImbalanceCents > 0 ? roundedVatCents / 100 : 0,
    });
  }

  debitCents = entries.reduce((sum, entry) => sum + toCents(entry.debit), 0);
  creditCents = entries.reduce((sum, entry) => sum + toCents(entry.credit), 0);
  const roundingImbalanceCents = debitCents - creditCents;
  if (roundingImbalanceCents !== 0) {
    entries.push({
      account: 3740,
      debit: roundingImbalanceCents < 0 ? Math.abs(roundingImbalanceCents) / 100 : 0,
      credit: roundingImbalanceCents > 0 ? roundingImbalanceCents / 100 : 0,
    });
  }

  return normalizeJournalEntries(entries);
};

export const buildVatTaxAccountEntries = (vatBalance: number) => {
  const balanceInCents = toCents(vatBalance);
  if (balanceInCents === 0) return [];
  const amount = Math.abs(balanceInCents) / 100;

  return buildTaxAccountJournalEntries({
    type: balanceInCents > 0 ? "vatRefund" : "vatCharge",
    amount,
  });
};
