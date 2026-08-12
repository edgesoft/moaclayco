import mongoose from "mongoose";

const DOMAIN = "moaclayco";
const shouldApply = process.argv.includes("--apply");
const confirmed = process.argv.includes("--confirm-production-write");

if (shouldApply && !confirmed) {
  throw new Error("--apply kräver --confirm-production-write");
}
if (!process.env.MONGODB_URL) throw new Error("MONGODB_URL saknas");

const entry = (account, debit = 0, credit = 0) => ({ account, debit, credit });
const correction = ({
  key,
  date,
  description,
  journalEntries,
  correctionFor,
  reason = "Avstämning mot Skatteverkets skattekontoutdrag 2026-01-01–2026-04-18",
}) => ({
  idempotencyKey: key,
  verificationDate: new Date(`${date}T12:00:00.000Z`),
  description,
  journalEntries,
  metadata: [
    ...(correctionFor
      ? [{ key: "correctionFor", value: String(correctionFor) }]
      : []),
    {
      key: "correctionReason",
      value: reason,
    },
  ],
});

const currentStatementReason =
  "Komplettering från Skatteverkets skattekontoutdrag 2026-01-01–2026-08-10";

const plan = [
  correction({
    key: "correction:2026:a223:tax-interest",
    date: "2026-02-01",
    description: "Rättelse av A223 – intäktsränta på skattekontot",
    correctionFor: 223,
    journalEntries: [entry(2050, 1), entry(8314, 0, 1)],
  }),
  correction({
    key: "correction:2026:a224:preliminary-tax",
    date: "2026-02-12",
    description: "Rättelse av A224 – debiterad preliminärskatt",
    correctionFor: 224,
    journalEntries: [entry(2013, 399), entry(2050, 0, 399)],
  }),
  correction({
    key: "correction:2026:a226:separate-tax-events",
    date: "2026-03-06",
    description: "Rättelse av A226 – separerade skattekontohändelser",
    correctionFor: 226,
    journalEntries: [
      entry(2050, 239),
      entry(2012, 399),
      entry(2650, 0, 239),
      entry(2018, 0, 399),
    ],
  }),
  correction({
    key: "tax-account:2026-03-12:preliminary-tax:399",
    date: "2026-03-12",
    description: "Debiterad preliminärskatt",
    journalEntries: [entry(2013, 399), entry(2012, 0, 399)],
  }),
  correction({
    key: "correction:2026:a227:tax-interest",
    date: "2026-04-04",
    description: "Rättelse av A227 – intäktsränta på skattekontot",
    correctionFor: 227,
    journalEntries: [entry(2050, 1), entry(8314, 0, 1)],
  }),
  correction({
    key: "correction:2026:a228:preliminary-tax",
    date: "2026-04-13",
    description: "Rättelse av A228 – debiterad preliminärskatt",
    correctionFor: 228,
    journalEntries: [entry(2013, 399), entry(2050, 0, 399)],
  }),
  correction({
    key: "correction:2026:a229:reverse-wrong-date",
    date: "2026-04-19",
    description: "Återföring av A229 – fel datum och sammanblandade händelser",
    correctionFor: 229,
    journalEntries: [
      entry(2012, 239),
      entry(2050, 239),
      entry(2650, 0, 239),
      entry(2018, 0, 239),
    ],
  }),
  correction({
    key: "tax-account:2026-04-13:vat:2026-02",
    date: "2026-04-13",
    description: "Moms Februari 2026 debiterad på skattekontot",
    journalEntries: [entry(2650, 239), entry(2012, 0, 239)],
  }),
  correction({
    key: "tax-account:2026-04-20:deposit:399",
    date: "2026-04-20",
    description: "Inbetalning till skattekontot",
    journalEntries: [entry(2012, 399), entry(2018, 0, 399)],
    reason: currentStatementReason,
  }),
  correction({
    key: "tax-account:2026-04-20:deposit:3235",
    date: "2026-04-20",
    description: "Inbetalning till skattekontot",
    journalEntries: [entry(2012, 3_235), entry(2018, 0, 3_235)],
    reason: currentStatementReason,
  }),
  correction({
    key: "tax-account:2026-05-02:interest:2",
    date: "2026-05-02",
    description: "Intäktsränta på skattekontot",
    journalEntries: [entry(2012, 2), entry(8314, 0, 2)],
    reason: currentStatementReason,
  }),
  correction({
    key: "tax-account:2026-05-12:preliminary-tax:399",
    date: "2026-05-12",
    description: "Debiterad preliminärskatt",
    journalEntries: [entry(2013, 399), entry(2012, 0, 399)],
    reason: currentStatementReason,
  }),
  correction({
    key: "tax-account:2026-06-06:interest:4",
    date: "2026-06-06",
    description: "Intäktsränta på skattekontot",
    journalEntries: [entry(2012, 4), entry(8314, 0, 4)],
    reason: currentStatementReason,
  }),
  correction({
    key: "tax-account:2026-06-12:preliminary-tax:399",
    date: "2026-06-12",
    description: "Debiterad preliminärskatt",
    journalEntries: [entry(2013, 399), entry(2012, 0, 399)],
    reason: currentStatementReason,
  }),
  correction({
    key: "tax-account:2026-06-27:deposit:366:1",
    date: "2026-06-27",
    description: "Inbetalning till skattekontot",
    journalEntries: [entry(2012, 366), entry(2018, 0, 366)],
    reason: currentStatementReason,
  }),
  correction({
    key: "tax-account:2026-06-27:deposit:366:2",
    date: "2026-06-27",
    description: "Inbetalning till skattekontot",
    journalEntries: [entry(2012, 366), entry(2018, 0, 366)],
    reason: currentStatementReason,
  }),
  correction({
    key: "tax-account:2026-07-04:interest:3",
    date: "2026-07-04",
    description: "Intäktsränta på skattekontot",
    journalEntries: [entry(2012, 3), entry(8314, 0, 3)],
    reason: currentStatementReason,
  }),
  correction({
    key: "tax-account:2026-07-13:preliminary-tax:399",
    date: "2026-07-13",
    description: "Debiterad preliminärskatt",
    journalEntries: [entry(2013, 399), entry(2012, 0, 399)],
    reason: currentStatementReason,
  }),
  correction({
    key: "tax-account:2026-08-01:interest:3",
    date: "2026-08-01",
    description: "Intäktsränta på skattekontot",
    journalEntries: [entry(2012, 3), entry(8314, 0, 3)],
    reason: currentStatementReason,
  }),
];

const expectedSources = new Map([
  [223, { date: "2026-02-01", entries: [[2012, 1, 0], [2050, 0, 1]] }],
  [224, { date: "2026-02-12", entries: [[2012, 0, 399], [2050, 399, 0]] }],
  [226, { date: "2026-03-06", entries: [[2650, 239, 0], [2050, 0, 239], [2012, 239, 0], [2018, 0, 239]] }],
  [227, { date: "2026-04-04", entries: [[2012, 1, 0], [2050, 0, 1]] }],
  [228, { date: "2026-04-13", entries: [[2012, 0, 399], [2050, 399, 0]] }],
  [229, { date: "2026-04-19", entries: [[2650, 239, 0], [2012, 0, 239], [2018, 239, 0], [2050, 0, 239]] }],
]);

const normalizedRows = (rows) =>
  rows.map((row) => [Number(row.account), Number(row.debit || 0), Number(row.credit || 0)]);

const totalsFor = (documents) => {
  const totals = new Map();
  for (const document of documents) {
    for (const row of document.journalEntries ?? []) {
      totals.set(
        Number(row.account),
        (totals.get(Number(row.account)) ?? 0) +
          Number(row.debit || 0) -
          Number(row.credit || 0)
      );
    }
  }
  return totals;
};

await mongoose.connect(process.env.MONGODB_URL, { serverSelectionTimeoutMS: 10_000 });
const db = mongoose.connection.db;
const verifications = db.collection("verifications");
const counters = db.collection("verificationCounters");

try {
  const sourceDocuments = await verifications
    .find({ domain: DOMAIN, verificationNumber: { $in: [...expectedSources.keys()] } })
    .sort({ verificationNumber: 1 })
    .toArray();

  const sourceProblems = [];
  for (const [number, expected] of expectedSources) {
    const actual = sourceDocuments.find((document) => document.verificationNumber === number);
    if (!actual) {
      sourceProblems.push(`A${number} saknas`);
      continue;
    }
    if (actual.verificationDate.toISOString().slice(0, 10) !== expected.date) {
      sourceProblems.push(`A${number} har oväntat datum`);
    }
    if (JSON.stringify(normalizedRows(actual.journalEntries)) !== JSON.stringify(expected.entries)) {
      sourceProblems.push(`A${number} har oväntad kontering`);
    }
  }
  if (sourceProblems.length) {
    throw new Error(`Källdata avviker; inga rättelser får köras: ${sourceProblems.join(", ")}`);
  }

  const existingCorrections = await verifications
    .find({ domain: DOMAIN, idempotencyKey: { $in: plan.map((item) => item.idempotencyKey) } })
    .project({ idempotencyKey: 1, verificationNumber: 1 })
    .toArray();
  const pending = plan.filter(
    (item) => !existingCorrections.some((document) => document.idempotencyKey === item.idempotencyKey)
  );

  const yearDocuments = await verifications
    .find({
      domain: DOMAIN,
      verificationDate: {
        $gte: new Date("2026-01-01T00:00:00.000Z"),
        $lt: new Date("2026-08-11T00:00:00.000Z"),
      },
    })
    .toArray();
  const projectedTotals = totalsFor([...yearDocuments, ...pending]);
  const checks = {
    taxAccount2012: projectedTotals.get(2012) ?? 0,
    legacy2050: projectedTotals.get(2050) ?? 0,
    vatLiability2650: projectedTotals.get(2650) ?? 0,
    ownTaxWithdrawals2013: projectedTotals.get(2013) ?? 0,
    taxFreeInterest8314: projectedTotals.get(8314) ?? 0,
  };
  const expectedChecks = {
    taxAccount2012: 3_354,
    legacy2050: 0,
    vatLiability2650: -42,
    ownTaxWithdrawals2013: 2_394,
    taxFreeInterest8314: -14,
  };
  if (JSON.stringify(checks) !== JSON.stringify(expectedChecks)) {
    throw new Error(`Projektionskontrollen misslyckades: ${JSON.stringify(checks)}`);
  }

  console.log(
    JSON.stringify(
      {
        mode: shouldApply ? "apply" : "dry-run",
        alreadyApplied: existingCorrections.map((item) => ({
          idempotencyKey: item.idempotencyKey,
          verificationNumber: item.verificationNumber,
        })),
        pending: pending.map((item) => ({
          idempotencyKey: item.idempotencyKey,
          date: item.verificationDate.toISOString().slice(0, 10),
          description: item.description,
          journalEntries: item.journalEntries,
        })),
        projectedChecks: checks,
      },
      null,
      2
    )
  );

  if (!shouldApply || pending.length === 0) process.exitCode = 0;
  else {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const latest = await verifications
          .find({ domain: DOMAIN }, { session })
          .sort({ verificationNumber: -1 })
          .limit(1)
          .next();
        await counters.updateOne(
          { domain: DOMAIN },
          {
            $max: { sequence: Number(latest?.verificationNumber ?? 0) },
            $setOnInsert: { domain: DOMAIN },
          },
          { upsert: true, session }
        );

        for (const item of pending) {
          const counterResult = await counters.findOneAndUpdate(
            { domain: DOMAIN },
            { $inc: { sequence: 1 } },
            { returnDocument: "after", session }
          );
          // MongoDB-drivrutinen som följer Mongoose 6 returnerar ett ModifyResult
          // med dokumentet i `value`; nyare drivrutiner returnerar dokumentet direkt.
          const counter = counterResult?.value ?? counterResult;
          const verificationNumber = Number(counter?.sequence);
          if (!Number.isInteger(verificationNumber) || verificationNumber < 1) {
            throw new Error("Kunde inte tilldela verifikationsnummer");
          }
          await verifications.insertOne(
            {
              _id: new mongoose.Types.ObjectId(),
              domain: DOMAIN,
              recordType: "journal",
              verificationNumber,
              idempotencyKey: item.idempotencyKey,
              description: item.description,
              verificationDate: item.verificationDate,
              journalEntries: item.journalEntries.map((row) => ({
                ...row,
                _id: new mongoose.Types.ObjectId(),
              })),
              metadata: item.metadata.map((value) => ({
                ...value,
                _id: new mongoose.Types.ObjectId(),
              })),
              files: [],
            },
            { session }
          );
        }
      });
    } finally {
      await session.endSession();
    }
    console.log(`Skapade ${pending.length} spårbara rättelseverifikationer.`);
  }
} finally {
  await mongoose.disconnect();
}
