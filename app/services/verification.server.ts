import mongoose, { type ClientSession } from "mongoose";
import { AccountingYears } from "~/schemas/accounting-years";
import { VerificationCounters } from "~/schemas/verification-counters";
import { Verifications } from "~/schemas/verifications";
import {
  normalizeJournalEntries,
  VerificationValidationError,
} from "~/utils/verificationValidation";
import { getIBJournalEntries } from "~/utils/accounts.server";
import { accountingMonthKey, accountingYear } from "~/utils/accountingDates";
import {
  evaluateAccountingYearClosing,
  type AccountingYearStatus,
  type ClosingVatReport,
} from "~/utils/accountingYearClosing";
import {
  evaluateVerificationEditPolicy,
  type VerificationEditPolicy,
} from "~/utils/verificationEditing";

type MetadataEntry = { key: string; value: string | number };
type FileEntry = { name: string; path: string };
const GLOBAL_COUNTER_KEY = "global";

export class AccountingYearClosedError extends Error {
  constructor(public readonly year: number) {
    super(
      `Bokföringsår ${year} är avslutat. Registrera rättelsen i ett öppet bokföringsår.`
    );
    this.name = "AccountingYearClosedError";
  }
}

export class AccountingYearClosingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingYearClosingError";
  }
}

export class VerificationEditBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationEditBlockedError";
  }
}

export type CreateVerificationInput = {
  description: string;
  verificationDate: Date;
  journalEntries: unknown;
  recordType?: "journal" | "vatReport" | "incomingBalance";
  idempotencyKey?: string;
  metadata?: MetadataEntry[];
  files?: FileEntry[];
};

export type EditVerificationInput = {
  verificationNumber: number;
  expectedYear: number;
  description: string;
  verificationDate: Date;
  journalEntries: unknown;
  reason: string;
  editedBy?: string;
};

export type RemoveVerificationFileInput = {
  verificationNumber: number;
  expectedYear: number;
  path: string;
  removedBy?: string;
};

const normalizeInput = (input: CreateVerificationInput) => {
  const description = input.description?.trim();
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

const accountingYearState = async (
  year: number,
  session?: ClientSession
) => {
  const query = AccountingYears.findOne({ year });
  if (session) query.session(session);
  return query.exec();
};

const ensureAccountingYearState = async (year: number) => {
  await AccountingYears.updateOne(
    { year },
    { $setOnInsert: { year, status: "open", revision: 0 } },
    { upsert: true }
  );
};

const touchOpenAccountingYear = async (
  year: number,
  session: ClientSession
) => {
  const state = await accountingYearState(year, session);
  if (!state) throw new Error("Bokföringsåret kunde inte förberedas");
  if (state.status !== "open") throw new AccountingYearClosedError(year);
  state.revision = Number(state.revision || 0) + 1;
  await state.save({ session });
  return state;
};

type EditableVerification = {
  recordType?: string;
  verificationDate: Date;
  metadata?: Array<{ key?: unknown; value?: unknown }>;
};

const reportedVatPeriods = async (
  periods: string[],
  session?: ClientSession
) => {
  if (periods.length === 0) return [];
  const query = Verifications.find({
    metadata: {
      $elemMatch: {
        key: "vatReport",
        value: { $in: periods },
      },
    },
  })
    .select("metadata")
    .lean();
  if (session) query.session(session);
  const reports = await query.exec();
  return reports
    .flatMap((report: any) => report.metadata ?? [])
    .filter((entry: any) => entry.key === "vatReport")
    .map((entry: any) => String(entry.value))
    .filter((period) => periods.includes(period));
};

export async function getVerificationEditPolicy({
  verification,
  targetDate,
  session,
}: {
  verification: EditableVerification;
  targetDate?: Date;
  session?: ClientSession;
}): Promise<VerificationEditPolicy> {
  const sourceYear = accountingYear(verification.verificationDate);
  const targetYear = accountingYear(targetDate ?? verification.verificationDate);
  const sourceMonth = accountingMonthKey(verification.verificationDate);
  const targetMonth = accountingMonthKey(
    targetDate ?? verification.verificationDate
  );
  if (!sourceYear || !targetYear || !sourceMonth || !targetMonth) {
    return {
      editable: false,
      reason: "Verifikationen saknar ett giltigt bokföringsdatum.",
      reportedPeriods: [],
    };
  }
  const [yearState, reportedPeriods] = await Promise.all([
    accountingYearState(sourceYear, session),
    reportedVatPeriods(
      Array.from(new Set([sourceMonth, targetMonth])),
      session
    ),
  ]);
  return evaluateVerificationEditPolicy({
    recordType: verification.recordType,
    metadataKeys: (verification.metadata ?? []).map((entry) =>
      String(entry.key ?? "")
    ),
    yearStatus: yearState?.status === "closed" ? "closed" : "open",
    sameAccountingYear: sourceYear === targetYear,
    reportedPeriods,
  });
}

export async function createVerification(input: CreateVerificationInput) {
  const normalized = normalizeInput(input);
  const sourceYear = accountingYear(normalized.verificationDate);
  if (!sourceYear) throw new Error("Verifikationen saknar bokföringsår");
  if (normalized.recordType !== "incomingBalance") {
    await ensureAccountingYearState(sourceYear);
  }
  const session = await mongoose.startSession();
  let createdVerification: any = null;

  try {
    await session.withTransaction(async () => {
      if (normalized.idempotencyKey) {
        const existing = await Verifications.findOne({
          idempotencyKey: normalized.idempotencyKey,
        }).session(session);
        if (existing) {
          createdVerification = existing;
          return;
        }
      }

      if (normalized.recordType !== "incomingBalance") {
        await touchOpenAccountingYear(sourceYear, session);
      }

      const latest = await Verifications.findOne({})
        .sort({ verificationNumber: -1 })
        .select("verificationNumber")
        .session(session)
        .lean();
      const latestNumber = Number((latest as any)?.verificationNumber ?? 0);

      await VerificationCounters.updateOne(
        { key: GLOBAL_COUNTER_KEY },
        {
          $max: { sequence: latestNumber },
          $setOnInsert: { key: GLOBAL_COUNTER_KEY },
        },
        { upsert: true, session }
      );
      const counter = await VerificationCounters.findOneAndUpdate(
        { key: GLOBAL_COUNTER_KEY },
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

      if (normalized.recordType !== "incomingBalance") {
        await refreshIncomingBalanceForFollowingYear(
          sourceYear,
          session
        );
      }
    });
  } finally {
    await session.endSession();
  }

  if (!createdVerification) throw new Error("Verifikationen kunde inte sparas");
  return createdVerification;
}

export async function createVerificationsBatch(inputs: CreateVerificationInput[]) {
  if (inputs.length === 0) return [];
  if (inputs.length > 250) {
    throw new Error("För många verifikationer i samma registrering");
  }

  const normalizedInputs = inputs.map(normalizeInput);
  const sourceYears = new Set<number>();
  for (const normalized of normalizedInputs) {
    if (normalized.recordType === "incomingBalance") continue;
    const sourceYear = accountingYear(normalized.verificationDate);
    if (!sourceYear) throw new Error("Verifikationen saknar bokföringsår");
    sourceYears.add(sourceYear);
  }
  await Promise.all(
    Array.from(sourceYears, (sourceYear) => ensureAccountingYearState(sourceYear))
  );
  const session = await mongoose.startSession();
  let savedVerifications: any[] = [];

  try {
    await session.withTransaction(async () => {
      const idempotencyKeys = normalizedInputs
        .map((input) => input.idempotencyKey)
        .filter((key): key is string => Boolean(key));
      const existing = idempotencyKeys.length
        ? await Verifications.find({
            idempotencyKey: { $in: idempotencyKeys },
          })
            .session(session)
            .exec()
        : [];
      const existingByKey = new Map(
        existing.map((verification) => [verification.idempotencyKey, verification])
      );

      const latest = await Verifications.findOne({})
        .sort({ verificationNumber: -1 })
        .select("verificationNumber")
        .session(session)
        .lean();
      const latestNumber = Number((latest as any)?.verificationNumber ?? 0);
      await VerificationCounters.updateOne(
        { key: GLOBAL_COUNTER_KEY },
        {
          $max: { sequence: latestNumber },
          $setOnInsert: { key: GLOBAL_COUNTER_KEY },
        },
        { upsert: true, session }
      );

      const result: any[] = [];
      const changedSourceYears = new Set<number>();
      for (const normalized of normalizedInputs) {
        const alreadySaved = normalized.idempotencyKey
          ? existingByKey.get(normalized.idempotencyKey)
          : null;
        if (alreadySaved) {
          result.push(alreadySaved);
          continue;
        }

        const sourceYear = accountingYear(normalized.verificationDate);
        if (!sourceYear) throw new Error("Verifikationen saknar bokföringsår");
        if (normalized.recordType !== "incomingBalance") {
          await touchOpenAccountingYear(sourceYear, session);
          changedSourceYears.add(sourceYear);
        }

        const counter = await VerificationCounters.findOneAndUpdate(
          { key: GLOBAL_COUNTER_KEY },
          { $inc: { sequence: 1 } },
          { new: true, session }
        );
        if (!counter) throw new Error("Kunde inte tilldela verifikationsnummer");
        const documents = await Verifications.create(
          [{ ...normalized, verificationNumber: counter.sequence }],
          { session }
        );
        const created = documents[0];
        result.push(created);
        if (normalized.idempotencyKey) {
          existingByKey.set(normalized.idempotencyKey, created);
        }
      }
      for (const sourceYear of changedSourceYears) {
        await refreshIncomingBalanceForFollowingYear(
          sourceYear,
          session
        );
      }
      savedVerifications = result;
    });
  } finally {
    await session.endSession();
  }

  if (savedVerifications.length !== normalizedInputs.length) {
    throw new Error("Alla verifikationer kunde inte sparas");
  }

  return savedVerifications;
}

export async function editVerification(input: EditVerificationInput) {
  if (!Number.isInteger(input.verificationNumber) || input.verificationNumber < 1) {
    throw new Error("Ogiltigt verifikationsnummer");
  }
  const reason = input.reason?.trim();
  if (!reason || reason.length < 3 || reason.length > 500) {
    throw new VerificationValidationError(
      "Beskriv kort varför verifikationen ändras"
    );
  }
  const normalized = normalizeInput({
    description: input.description,
    verificationDate: input.verificationDate,
    journalEntries: input.journalEntries,
    recordType: "journal",
  });
  const targetYear = accountingYear(normalized.verificationDate);
  if (targetYear !== input.expectedYear) {
    throw new VerificationEditBlockedError(
      `Bokföringsdatumet måste tillhöra bokföringsår ${input.expectedYear}.`
    );
  }
  await ensureAccountingYearState(input.expectedYear);

  const session = await mongoose.startSession();
  let editedVerification: any = null;
  try {
    await session.withTransaction(async () => {
      const verification = await Verifications.findOne({
        verificationNumber: input.verificationNumber,
      }).session(session);
      if (!verification) throw new Error("Verifikationen hittades inte");

      const sourceYear = accountingYear(verification.verificationDate);
      if (sourceYear !== input.expectedYear) {
        throw new VerificationEditBlockedError(
          `Verifikationen tillhör bokföringsår ${sourceYear ?? "okänt"}, inte ${input.expectedYear}.`
        );
      }
      const policy = await getVerificationEditPolicy({
        verification,
        targetDate: normalized.verificationDate,
        session,
      });
      if (!policy.editable) {
        throw new VerificationEditBlockedError(
          policy.reason || "Verifikationen kan inte redigeras"
        );
      }

      await touchOpenAccountingYear(input.expectedYear, session);
      verification.editHistory = [
        ...(verification.editHistory ?? []),
        {
          editedAt: new Date(),
          editedBy: input.editedBy?.trim() || undefined,
          reason,
          previousDescription: verification.description,
          previousVerificationDate: verification.verificationDate,
          previousJournalEntries: (verification.journalEntries ?? []).map(
            (entry: any) => ({
              account: Number(entry.account),
              debit: Number(entry.debit || 0),
              credit: Number(entry.credit || 0),
            })
          ),
        },
      ];
      verification.recordType = "journal";
      verification.description = normalized.description;
      verification.verificationDate = normalized.verificationDate;
      verification.journalEntries = normalized.journalEntries;
      await verification.save({ session });
      await refreshIncomingBalanceForFollowingYear(
        input.expectedYear,
        session
      );
      editedVerification = verification;
    });
  } finally {
    await session.endSession();
  }
  if (!editedVerification) throw new Error("Verifikationen kunde inte uppdateras");
  return editedVerification;
}

export async function removeVerificationFileReference(
  input: RemoveVerificationFileInput
) {
  if (!Number.isInteger(input.verificationNumber) || input.verificationNumber < 1) {
    throw new VerificationValidationError("Ogiltigt verifikationsnummer");
  }
  const path = input.path?.trim();
  if (!path || path.length > 4_096) {
    throw new VerificationValidationError("Bilagan kunde inte identifieras");
  }
  await ensureAccountingYearState(input.expectedYear);

  const session = await mongoose.startSession();
  let removedFile: { name: string; path: string } | null = null;
  try {
    await session.withTransaction(async () => {
      const verification = await Verifications.findOne({
        verificationNumber: input.verificationNumber,
      }).session(session);
      if (!verification) {
        throw new VerificationValidationError("Verifikationen hittades inte");
      }

      const sourceYear = accountingYear(verification.verificationDate);
      if (sourceYear !== input.expectedYear) {
        throw new VerificationEditBlockedError(
          `Verifikationen tillhör bokföringsår ${sourceYear ?? "okänt"}, inte ${input.expectedYear}.`
        );
      }
      const policy = await getVerificationEditPolicy({
        verification,
        session,
      });
      if (!policy.editable) {
        throw new VerificationEditBlockedError(
          policy.reason || "Bilagan kan inte tas bort"
        );
      }

      const fileIndex = (verification.files ?? []).findIndex(
        (file: any) => String(file.path) === path
      );
      if (fileIndex < 0) {
        throw new VerificationValidationError(
          "Bilagan är redan borttagen eller finns inte längre"
        );
      }
      const file = verification.files[fileIndex] as any;
      removedFile = {
        name: String(file.name || "Bilaga"),
        path: String(file.path),
      };

      await touchOpenAccountingYear(input.expectedYear, session);
      verification.files.splice(fileIndex, 1);
      verification.fileHistory = [
        ...(verification.fileHistory ?? []),
        {
          action: "removed",
          changedAt: new Date(),
          changedBy: input.removedBy?.trim() || undefined,
          name: removedFile.name,
          path: removedFile.path,
        },
      ];
      await verification.save({ session });
      await refreshIncomingBalanceForFollowingYear(
        input.expectedYear,
        session
      );
    });
  } finally {
    await session.endSession();
  }

  if (!removedFile) {
    throw new Error("Bilagan kunde inte tas bort från verifikationen");
  }
  return removedFile;
}

const incomingBalanceQuery = (year: number) => ({
  metadata: { $elemMatch: { key: "IB", value: String(year) } },
});

type MutableIncomingBalance = {
  journalEntries: unknown;
  metadata?: unknown;
  recordType?: string;
  save: (options?: { session?: ClientSession }) => Promise<unknown>;
};

type IncomingBalanceState = "preliminary" | "final";

const plainMetadata = (metadata: unknown) =>
  Array.isArray(metadata)
    ? metadata
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const source = entry as {
            key?: unknown;
            value?: unknown;
            toObject?: () => { key?: unknown; value?: unknown };
          };
          const value = source.toObject ? source.toObject() : source;
          return {
            key: String(value.key ?? ""),
            value: String(value.value ?? ""),
          };
        })
        .filter((entry): entry is { key: string; value: string } => Boolean(entry?.key))
    : [];

const withIncomingBalanceMetadata = (
  metadata: unknown,
  {
    sourceYear,
    sourceRevision,
    state,
    calculatedAt,
  }: {
    sourceYear: number;
    sourceRevision: number;
    state: IncomingBalanceState;
    calculatedAt: Date;
  }
) => {
  const managedKeys = new Set([
    "IBStatus",
    "IBSourceYear",
    "IBSourceRevision",
    "IBCalculatedAt",
  ]);
  return [
    ...plainMetadata(metadata).filter((entry) => !managedKeys.has(entry.key)),
    { key: "IBStatus", value: state },
    { key: "IBSourceYear", value: String(sourceYear) },
    { key: "IBSourceRevision", value: String(sourceRevision) },
    { key: "IBCalculatedAt", value: calculatedAt.toISOString() },
  ];
};

export async function synchronizeIncomingBalance(
  incomingBalance: MutableIncomingBalance,
  journalEntries: Array<{
    account: number;
    debit: number;
    credit: number;
  }>,
  options?: {
    sourceYear: number;
    sourceRevision: number;
    state: IncomingBalanceState;
    calculatedAt?: Date;
    session?: ClientSession;
  }
) {
  incomingBalance.recordType = "incomingBalance";
  incomingBalance.journalEntries = journalEntries;
  if (options) {
    incomingBalance.metadata = withIncomingBalanceMetadata(
      incomingBalance.metadata,
      {
        sourceYear: options.sourceYear,
        sourceRevision: options.sourceRevision,
        state: options.state,
        calculatedAt: options.calculatedAt ?? new Date(),
      }
    );
  }
  await incomingBalance.save(options?.session ? { session: options.session } : undefined);
  return incomingBalance;
}

export async function refreshIncomingBalanceForFollowingYear(
  sourceYear: number,
  session?: ClientSession
) {
  const targetYearState = await accountingYearState(
    sourceYear + 1,
    session
  );
  if (targetYearState?.status === "closed") {
    throw new AccountingYearClosedError(sourceYear + 1);
  }
  const incomingBalanceQueryBuilder = Verifications.findOne(
    incomingBalanceQuery(sourceYear + 1)
  );
  if (session) incomingBalanceQueryBuilder.session(session);
  const incomingBalance = await incomingBalanceQueryBuilder.exec();
  if (!incomingBalance) return null;

  const sourceState = await accountingYearState(sourceYear, session);
  const journalEntries = await getIBJournalEntries(sourceYear, session);
  return synchronizeIncomingBalance(incomingBalance, journalEntries, {
    sourceYear,
    sourceRevision: Number(sourceState?.revision || 0),
    state: sourceState?.status === "closed" ? "final" : "preliminary",
    session,
  });
}

export async function ensureIncomingBalance(year: number) {
  const existing = await Verifications.findOne(incomingBalanceQuery(year));
  const targetState = await accountingYearState(year);
  if (targetState?.status === "closed") {
    if (existing) return existing;
    throw new AccountingYearClosedError(year);
  }
  const sourceState = await accountingYearState(year - 1);
  const synchronizationOptions = {
    sourceYear: year - 1,
    sourceRevision: Number(sourceState?.revision || 0),
    state: (sourceState?.status === "closed" ? "final" : "preliminary") as IncomingBalanceState,
  };
  if (existing) {
    const journalEntries = await getIBJournalEntries(year - 1);
    return synchronizeIncomingBalance(existing, journalEntries, synchronizationOptions);
  }

  const journalEntries = await getIBJournalEntries(year - 1);
  return createVerification({
    idempotencyKey: `ib:${year}`,
    description: "Ingående balans",
    verificationDate: new Date(Date.UTC(year, 0, 1, 12)),
    recordType: "incomingBalance",
    metadata: [
      { key: "IB", value: year },
      { key: "IBStatus", value: synchronizationOptions.state },
      { key: "IBSourceYear", value: synchronizationOptions.sourceYear },
      { key: "IBSourceRevision", value: synchronizationOptions.sourceRevision },
      { key: "IBCalculatedAt", value: new Date().toISOString() },
    ],
    journalEntries,
  });
}

const metadataValue = (
  metadata: Array<{ key?: unknown; value?: unknown }> | undefined,
  key: string
) => {
  const value = metadata?.find((entry) => entry.key === key)?.value;
  return value === undefined ? null : String(value);
};

const loadClosingVatReports = async (
  year: number,
  session?: ClientSession
) => {
  const query = Verifications.find({
    metadata: {
      $elemMatch: {
        key: "vatReport",
        value: { $regex: `^${year}-(0[1-9]|1[0-2])$` },
      },
    },
  })
    .select("metadata journalEntries")
    .lean();
  if (session) query.session(session);
  const reports = await query.exec();
  return reports.map((report: any) => ({
    period: metadataValue(report.metadata, "vatReport") || "",
    metadata: plainMetadata(report.metadata),
    journalEntries: (report.journalEntries ?? []).map((entry: any) => ({
      account: Number(entry.account),
      debit: Number(entry.debit || 0),
      credit: Number(entry.credit || 0),
    })),
  })) satisfies ClosingVatReport[];
};

const incomingBalanceSummary = (incomingBalance: any) =>
  incomingBalance
    ? {
        verificationNumber: Number(incomingBalance.verificationNumber),
        state:
          metadataValue(incomingBalance.metadata, "IBStatus") ||
          "preliminary",
        calculatedAt: metadataValue(incomingBalance.metadata, "IBCalculatedAt"),
      }
    : null;

export async function getAccountingYearClosingReadiness(
  year: number,
  now = new Date()
) {
  const [state, vatReports, incomingBalance] = await Promise.all([
    accountingYearState(year),
    loadClosingVatReports(year),
    Verifications.findOne(incomingBalanceQuery(year + 1))
      .select("verificationNumber metadata")
      .lean()
      .exec(),
  ]);
  const currentYear = accountingYear(now);
  if (!currentYear) throw new Error("Kunde inte fastställa aktuellt bokföringsår");
  const readiness = evaluateAccountingYearClosing({
    year,
    currentYear,
    status: (state?.status || "open") as AccountingYearStatus,
    vatReports,
  });
  return {
    ...readiness,
    closedAt: state?.closedAt?.toISOString?.() || null,
    incomingBalance: incomingBalanceSummary(incomingBalance),
  };
}

export async function getAccountingYearStatus(year: number) {
  const state = await AccountingYears.findOne({ year })
    .select("status -_id")
    .lean()
    .exec();
  return (state?.status || "open") as AccountingYearStatus;
}

export async function closeAccountingYear({
  year,
  now = new Date(),
}: {
  year: number;
  now?: Date;
}) {
  const initialReadiness = await getAccountingYearClosingReadiness(
    year,
    now
  );
  if (initialReadiness.status === "closed") return initialReadiness;
  if (!initialReadiness.canClose) {
    if (!initialReadiness.yearHasPassed) {
      throw new AccountingYearClosingError(
        `Bokföringsår ${year} kan avslutas först när året har passerat.`
      );
    }
    if (initialReadiness.missingVatMonths.length) {
      throw new AccountingYearClosingError(
        `Registrera momsrapport för ${initialReadiness.missingVatMonths.join(", ")} innan årsavslutet.`
      );
    }
    throw new AccountingYearClosingError(
      `Registrera momshändelsen på skattekontot för ${initialReadiness.unsettledVatMonths.join(", ")} innan årsavslutet.`
    );
  }

  const followingYearStatus = await getAccountingYearStatus(year + 1);
  if (followingYearStatus === "closed") {
    throw new AccountingYearClosingError(
      `Bokföringsår ${year + 1} är redan avslutat och dess IB kan därför inte ändras.`
    );
  }

  await ensureAccountingYearState(year);
  await ensureIncomingBalance(year + 1);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const state = await accountingYearState(year, session);
      if (!state) throw new Error("Bokföringsåret kunde inte förberedas");
      if (state.status === "closed") return;

      const currentYear = accountingYear(now);
      if (!currentYear) throw new Error("Kunde inte fastställa aktuellt bokföringsår");
      const vatReports = await loadClosingVatReports(year, session);
      const readiness = evaluateAccountingYearClosing({
        year,
        currentYear,
        status: state.status as AccountingYearStatus,
        vatReports,
      });
      if (!readiness.canClose) {
        throw new AccountingYearClosingError(
          "Förutsättningarna för årsavslutet har ändrats. Ladda om och kontrollera året igen."
        );
      }

      const incomingBalanceQueryBuilder = Verifications.findOne(
        incomingBalanceQuery(year + 1)
      ).session(session);
      const incomingBalance = await incomingBalanceQueryBuilder.exec();
      if (!incomingBalance) {
        throw new Error("Nästa års ingående balans kunde inte skapas");
      }
      const journalEntries = await getIBJournalEntries(year, session);
      await synchronizeIncomingBalance(incomingBalance, journalEntries, {
        sourceYear: year,
        sourceRevision: Number(state.revision || 0),
        state: "final",
        calculatedAt: now,
        session,
      });

      state.status = "closed";
      state.closedAt = now;
      state.finalIncomingBalanceVerificationNumber = Number(
        incomingBalance.verificationNumber
      );
      await state.save({ session });
    });
  } finally {
    await session.endSession();
  }

  return getAccountingYearClosingReadiness(year, now);
}
