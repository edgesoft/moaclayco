import { normalizeJournalEntries } from "./verificationValidation";

type TaxAccountTransaction =
  | { type: "interest"; amount: number }
  | { type: "preliminaryTax"; amount: number }
  | { type: "vatCharge"; amount: number }
  | { type: "vatRefund"; amount: number }
  | { type: "deposit"; amount: number; sourceAccount: 1930 | 2018 };

const positiveAmount = (value: number) => {
  const amount = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Skattekontobeloppet måste vara större än noll");
  }
  return amount;
};

export const buildTaxAccountJournalEntries = (
  transaction: TaxAccountTransaction
) => {
  const amount = positiveAmount(transaction.amount);

  switch (transaction.type) {
    case "interest":
      return normalizeJournalEntries([
        { account: 2012, debit: amount },
        { account: 8314, credit: amount },
      ]);
    case "preliminaryTax":
      return normalizeJournalEntries([
        { account: 2013, debit: amount },
        { account: 2012, credit: amount },
      ]);
    case "vatCharge":
      return normalizeJournalEntries([
        { account: 2650, debit: amount },
        { account: 2012, credit: amount },
      ]);
    case "vatRefund":
      return normalizeJournalEntries([
        { account: 2012, debit: amount },
        { account: 2650, credit: amount },
      ]);
    case "deposit":
      return normalizeJournalEntries([
        { account: 2012, debit: amount },
        { account: transaction.sourceAccount, credit: amount },
      ]);
  }
};
