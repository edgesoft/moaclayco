import mongoose from "mongoose";
import { connectToDatabase } from "../app/services/database.server";

const MIGRATION = "remove-tax-account-2050-v2";
const LEGACY_RECLASSIFICATION_KEY =
  "tax-account-2050-to-2012-2026-v1:single-reclassification";
const EXPECTED_TRANSFORM_COUNTS = {
  interest: 16,
  tax: 6,
  deposit: 10,
  vat: 10,
} as const;

const REPLACED_CORRECTIONS = [
  {
    number: 231,
    key: "correction:2026:a223:tax-interest",
    entries: [
      [2050, 1, 0],
      [8314, 0, 1],
    ],
  },
  {
    number: 232,
    key: "correction:2026:a224:preliminary-tax",
    entries: [
      [2013, 399, 0],
      [2050, 0, 399],
    ],
  },
  {
    number: 233,
    key: "correction:2026:a226:separate-tax-events",
    entries: [
      [2050, 239, 0],
      [2012, 399, 0],
      [2650, 0, 239],
      [2018, 0, 399],
    ],
  },
  {
    number: 235,
    key: "correction:2026:a227:tax-interest",
    entries: [
      [2050, 1, 0],
      [8314, 0, 1],
    ],
  },
  {
    number: 236,
    key: "correction:2026:a228:preliminary-tax",
    entries: [
      [2013, 399, 0],
      [2050, 0, 399],
    ],
  },
  {
    number: 237,
    key: "correction:2026:a229:reverse-wrong-date",
    entries: [
      [2012, 239, 0],
      [2050, 239, 0],
      [2650, 0, 239],
      [2018, 0, 239],
    ],
  },
] as const;

type Entry = {
  _id?: unknown;
  account: number;
  debit?: number;
  credit?: number;
};

type Verification = {
  _id: mongoose.Types.ObjectId;
  verificationNumber: number;
  verificationDate: Date;
  description: string;
  idempotencyKey?: string;
  recordType?: string;
  journalEntries: Entry[];
  metadata?: Array<{ _id?: unknown; key?: string; value?: string }>;
  files?: Array<{ _id?: unknown; name?: string; path?: string }>;
};

type TransformKind = keyof typeof EXPECTED_TRANSFORM_COUNTS;

const readArgument = (name: string) =>
  process.argv
    .find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const normalizedDescription = (value: string) =>
  value.trim().toLocaleLowerCase("sv-SE").replace(/\s+/g, " ");

const canonicalEntries = (entries: Entry[]) =>
  entries.map((entry) => [
    Number(entry.account),
    Number(entry.debit || 0),
    Number(entry.credit || 0),
  ]);

const entryAmount = (entry: Entry) =>
  Number(entry.debit || 0) - Number(entry.credit || 0);

const assertBalanced = (verification: Pick<Verification, "verificationNumber" | "journalEntries">) => {
  const balanceInCents = verification.journalEntries.reduce(
    (total, entry) => total + Math.round(entryAmount(entry) * 100),
    0
  );
  if (balanceInCents !== 0) {
    throw new Error(`A${verification.verificationNumber} balanserar inte`);
  }
};

const assertPostingRows = (
  verification: Pick<Verification, "verificationNumber" | "journalEntries">
) => {
  if (verification.journalEntries.length < 2) {
    throw new Error(`A${verification.verificationNumber} har för få rader`);
  }
  for (const [index, entry] of verification.journalEntries.entries()) {
    const debit = Number(entry.debit || 0);
    const credit = Number(entry.credit || 0);
    if (
      !Number.isFinite(debit) ||
      !Number.isFinite(credit) ||
      debit < 0 ||
      credit < 0 ||
      (debit > 0) === (credit > 0)
    ) {
      throw new Error(
        `A${verification.verificationNumber} rad ${index + 1} har ogiltig debet/kredit`
      );
    }
  }
};

const transformKind = (verification: Verification): TransformKind => {
  const description = normalizedDescription(verification.description);
  if (description.includes("intäktsränta")) return "interest";
  if (
    description === "debiterad preliminärskatt" ||
    description === "slutlig skatt" ||
    description === "avdragen skatt"
  ) {
    return "tax";
  }
  if (description === "inbetalning moms skattemyndigheten") return "deposit";
  if (description.includes("moms")) return "vat";
  throw new Error(
    `A${verification.verificationNumber} har okänd 2050-händelse: ${verification.description}`
  );
};

const replaceAccount = (
  verification: Verification,
  replacementAccount: number
) => {
  if (
    verification.journalEntries.length !== 2 ||
    verification.journalEntries.filter((entry) => Number(entry.account) === 2050)
      .length !== 1 ||
    verification.journalEntries.filter((entry) => Number(entry.account) === 2012)
      .length !== 1
  ) {
    throw new Error(`A${verification.verificationNumber} har oväntade rader`);
  }
  const entries = verification.journalEntries.map((entry) =>
    Number(entry.account) === 2050
      ? { ...entry, account: replacementAccount }
      : entry
  );
  assertBalanced({ ...verification, journalEntries: entries });
  return entries;
};

const keepOnlyTaxAccountDeposit = (verification: Verification) => {
  if (
    verification.journalEntries.length !== 4 ||
    verification.journalEntries.filter((entry) => Number(entry.account) === 2050)
      .length !== 1 ||
    verification.journalEntries.filter((entry) => Number(entry.account) === 2650)
      .length !== 1
  ) {
    throw new Error(`A${verification.verificationNumber} har oväntad inbetalning`);
  }
  const removed2050 = verification.journalEntries.find(
    (entry) => Number(entry.account) === 2050
  );
  const removed2650 = verification.journalEntries.find(
    (entry) => Number(entry.account) === 2650
  );
  if (!removed2050 || !removed2650 || entryAmount(removed2050) !== -entryAmount(removed2650)) {
    throw new Error(`A${verification.verificationNumber} har obalanserad äldre momsdel`);
  }
  const entries = verification.journalEntries.filter(
    (entry) => ![2050, 2650].includes(Number(entry.account))
  );
  if (
    entries.length !== 2 ||
    !entries.some(
      (entry) => Number(entry.account) === 2012 && Number(entry.debit || 0) > 0
    ) ||
    !entries.some(
      (entry) =>
        [1930, 2018].includes(Number(entry.account)) &&
        Number(entry.credit || 0) > 0
    )
  ) {
    throw new Error(`A${verification.verificationNumber} saknar riktig inbetalning`);
  }
  assertBalanced({ ...verification, journalEntries: entries });
  return entries;
};

const migrationMetadata = (verification: Verification) => [
  ...(verification.metadata ?? []),
  {
    _id: new mongoose.Types.ObjectId(),
    key: "migration",
    value: MIGRATION,
  },
];

const transformVerification = (verification: Verification) => {
  assertBalanced(verification);
  const kind = transformKind(verification);
  let journalEntries: Entry[];
  if (kind === "interest") journalEntries = replaceAccount(verification, 8314);
  else if (kind === "tax") journalEntries = replaceAccount(verification, 2013);
  else if (kind === "vat") journalEntries = replaceAccount(verification, 2650);
  else journalEntries = keepOnlyTaxAccountDeposit(verification);
  return {
    kind,
    document: {
      ...verification,
      journalEntries,
      metadata: migrationMetadata(verification),
    },
  };
};

const filesWithSource = (target: Verification, source: Verification) => {
  const files = [...(target.files ?? [])];
  const paths = new Set(files.map((file) => file.path));
  for (const file of source.files ?? []) {
    if (file.path && !paths.has(file.path)) {
      files.push(file);
      paths.add(file.path);
    }
  }
  return files;
};

const trackedBalances = (verifications: Verification[]) => {
  const trackedAccounts = new Set([1930, 2012, 2013, 2018, 2050, 2650, 8314]);
  const result: Record<string, Record<number, number>> = {};
  for (const verification of verifications) {
    const year = String(verification.verificationDate.getUTCFullYear());
    result[year] ??= {};
    for (const entry of verification.journalEntries ?? []) {
      const account = Number(entry.account);
      if (!trackedAccounts.has(account)) continue;
      result[year][account] =
        Math.round(((result[year][account] ?? 0) + entryAmount(entry)) * 100) /
        100;
    }
  }
  return result;
};

const assertFinalState = (verifications: Verification[]) => {
  const with2050 = verifications.filter((verification) =>
    verification.journalEntries?.some((entry) => Number(entry.account) === 2050)
  );
  if (with2050.length) {
    throw new Error(`2050 finns kvar i ${with2050.length} verifikationer`);
  }
  for (const verification of verifications) {
    assertBalanced(verification);
    if (
      verification.metadata?.some(
        (entry) => entry.key === "migration" && entry.value === MIGRATION
      )
    ) {
      assertPostingRows(verification);
    }
  }
  const numbers = verifications.map((verification) => verification.verificationNumber);
  if (new Set(numbers).size !== numbers.length) {
    throw new Error("Det finns dubbla verifikationsnummer efter migreringen");
  }
};

const run = async () => {
  const target = readArgument("--target");
  const apply = process.argv.includes("--apply");
  if (target !== "stage" && target !== "production") {
    throw new Error("Ange --target=stage eller --target=production");
  }
  if (
    target === "production" &&
    apply &&
    !process.argv.includes("--confirm-production=remove-2050")
  ) {
    throw new Error("Production kräver --confirm-production=remove-2050");
  }

  await connectToDatabase();
  const database = mongoose.connection.db;
  if (!database) throw new Error("Databasanslutningen saknas");
  const databaseName = database.databaseName;
  if (target === "stage" && databaseName !== "storm-stage") {
    throw new Error(`Stage-körning kräver storm-stage, fick ${databaseName}`);
  }
  if (target === "production" && databaseName !== "storm") {
    throw new Error(`Production-körning kräver storm, fick ${databaseName}`);
  }

  const collection = database.collection<Verification>("verifications");
  const counters = database.collection("verificationCounters");
  const unexpectedDomain = await collection.findOne({
    domain: { $exists: true, $ne: "moaclayco" },
  });
  if (unexpectedDomain) {
    throw new Error("Verifikationerna innehåller en annan äldre butik än moaclayco");
  }
  const all = await collection
    .find({})
    .sort({ verificationDate: 1, verificationNumber: 1 })
    .toArray();
  const correctionKeys = REPLACED_CORRECTIONS.map(({ key }) => key);
  const corrections = all.filter((verification) =>
    correctionKeys.includes(verification.idempotencyKey as any)
  );
  const legacyReclassification = all.find(
    (verification) =>
      verification.idempotencyKey === LEGACY_RECLASSIFICATION_KEY
  );
  const wrongVat = all.find(
    (verification) => verification.verificationNumber === 229
  );
  const correctVat = all.find(
    (verification) =>
      verification.idempotencyKey === "tax-account:2026-04-13:vat:2026-02"
  );
  const alreadyApplied =
    !all.some((verification) =>
      verification.journalEntries?.some((entry) => Number(entry.account) === 2050)
    ) &&
    !wrongVat &&
    !legacyReclassification &&
    corrections.length === 0 &&
    correctVat?.metadata?.some(
      (entry) => entry.key === "migration" && entry.value === MIGRATION
    );

  if (alreadyApplied) {
    assertFinalState(all);
    console.log(
      JSON.stringify(
        {
          mode: "already-applied",
          target,
          databaseName,
          verificationCount: all.length,
          account2050Rows: 0,
          balances: trackedBalances(all),
        },
        null,
        2
      )
    );
    return;
  }

  if (corrections.length !== 0 && corrections.length !== REPLACED_CORRECTIONS.length) {
    throw new Error(`Ofullständig uppsättning gamla rättelser: ${corrections.length}`);
  }
  for (const expected of REPLACED_CORRECTIONS) {
    const actual = corrections.find(
      (verification) => verification.idempotencyKey === expected.key
    );
    if (
      corrections.length &&
      (!actual ||
        actual.verificationNumber !== expected.number ||
        JSON.stringify(canonicalEntries(actual.journalEntries)) !==
          JSON.stringify(expected.entries))
    ) {
      throw new Error(`Den gamla rättelsen A${expected.number} har ändrats`);
    }
  }

  if (
    legacyReclassification &&
    JSON.stringify(canonicalEntries(legacyReclassification.journalEntries)) !==
      JSON.stringify([
        [2012, 318, 0],
        [2050, 0, 318],
      ])
  ) {
    throw new Error("Den tillfälliga A239-omföringen har ändrats");
  }
  if (
    !wrongVat ||
    wrongVat.verificationDate.toISOString().slice(0, 10) !== "2026-04-19" ||
    JSON.stringify(canonicalEntries(wrongVat.journalEntries)) !==
      JSON.stringify([
        [2650, 239, 0],
        [2012, 0, 239],
        [2018, 239, 0],
        [2050, 0, 239],
      ])
  ) {
    throw new Error("A229 saknas eller har ändrats");
  }
  if (
    !correctVat ||
    correctVat.verificationNumber !== 238 ||
    correctVat.verificationDate.toISOString().slice(0, 10) !== "2026-04-13" ||
    JSON.stringify(canonicalEntries(correctVat.journalEntries)) !==
      JSON.stringify([
        [2650, 239, 0],
        [2012, 0, 239],
      ])
  ) {
    throw new Error("A238 saknas eller har ändrats");
  }

  const excludedIds = new Set(
    [
      wrongVat,
      legacyReclassification,
      ...corrections,
    ]
      .filter(Boolean)
      .map((verification) => String(verification?._id))
  );
  const originals = all.filter(
    (verification) =>
      !excludedIds.has(String(verification._id)) &&
      verification.journalEntries?.some((entry) => Number(entry.account) === 2050)
  );
  const transformations = originals.map(transformVerification);
  const transformCounts = transformations.reduce(
    (counts, transformation) => {
      counts[transformation.kind] += 1;
      return counts;
    },
    { interest: 0, tax: 0, deposit: 0, vat: 0 } as Record<TransformKind, number>
  );
  if (JSON.stringify(transformCounts) !== JSON.stringify(EXPECTED_TRANSFORM_COUNTS)) {
    throw new Error(`Oväntade händelsetyper: ${JSON.stringify(transformCounts)}`);
  }

  const updatedVat: Verification = {
    ...correctVat,
    files: filesWithSource(correctVat, wrongVat),
    metadata: [
      ...migrationMetadata(correctVat),
      {
        _id: new mongoose.Types.ObjectId(),
        key: "absorbedVerification",
        value: "A229",
      },
    ],
  };
  const transformedById = new Map(
    transformations.map(({ document }) => [String(document._id), document])
  );
  const projected = all
    .filter((verification) => !excludedIds.has(String(verification._id)))
    .map((verification) =>
      String(verification._id) === String(correctVat._id)
        ? updatedVat
        : transformedById.get(String(verification._id)) ?? verification
    );
  assertFinalState(projected);

  const currentMax = Math.max(
    ...all.map((verification) => Number(verification.verificationNumber))
  );
  const counterDocuments = await counters.find({}).toArray();
  if (counterDocuments.length !== 1) {
    throw new Error(`Förväntade en verifikationsräknare, fick ${counterDocuments.length}`);
  }
  const counter = counterDocuments[0];
  if (Number(counter?.sequence) !== currentMax) {
    throw new Error(
      `Verifikationsräknaren ${counter?.sequence} matchar inte maxnumret ${currentMax}`
    );
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        target,
        databaseName,
        updateOriginals: transformations.length,
        transformCounts,
        removeCorrectionNumbers: corrections.map(
          (verification) => verification.verificationNumber
        ),
        removeWrongVat: wrongVat.verificationNumber,
        removeTemporaryReclassification:
          legacyReclassification?.verificationNumber ?? null,
        moveFilesFrom: wrongVat.verificationNumber,
        moveFilesTo: correctVat.verificationNumber,
        projectedVerificationCount: projected.length,
        projectedAccount2050Rows: 0,
        projectedBalances: trackedBalances(projected),
      },
      null,
      2
    )
  );
  if (!apply) return;

  const session = mongoose.connection.getClient().startSession();
  try {
    await session.withTransaction(async () => {
      for (const { document } of transformations) {
        const result = await collection.updateOne(
          {
            _id: document._id,
            "journalEntries.account": 2050,
          },
          {
            $set: {
              journalEntries: document.journalEntries,
              metadata: document.metadata,
            },
          },
          { session }
        );
        if (result.matchedCount !== 1) {
          throw new Error(`A${document.verificationNumber} kunde inte uppdateras`);
        }
      }

      const vatUpdate = await collection.updateOne(
        { _id: correctVat._id },
        {
          $set: {
            files: updatedVat.files,
            metadata: updatedVat.metadata,
          },
        },
        { session }
      );
      if (vatUpdate.matchedCount !== 1) throw new Error("A238 kunde inte uppdateras");

      const deletionIds = [
        wrongVat._id,
        ...(legacyReclassification ? [legacyReclassification._id] : []),
        ...corrections.map((verification) => verification._id),
      ];
      const deletion = await collection.deleteMany(
        { _id: { $in: deletionIds } },
        { session }
      );
      if (deletion.deletedCount !== deletionIds.length) {
        throw new Error("Alla överflödiga verifikationer kunde inte tas bort");
      }

      const latest = await collection
        .find({}, { session })
        .sort({ verificationNumber: -1 })
        .limit(1)
        .next();
      if (!latest) throw new Error("Senaste verifikation saknas");
      await counters.updateOne(
        { _id: counter._id },
        { $set: { sequence: Number(latest.verificationNumber) } },
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  const after = await collection
    .find({})
    .sort({ verificationDate: 1, verificationNumber: 1 })
    .toArray();
  assertFinalState(after);
  if (
    after.length !== projected.length ||
    after.some((verification) =>
      [229, 231, 232, 233, 235, 236, 237, 239].includes(
        verification.verificationNumber
      )
    )
  ) {
    throw new Error("Efterkontrollen av borttagna verifikationer misslyckades");
  }
  const afterCounter = await counters.findOne({ _id: counter._id });
  const afterMax = Math.max(
    ...after.map((verification) => Number(verification.verificationNumber))
  );
  if (Number(afterCounter?.sequence) !== afterMax) {
    throw new Error("Verifikationsräknaren är fel efter migreringen");
  }
  console.log(
    JSON.stringify(
      {
        saved: true,
        verificationCount: after.length,
        account2050Rows: 0,
        counterSequence: afterCounter?.sequence,
        balances: trackedBalances(after),
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
