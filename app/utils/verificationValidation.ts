export type NormalizedJournalEntry = {
  account: number;
  debit: number;
  credit: number;
};

export class VerificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationValidationError";
  }
}

const normalizeAmount = (value: unknown, label: string) => {
  const amount = value === undefined || value === null || value === "" ? 0 : Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new VerificationValidationError(`${label} måste vara ett positivt tal`);
  }

  const amountInCents = amount * 100;
  if (Math.abs(amountInCents - Math.round(amountInCents)) > 0.000_001) {
    throw new VerificationValidationError(`${label} får ha högst två decimaler`);
  }
  if (!Number.isSafeInteger(Math.round(amountInCents))) {
    throw new VerificationValidationError(`${label} är för stort`);
  }

  return Math.round(amountInCents) / 100;
};

export function normalizeJournalEntries(
  entries: unknown
): NormalizedJournalEntry[] {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new VerificationValidationError(
      "En verifikation måste innehålla minst två konteringsrader"
    );
  }
  if (entries.length > 500) {
    throw new VerificationValidationError("Verifikationen innehåller för många rader");
  }

  let debitCents = 0;
  let creditCents = 0;
  const normalized = entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new VerificationValidationError(`Rad ${index + 1} är ogiltig`);
    }
    const source = entry as Record<string, unknown>;
    const account = Number(source.account);
    if (!Number.isInteger(account) || account < 1000 || account > 9999) {
      throw new VerificationValidationError(`Rad ${index + 1} har ett ogiltigt konto`);
    }
    if (account === 2050) {
      throw new VerificationValidationError(
        `Rad ${index + 1} använder det utgångna kontot 2050; använd ett konto för enskild firma`
      );
    }

    const debit = normalizeAmount(source.debit, `Debet på rad ${index + 1}`);
    const credit = normalizeAmount(source.credit, `Kredit på rad ${index + 1}`);
    if ((debit === 0 && credit === 0) || (debit > 0 && credit > 0)) {
      throw new VerificationValidationError(
        `Rad ${index + 1} måste ha belopp på exakt en av debet eller kredit`
      );
    }

    debitCents += Math.round(debit * 100);
    creditCents += Math.round(credit * 100);
    return { account, debit, credit };
  });

  if (debitCents !== creditCents) {
    throw new VerificationValidationError(
      `Verifikationen balanserar inte: debet ${(debitCents / 100).toFixed(2)} och kredit ${(creditCents / 100).toFixed(2)}`
    );
  }

  return normalized;
}
