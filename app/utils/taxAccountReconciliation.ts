import { normalizeJournalEntries } from "./verificationValidation";

export type TaxAccountBankChoice = "business" | "private";

export const taxAccountBankChoices = [
  {
    id: "business" as const,
    name: "Företagskontot",
    detail: "SEB · 5722 32 953 76",
    masked: "•••• 5376",
  },
  {
    id: "private" as const,
    name: "Privatkontot",
    detail: "SEB · 5130 00 238 99",
    masked: "•••• 3899",
  },
];

export type TaxAccountJournalEntry = {
  account: number;
  debit: number;
  credit: number;
};

export type TaxAccountSourceRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  balanceAfter: number | null;
  sourceReference: string;
};

export type TaxAccountRowKind =
  | "interest"
  | "preliminaryTax"
  | "vat"
  | "deposit"
  | "payout"
  | "other";

export type TaxAccountPosting = {
  description: string;
  journalEntries: TaxAccountJournalEntry[];
};

export type ReconciliationVerification = {
  verificationNumber: number;
  verificationDate: string | Date;
  description: string;
  recordType?: string;
  metadata?: Array<{ key: string; value: string }>;
  journalEntries: TaxAccountJournalEntry[];
};

export type TaxAccountOpeningState = {
  sourceVerificationNumber: number | null;
  bookBalance: number;
  legacy2050Balance: number;
  difference: number;
};

export type ReconciledTaxAccountRow = TaxAccountSourceRow & {
  kind: TaxAccountRowKind;
  kindLabel: string;
  needsBankChoice: boolean;
  bankChoice: TaxAccountBankChoice | null;
  posting: TaxAccountPosting | null;
  status: "booked" | "missing" | "review";
  match: null | {
    verificationNumber: number;
    description: string;
    journalEntries: TaxAccountJournalEntry[];
  };
};

const roundCurrency = (value: number) => Math.round(Number(value) * 100) / 100;
const amountInCents = (value: number) => Math.round(roundCurrency(value) * 100);
const absoluteAmount = (row: Pick<TaxAccountSourceRow, "amount">) =>
  Math.abs(roundCurrency(row.amount));

const normalizedText = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase("sv-SE")
    .replace(/\s+/g, " ");

export const classifyTaxAccountRow = (
  row: Pick<TaxAccountSourceRow, "description" | "amount">
): TaxAccountRowKind => {
  const description = normalizedText(row.description);
  if (description.includes("intäktsränta")) return "interest";
  if (description.includes("debiterad preliminärskatt")) return "preliminaryTax";
  if (description.startsWith("moms ") || description.includes(" moms ")) return "vat";
  if (
    row.amount > 0 &&
    (description.includes("inbetalning") || description.includes("insättning"))
  ) {
    return "deposit";
  }
  if (
    row.amount < 0 &&
    (description.includes("utbetalning") || description.includes("överföring"))
  ) {
    return "payout";
  }
  return "other";
};

export const taxAccountKindLabel = (kind: TaxAccountRowKind) => {
  switch (kind) {
    case "interest":
      return "Ränta";
    case "preliminaryTax":
      return "Preliminärskatt";
    case "vat":
      return "Moms";
    case "deposit":
      return "Inbetalning";
    case "payout":
      return "Utbetalning";
    default:
      return "Övrigt";
  }
};

export const buildTaxAccountPosting = (
  row: Pick<TaxAccountSourceRow, "description" | "amount">,
  bankChoice: TaxAccountBankChoice | null = null
): TaxAccountPosting | null => {
  const amount = absoluteAmount(row);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const kind = classifyTaxAccountRow(row);

  switch (kind) {
    case "interest":
      return {
        description: "Intäktsränta på skattekontot",
        journalEntries: normalizeJournalEntries([
          { account: 2012, debit: amount },
          { account: 8314, credit: amount },
        ]),
      };
    case "preliminaryTax":
      return {
        description: "Debiterad preliminärskatt",
        journalEntries: normalizeJournalEntries([
          { account: 2013, debit: amount },
          { account: 2012, credit: amount },
        ]),
      };
    case "vat":
      return {
        description: row.description.trim(),
        journalEntries: normalizeJournalEntries(
          row.amount > 0
            ? [
                { account: 2012, debit: amount },
                { account: 2650, credit: amount },
              ]
            : [
                { account: 2650, debit: amount },
                { account: 2012, credit: amount },
              ]
        ),
      };
    case "deposit":
      if (!bankChoice) return null;
      return {
        description: `Inbetalning till skattekontot från ${
          bankChoice === "business" ? "företagskontot" : "privatkontot"
        }`,
        journalEntries: normalizeJournalEntries([
          { account: 2012, debit: amount },
          { account: bankChoice === "business" ? 1930 : 2018, credit: amount },
        ]),
      };
    case "payout":
      if (!bankChoice) return null;
      return {
        description: `Utbetalning från skattekontot till ${
          bankChoice === "business" ? "företagskontot" : "privatkontot"
        }`,
        journalEntries: normalizeJournalEntries([
          {
            account: bankChoice === "business" ? 1930 : 2013,
            debit: amount,
          },
          { account: 2012, credit: amount },
        ]),
      };
    default:
      return null;
  }
};

export const assignTaxAccountRowIds = (
  rows: Array<Omit<TaxAccountSourceRow, "id">>
): TaxAccountSourceRow[] => {
  const occurrences = new Map<string, number>();
  return rows.map((row) => {
    const base = `${row.date}|${normalizedText(row.description)}|${amountInCents(
      row.amount
    )}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return {
      ...row,
      id: `${row.date}:${amountInCents(row.amount)}:${occurrence}`,
    };
  });
};

const dateKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const metadataValue = (
  verification: ReconciliationVerification,
  key: string
) => verification.metadata?.find((entry) => entry.key === key)?.value;

export const applyLinkedLegacyCorrections = (
  verifications: ReconciliationVerification[]
) => {
  const sourceNumbers = new Set(
    verifications.map((verification) => verification.verificationNumber)
  );
  const correctionsBySource = new Map<number, ReconciliationVerification[]>();
  const linkedCorrectionNumbers = new Set<number>();

  for (const verification of verifications) {
    if (metadataValue(verification, "legacy2050Correction") !== "true") continue;
    const sourceNumber = Number(
      metadataValue(verification, "correctionForVerification")
    );
    if (!Number.isInteger(sourceNumber) || !sourceNumbers.has(sourceNumber)) continue;
    correctionsBySource.set(sourceNumber, [
      ...(correctionsBySource.get(sourceNumber) ?? []),
      verification,
    ]);
    linkedCorrectionNumbers.add(verification.verificationNumber);
  }

  return verifications.flatMap((verification) => {
    if (linkedCorrectionNumbers.has(verification.verificationNumber)) return [];
    const corrections = correctionsBySource.get(verification.verificationNumber);
    if (!corrections?.length) return [verification];

    const balances = new Map<number, number>();
    for (const entry of [
      ...verification.journalEntries,
      ...corrections.flatMap((correction) => correction.journalEntries),
    ]) {
      const account = Number(entry.account);
      balances.set(
        account,
        roundCurrency(
          (balances.get(account) ?? 0) +
            Number(entry.debit || 0) -
            Number(entry.credit || 0)
        )
      );
    }
    const journalEntries = Array.from(balances.entries())
      .filter(([, balance]) => balance !== 0)
      .map(([account, balance]) => ({
        account,
        debit: balance > 0 ? balance : 0,
        credit: balance < 0 ? Math.abs(balance) : 0,
      }));

    return journalEntries.length ? [{ ...verification, journalEntries }] : [];
  });
};

export const isIncomingBalanceVerification = (
  verification: ReconciliationVerification,
  fiscalYear: number
) =>
  verification.recordType === "incomingBalance" ||
  metadataValue(verification, "IB") === String(fiscalYear);

export const calculateTaxAccountOpeningState = ({
  verifications,
  fiscalYear,
  periodStart,
  expectedOpeningBalance,
}: {
  verifications: ReconciliationVerification[];
  fiscalYear: number;
  periodStart: string;
  expectedOpeningBalance: number;
}): TaxAccountOpeningState => {
  const openingVerifications = verifications.filter((verification) => {
    const verificationDate = dateKey(verification.verificationDate);
    return isIncomingBalanceVerification(verification, fiscalYear)
      ? verificationDate <= periodStart
      : verificationDate < periodStart;
  });
  const sourceVerification = openingVerifications
    .filter((verification) =>
      isIncomingBalanceVerification(verification, fiscalYear)
    )
    .sort((a, b) => b.verificationNumber - a.verificationNumber)[0];
  const booked = calculateTaxAccountBalance(openingVerifications);

  return {
    sourceVerificationNumber: sourceVerification?.verificationNumber ?? null,
    bookBalance: booked.account2012,
    legacy2050Balance: booked.legacy2050,
    difference: roundCurrency(booked.account2012 - expectedOpeningBalance),
  };
};

const normalizedEntries = (entries: TaxAccountJournalEntry[]) =>
  entries
    .map((entry) => ({
      account: Number(entry.account),
      debit: amountInCents(entry.debit || 0),
      credit: amountInCents(entry.credit || 0),
    }))
    .sort((a, b) => a.account - b.account);

const entriesEqual = (
  left: TaxAccountJournalEntry[],
  right: TaxAccountJournalEntry[]
) => JSON.stringify(normalizedEntries(left)) === JSON.stringify(normalizedEntries(right));

const possiblePostings = (row: TaxAccountSourceRow) => {
  const kind = classifyTaxAccountRow(row);
  if (kind === "deposit" || kind === "payout") {
    return (["business", "private"] as const)
      .map((choice) => ({ choice, posting: buildTaxAccountPosting(row, choice) }))
      .filter(
        (candidate): candidate is { choice: TaxAccountBankChoice; posting: TaxAccountPosting } =>
          Boolean(candidate.posting)
      );
  }
  const posting = buildTaxAccountPosting(row);
  return posting ? [{ choice: null, posting }] : [];
};

const verificationContainsAmount = (
  verification: ReconciliationVerification,
  amount: number
) => {
  const expected = amountInCents(Math.abs(amount));
  return verification.journalEntries.some(
    (entry) =>
      amountInCents(entry.debit || 0) === expected ||
      amountInCents(entry.credit || 0) === expected
  );
};

const containsTaxAccount = (verification: ReconciliationVerification) =>
  verification.journalEntries.some((entry) =>
    [2012, 2050].includes(Number(entry.account))
  );

const matchScore = (
  row: TaxAccountSourceRow,
  verification: ReconciliationVerification
) => {
  if (dateKey(verification.verificationDate) !== row.date) return -1;
  if (!verificationContainsAmount(verification, row.amount)) return -1;
  let score = 10;
  if (containsTaxAccount(verification)) score += 4;
  const rowText = normalizedText(row.description);
  const verificationText = normalizedText(verification.description);
  const kind = classifyTaxAccountRow(row);
  if (
    (kind === "interest" && verificationText.includes("ränta")) ||
    (kind === "preliminaryTax" && verificationText.includes("preliminär")) ||
    (kind === "vat" && verificationText.includes("moms")) ||
    (kind === "deposit" && verificationText.includes("inbetalning")) ||
    (kind === "payout" && verificationText.includes("utbetalning"))
  ) {
    score += 3;
  }
  if (verificationText.includes(rowText) || rowText.includes(verificationText)) {
    score += 1;
  }
  return score;
};

export const reconcileTaxAccountRows = (
  rows: TaxAccountSourceRow[],
  verifications: ReconciliationVerification[]
): ReconciledTaxAccountRow[] => {
  const usedVerificationNumbers = new Set<number>();

  return rows.map((row) => {
    const kind = classifyTaxAccountRow(row);
    const postings = possiblePostings(row);
    const exact = verifications
      .filter(
        (verification) =>
          !usedVerificationNumbers.has(verification.verificationNumber) &&
          dateKey(verification.verificationDate) === row.date
      )
      .map((verification) => ({
        verification,
        posting: postings.find((candidate) =>
          entriesEqual(candidate.posting.journalEntries, verification.journalEntries)
        ),
      }))
      .find((candidate) => candidate.posting);

    if (exact?.posting) {
      usedVerificationNumbers.add(exact.verification.verificationNumber);
      return {
        ...row,
        kind,
        kindLabel: taxAccountKindLabel(kind),
        needsBankChoice: kind === "deposit" || kind === "payout",
        bankChoice: exact.posting.choice,
        posting: exact.posting.posting,
        status: "booked" as const,
        match: {
          verificationNumber: exact.verification.verificationNumber,
          description: exact.verification.description,
          journalEntries: exact.verification.journalEntries,
        },
      };
    }

    const possibleMatch = verifications
      .filter(
        (verification) =>
          !usedVerificationNumbers.has(verification.verificationNumber)
      )
      .map((verification) => ({
        verification,
        score: matchScore(row, verification),
      }))
      .filter((candidate) => candidate.score >= 10)
      .sort((a, b) => b.score - a.score)[0];

    if (possibleMatch) {
      usedVerificationNumbers.add(possibleMatch.verification.verificationNumber);
    }

    const defaultBankChoice: TaxAccountBankChoice | null =
      kind === "deposit" || kind === "payout" ? "private" : null;

    return {
      ...row,
      kind,
      kindLabel: taxAccountKindLabel(kind),
      needsBankChoice: kind === "deposit" || kind === "payout",
      bankChoice: defaultBankChoice,
      posting: buildTaxAccountPosting(row, defaultBankChoice),
      status: possibleMatch ? ("review" as const) : ("missing" as const),
      match: possibleMatch
        ? {
            verificationNumber: possibleMatch.verification.verificationNumber,
            description: possibleMatch.verification.description,
            journalEntries: possibleMatch.verification.journalEntries,
          }
        : null,
    };
  });
};

export const calculateTaxAccountBalance = (
  verifications: ReconciliationVerification[]
) => {
  let account2012 = 0;
  let legacy2050 = 0;
  for (const verification of verifications) {
    for (const entry of verification.journalEntries) {
      const change = roundCurrency(Number(entry.debit || 0) - Number(entry.credit || 0));
      if (entry.account === 2012) account2012 = roundCurrency(account2012 + change);
      if (entry.account === 2050) legacy2050 = roundCurrency(legacy2050 + change);
    }
  }
  return {
    account2012,
    legacy2050,
    // 2050 var ett motkonto i äldre verifikationer, inte en del av
    // Skatteverkets kontosaldo. Avstämningen ska därför följa 2012.
    total: account2012,
  };
};
