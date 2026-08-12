import mongoose from "mongoose";
import { VerificationCounters } from "~/schemas/verification-counters";
import { Verifications } from "~/schemas/verifications";
import { normalizeJournalEntries } from "~/utils/verificationValidation";
import { getIBJournalEntries } from "~/utils/accounts.server";
import { accountingYear } from "~/utils/accountingDates";

type MetadataEntry = { key: string; value: string | number };
type FileEntry = { name: string; path: string };

export type CreateVerificationInput = {
  domain: string;
  description: string;
  verificationDate: Date;
  journalEntries: unknown;
  recordType?: "journal" | "vatReport" | "incomingBalance";
  idempotencyKey?: string;
  metadata?: MetadataEntry[];
  files?: FileEntry[];
};

const normalizeInput = (input: CreateVerificationInput) => {
  const domain = input.domain?.trim();
  const description = input.description?.trim();
  if (!domain || domain.length > 100) throw new Error("Ogiltig domän för verifikation");
  if (!description || description.length > 1_000) {
    throw new Error("Verifikationen måste ha en giltig beskrivning");
  }
  if (!(input.verificationDate instanceof Date) || Number.isNaN(input.verificationDate.getTime())) {
    throw new Error("Verifikationen måste ha ett giltigt datum");
  }

  const recordType = input.recordType ?? "journal";
  const metadata = (input.metadata ?? []).map(({ key, value }) => ({
    key: String(key).trim(),
    value: String(value).trim(),
  }));
  const allowsEmptyJournal =
    recordType === "vatReport" || recordType === "incomingBalance";
  const isEmptyNonPostingRecord =
    allowsEmptyJournal &&
    Array.isArray(input.journalEntries) &&
    input.journalEntries.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const source = entry as Record<string, unknown>;
      return Number(source.debit || 0) === 0 && Number(source.credit || 0) === 0;
    });
  if (
    recordType === "vatReport" &&
    !metadata.some(
      (entry) => entry.key === "vatReport" && /^\d{4}-\d{2}$/.test(entry.value)
    )
  ) {
    throw new Error("En momsrapport måste ha en giltig redovisningsperiod");
  }
  if (
    recordType === "incomingBalance" &&
    !metadata.some(
      (entry) => entry.key === "IB" && /^\d{4}$/.test(entry.value)
    )
  ) {
    throw new Error("En ingående balans måste ha ett giltigt bokföringsår");
  }

  return {
    domain,
    description,
    verificationDate: input.verificationDate,
    recordType,
    journalEntries: isEmptyNonPostingRecord
      ? []
      : normalizeJournalEntries(input.journalEntries),
    idempotencyKey: input.idempotencyKey?.trim() || undefined,
    metadata,
    files: (input.files ?? []).map(({ name, path }) => ({
      name: String(name).trim(),
      path: String(path).trim(),
    })),
  };
};

export async function createVerification(input: CreateVerificationInput) {
  const normalized = normalizeInput(input);
  const session = await mongoose.startSession();
  let createdVerification: any = null;

  try {
    await session.withTransaction(async () => {
      if (normalized.idempotencyKey) {
        const existing = await Verifications.findOne({
          domain: normalized.domain,
          idempotencyKey: normalized.idempotencyKey,
        }).session(session);
        if (existing) {
          createdVerification = existing;
          return;
        }
      }

      const latest = await Verifications.findOne({ domain: normalized.domain })
        .sort({ verificationNumber: -1 })
        .select("verificationNumber")
        .session(session)
        .lean();
      const latestNumber = Number((latest as any)?.verificationNumber ?? 0);

      await VerificationCounters.updateOne(
        { domain: normalized.domain },
        {
          $max: { sequence: latestNumber },
          $setOnInsert: { domain: normalized.domain },
        },
        { upsert: true, session }
      );
      const counter = await VerificationCounters.findOneAndUpdate(
        { domain: normalized.domain },
        { $inc: { sequence: 1 } },
        { new: true, session }
      );
      if (!counter) throw new Error("Kunde inte tilldela verifikationsnummer");

      const documents = await Verifications.create(
        [
          {
            ...normalized,
            verificationNumber: counter.sequence,
          },
        ],
        { session }
      );
      createdVerification = documents[0];
    });
  } finally {
    await session.endSession();
  }

  if (!createdVerification) throw new Error("Verifikationen kunde inte sparas");
  const isIncomingBalance = normalized.metadata.some(
    (entry) => entry.key === "IB"
  );
  if (!isIncomingBalance) {
    try {
      const sourceYear = accountingYear(normalized.verificationDate);
      if (!sourceYear) throw new Error("Verifikationen saknar bokföringsår");
      await refreshIncomingBalanceForFollowingYear(
        normalized.domain,
        sourceYear
      );
    } catch (error) {
      // Själva verifikationen är redan sparad. Nästa bokning eller manuell
      // omladdning försöker uppdatera IB igen utan att skapa en dubblett.
      console.error("Kunde inte uppdatera nästa års ingående balans", error);
    }
  }
  return createdVerification;
}

const incomingBalanceQuery = (domain: string, year: number) => ({
  domain,
  metadata: { $elemMatch: { key: "IB", value: String(year) } },
});

type MutableIncomingBalance = {
  journalEntries: unknown;
  recordType?: string;
  save: () => Promise<unknown>;
};

export async function synchronizeIncomingBalance(
  incomingBalance: MutableIncomingBalance,
  journalEntries: Array<{
    account: number;
    debit: number;
    credit: number;
  }>
) {
  incomingBalance.recordType = "incomingBalance";
  incomingBalance.journalEntries = journalEntries;
  await incomingBalance.save();
  return incomingBalance;
}

export async function refreshIncomingBalanceForFollowingYear(
  domain: string,
  sourceYear: number
) {
  const incomingBalance = await Verifications.findOne(
    incomingBalanceQuery(domain, sourceYear + 1)
  );
  if (!incomingBalance) return null;

  const journalEntries = await getIBJournalEntries(domain, sourceYear);
  return synchronizeIncomingBalance(incomingBalance, journalEntries);
}

export async function ensureIncomingBalance(domain: string, year: number) {
  const existing = await Verifications.findOne(incomingBalanceQuery(domain, year));
  if (existing) {
    const journalEntries = await getIBJournalEntries(domain, year - 1);
    return synchronizeIncomingBalance(existing, journalEntries);
  }

  const journalEntries = await getIBJournalEntries(domain, year - 1);
  if (journalEntries.length < 2) return null;
  return createVerification({
    domain,
    idempotencyKey: `ib:${year}`,
    description: "Ingående balans",
    verificationDate: new Date(Date.UTC(year, 0, 1, 12)),
    recordType: "incomingBalance",
    metadata: [{ key: "IB", value: year }],
    journalEntries,
  });
}
