import mongoose from "mongoose";
import { Verifications } from "../app/schemas/verifications";
import { connectToDatabase } from "../app/services/database.server";
import { createVerificationsBatch } from "../app/services/verification.server";
import { parseAccountingDate } from "../app/utils/accountingDates";

const DOMAIN = "moaclayco";
const MIGRATION = "legacy-tax-account-2050-2026-v1";
const ISSUE_NUMBER = 209;
const SOURCE_NUMBERS = [223, 224, 226, 227, 228, 229];
const TRACKED_ACCOUNTS = [2012, 2050, 2013, 2018, 2650, 8314];

type Entry = { account: number; debit: number; credit: number };

const expectedSources: Record<number, Entry[]> = {
  223: [
    { account: 2012, debit: 1, credit: 0 },
    { account: 2050, debit: 0, credit: 1 },
  ],
  224: [
    { account: 2012, debit: 0, credit: 399 },
    { account: 2050, debit: 399, credit: 0 },
  ],
  226: [
    { account: 2650, debit: 239, credit: 0 },
    { account: 2050, debit: 0, credit: 239 },
    { account: 2012, debit: 239, credit: 0 },
    { account: 2018, debit: 0, credit: 239 },
  ],
  227: [
    { account: 2012, debit: 1, credit: 0 },
    { account: 2050, debit: 0, credit: 1 },
  ],
  228: [
    { account: 2012, debit: 0, credit: 399 },
    { account: 2050, debit: 399, credit: 0 },
  ],
  229: [
    { account: 2650, debit: 239, credit: 0 },
    { account: 2012, debit: 0, credit: 239 },
    { account: 2018, debit: 239, credit: 0 },
    { account: 2050, debit: 0, credit: 239 },
  ],
};

const corrections: Array<{ source: number; entries: Entry[] }> = [
  {
    source: 223,
    entries: [
      { account: 2050, debit: 1, credit: 0 },
      { account: 8314, debit: 0, credit: 1 },
    ],
  },
  {
    source: 224,
    entries: [
      { account: 2013, debit: 399, credit: 0 },
      { account: 2050, debit: 0, credit: 399 },
    ],
  },
  {
    source: 226,
    entries: [
      { account: 2050, debit: 239, credit: 0 },
      { account: 2650, debit: 0, credit: 239 },
    ],
  },
  {
    source: 227,
    entries: [
      { account: 2050, debit: 1, credit: 0 },
      { account: 8314, debit: 0, credit: 1 },
    ],
  },
  {
    source: 228,
    entries: [
      { account: 2013, debit: 399, credit: 0 },
      { account: 2050, debit: 0, credit: 399 },
    ],
  },
  {
    source: 229,
    entries: [
      { account: 2012, debit: 239, credit: 0 },
      { account: 2650, debit: 0, credit: 239 },
      { account: 2050, debit: 239, credit: 0 },
      { account: 2018, debit: 0, credit: 239 },
    ],
  },
];

const canonicalEntries = (entries: any[]): Entry[] =>
  entries.map((entry) => ({
    account: Number(entry.account),
    debit: Number(entry.debit || 0),
    credit: Number(entry.credit || 0),
  }));

const balancesFor2026 = async () => {
  const rows = await Verifications.find({
    domain: DOMAIN,
    verificationDate: {
      $gte: new Date("2025-12-31T23:00:00.000Z"),
      $lt: new Date("2026-12-31T23:00:00.000Z"),
    },
  })
    .select("journalEntries")
    .lean();
  const balances = Object.fromEntries(
    TRACKED_ACCOUNTS.map((account) => [account, 0])
  ) as Record<number, number>;
  for (const row of rows) {
    for (const entry of row.journalEntries ?? []) {
      const account = Number(entry.account);
      if (!(account in balances)) continue;
      balances[account] += Number(entry.debit || 0) - Number(entry.credit || 0);
    }
  }
  for (const account of TRACKED_ACCOUNTS) {
    balances[account] = Math.round(balances[account] * 100) / 100;
  }
  return balances;
};

const readArgument = (name: string) =>
  process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);

const run = async () => {
  const target = readArgument("--target");
  const correctionDateValue = readArgument("--date");
  const apply = process.argv.includes("--apply");
  if (target !== "stage" && target !== "production") {
    throw new Error("Ange --target=stage eller --target=production");
  }
  if (!correctionDateValue) throw new Error("Ange rättelsedatum med --date=YYYY-MM-DD");
  const correctionDate = parseAccountingDate(correctionDateValue);
  if (!correctionDate || !correctionDateValue.startsWith("2026-")) {
    throw new Error("Rättelsedatumet måste vara ett giltigt datum under 2026");
  }
  if (
    target === "production" &&
    apply &&
    !process.argv.includes(`--confirm-production=issue-${ISSUE_NUMBER}`)
  ) {
    throw new Error(
      `Production kräver --confirm-production=issue-${ISSUE_NUMBER}`
    );
  }

  await connectToDatabase();
  const databaseName = mongoose.connection.db?.databaseName ?? "";
  if (target === "stage" && !databaseName.includes("stage")) {
    throw new Error(`Vägrar stage-körning mot databasen ${databaseName}`);
  }
  if (target === "production" && databaseName.includes("stage")) {
    throw new Error(`Vägrar production-körning mot databasen ${databaseName}`);
  }

  const sourceDocuments = await Verifications.find({
    domain: DOMAIN,
    verificationNumber: { $in: SOURCE_NUMBERS },
  })
    .select("verificationNumber journalEntries")
    .lean();
  if (sourceDocuments.length !== SOURCE_NUMBERS.length) {
    throw new Error("Alla förväntade originalverifikationer finns inte");
  }
  for (const source of sourceDocuments) {
    const number = Number(source.verificationNumber);
    if (
      JSON.stringify(canonicalEntries(source.journalEntries ?? [])) !==
      JSON.stringify(expectedSources[number])
    ) {
      throw new Error(`A${number} har ändrats sedan migreringen förbereddes`);
    }
  }

  // A229:s momsdel får bara vändas när PDF-importen redan har skapat den
  // korrekta ersättningsposten för 2026-04-13.
  const replacement = (await Verifications.findOne({
    domain: DOMAIN,
    metadata: {
      $elemMatch: { key: "taxAccountRow", value: "2026-04-13:-23900:1" },
    },
  })
    .select("verificationNumber journalEntries")
    .lean()) as any;
  if (
    !replacement ||
    JSON.stringify(canonicalEntries(replacement.journalEntries ?? [])) !==
      JSON.stringify([
        { account: 2650, debit: 239, credit: 0 },
        { account: 2012, debit: 0, credit: 239 },
      ])
  ) {
    throw new Error("Den korrekta ersättningsposten för A229 saknas");
  }

  const idempotencyKeys = corrections.map(
    ({ source }) => `${MIGRATION}:A${source}`
  );
  const existing = await Verifications.find({
    domain: DOMAIN,
    idempotencyKey: { $in: idempotencyKeys },
  })
    .select("verificationNumber idempotencyKey")
    .lean();
  if (existing.length !== 0 && existing.length !== corrections.length) {
    throw new Error("Migreringen är endast delvis registrerad och måste granskas manuellt");
  }

  const before = await balancesFor2026();
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        target,
        databaseName,
        correctionDate: correctionDateValue,
        replacementVerification: replacement.verificationNumber,
        existingCorrections: existing,
        balancesBefore: before,
        corrections,
      },
      null,
      2
    )
  );
  if (!apply) return;

  const saved = await createVerificationsBatch(
    corrections.map(({ source, entries }) => ({
      domain: DOMAIN,
      description: `Rättelse av äldre skattekontokontering A${source}`,
      verificationDate: correctionDate,
      idempotencyKey: `${MIGRATION}:A${source}`,
      metadata: [
        { key: "legacy2050Correction", value: "true" },
        { key: "migration", value: MIGRATION },
        { key: "correctionForVerification", value: source },
        { key: "githubIssue", value: ISSUE_NUMBER },
      ],
      journalEntries: entries,
    }))
  );

  const after = await balancesFor2026();
  const expectedDelta: Record<number, number> = {
    2012: 239,
    2050: -318,
    2013: 798,
    2018: -239,
    2650: -478,
    8314: -2,
  };
  if (existing.length === 0) {
    for (const account of TRACKED_ACCOUNTS) {
      const delta = Math.round((after[account] - before[account]) * 100) / 100;
      if (delta !== expectedDelta[account]) {
        throw new Error(
          `Oväntad förändring på ${account}: ${delta}, förväntat ${expectedDelta[account]}`
        );
      }
    }
  }
  if (after[2050] !== 0) {
    throw new Error(`2050 är inte noll efter migreringen: ${after[2050]}`);
  }

  console.log(
    JSON.stringify(
      {
        savedVerificationNumbers: saved.map((row: any) => row.verificationNumber),
        balancesAfter: after,
      },
      null,
      2
    )
  );
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
