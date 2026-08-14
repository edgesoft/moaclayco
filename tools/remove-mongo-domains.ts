import mongoose, { type ClientSession } from "mongoose";
import { connectToDatabase } from "../app/services/database.server";

const STORE_ID = "moaclayco";
const DATABASES = {
  production: "storm",
  stage: "storm-stage",
} as const;

type Target = keyof typeof DATABASES;
type IndexSpec = {
  key: Record<string, 1 | -1>;
  name: string;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: Record<string, unknown>;
};

const collections: Array<{ name: string; indexes: IndexSpec[] }> = [
  {
    name: "accountingYears",
    indexes: [{ key: { year: 1 }, name: "year_1", unique: true }],
  },
  {
    name: "collections",
    indexes: [
      { key: { shortUrl: 1 }, name: "shortUrl_1", unique: true },
      { key: { sortOrder: 1 }, name: "sortOrder_1" },
    ],
  },
  {
    name: "discounts",
    indexes: [{ key: { code: 1 }, name: "code_1", unique: true }],
  },
  {
    name: "items",
    indexes: [
      {
        key: { collectionRef: 1, _id: -1 },
        name: "collectionRef_1__id_-1",
      },
    ],
  },
  {
    name: "orders",
    indexes: [
      {
        key: { checkoutToken: 1 },
        name: "checkoutToken_1",
        unique: true,
        partialFilterExpression: { checkoutToken: { $type: "string" } },
      },
      {
        key: { status: 1, createdAt: -1 },
        name: "status_1_createdAt_-1",
      },
      {
        key: { createdAt: -1, _id: -1 },
        name: "createdAt_-1__id_-1",
      },
    ],
  },
  {
    name: "verificationCounters",
    indexes: [{ key: { key: 1 }, name: "key_1", unique: true }],
  },
  {
    name: "verifications",
    indexes: [
      {
        key: { verificationNumber: 1 },
        name: "verificationNumber_1",
        unique: true,
      },
      {
        key: { idempotencyKey: 1 },
        name: "idempotencyKey_1",
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: "string" } },
      },
      {
        key: { verificationDate: 1, verificationNumber: 1 },
        name: "verificationDate_1_verificationNumber_1",
      },
      {
        key: { recordType: 1, verificationDate: 1 },
        name: "recordType_1_verificationDate_1",
      },
      {
        key: { "metadata.key": 1, "metadata.value": 1 },
        name: "metadata.key_1_metadata.value_1",
      },
      {
        key: { "metadata.key": 1, verificationDate: 1 },
        name: "metadata.key_1_verificationDate_1",
      },
    ],
  },
];

const redundantIndexes: Record<string, string[]> = {
  collections: ["collectionRef_1"],
  items: ["collectionRef_1"],
  verifications: ["verificationDate_1"],
};

const readArgument = (name: string) =>
  process.argv
    .find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  }
  return value;
};

const sameValue = (left: unknown, right: unknown) =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

const hasExpectedOptions = (
  index: {
    unique?: boolean;
    sparse?: boolean;
    partialFilterExpression?: unknown;
  },
  desired: IndexSpec
) =>
  Boolean(index.unique) === Boolean(desired.unique) &&
  Boolean(index.sparse) === Boolean(desired.sparse) &&
  sameValue(
    index.partialFilterExpression,
    desired.partialFilterExpression
  );

const readIndexes = async (collectionName: string) => {
  const database = mongoose.connection.db;
  if (!database) throw new Error("Databasanslutningen saknas");
  try {
    return await database.collection(collectionName).indexes();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 26
    ) {
      return [];
    }
    throw error;
  }
};

const duplicateValues = async (
  collectionName: string,
  field: string,
  match: Record<string, unknown> = {}
) => {
  const database = mongoose.connection.db;
  if (!database) throw new Error("Databasanslutningen saknas");
  return database
    .collection(collectionName)
    .aggregate([
      { $match: match },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 10 },
    ])
    .toArray();
};

const assertNoGlobalKeyCollisions = async () => {
  const checks = [
    ["accountingYears", "year"],
    ["collections", "shortUrl"],
    ["discounts", "code"],
    ["orders", "checkoutToken", { checkoutToken: { $type: "string" } }],
    ["verifications", "verificationNumber"],
    [
      "verifications",
      "idempotencyKey",
      { idempotencyKey: { $type: "string" } },
    ],
  ] as const;

  for (const [collectionName, field, match] of checks) {
    const duplicates = await duplicateValues(collectionName, field, match);
    if (duplicates.length) {
      throw new Error(
        `${collectionName}.${field} har globala dubletter: ${duplicates
          .map((entry) => `${String(entry._id)} (${entry.count})`)
          .join(", ")}`
      );
    }
  }
};

const ensureIndexes = async () => {
  const database = mongoose.connection.db;
  if (!database) throw new Error("Databasanslutningen saknas");

  for (const definition of collections) {
    const collection = database.collection(definition.name);
    const existing = await readIndexes(definition.name);
    for (const desired of definition.indexes) {
      const equivalent = existing.find((index) => sameValue(index.key, desired.key));
      if (equivalent) {
        if (
          Boolean(equivalent.sparse) !== Boolean(desired.sparse) ||
          !sameValue(
            equivalent.partialFilterExpression,
            desired.partialFilterExpression
          )
        ) {
          throw new Error(
            `${definition.name}.${equivalent.name} har oväntade indexalternativ`
          );
        }
        if (Boolean(equivalent.unique) !== Boolean(desired.unique)) {
          if (!desired.unique || !equivalent.name) {
            throw new Error(
              `${definition.name}.${equivalent.name} har oväntad unikhet`
            );
          }
          // Atlas' application user cannot use collMod. The global collision
          // preflight has already passed, and the old domain-prefixed unique
          // index remains available until all replacements are complete.
          await collection.dropIndex(equivalent.name);
          try {
            await collection.createIndex(desired.key, desired);
          } catch (error) {
            await collection.createIndex(desired.key, {
              name: equivalent.name,
              ...(equivalent.sparse ? { sparse: true } : {}),
              ...(equivalent.partialFilterExpression
                ? {
                    partialFilterExpression:
                      equivalent.partialFilterExpression,
                  }
                : {}),
            });
            throw error;
          }
        }
        continue;
      }
      await collection.createIndex(desired.key, desired);
    }
  }
};

const normalizeVerificationCounter = async (session: ClientSession) => {
  const database = mongoose.connection.db;
  if (!database) throw new Error("Databasanslutningen saknas");
  const counters = database.collection("verificationCounters");
  const verifications = database.collection("verifications");
  const counterDocuments = await counters.find({}, { session }).toArray();
  const latestVerification = await verifications
    .find({}, { session })
    .sort({ verificationNumber: -1 })
    .limit(1)
    .next();
  const sequence = Math.max(
    Number(latestVerification?.verificationNumber || 0),
    ...counterDocuments.map((counter) => Number(counter.sequence || 0)),
    0
  );
  const globalCounter = counterDocuments.find(
    (counter) => counter.key === "global"
  );
  const keeper = globalCounter ?? counterDocuments[0];

  if (keeper) {
    await counters.updateOne(
      { _id: keeper._id },
      { $set: { key: "global", sequence }, $unset: { domain: "" } },
      { session }
    );
    await counters.deleteMany({ _id: { $ne: keeper._id } }, { session });
    return;
  }
  await counters.insertOne({ key: "global", sequence }, { session });
};

const dropLegacyDomainIndexes = async () => {
  const database = mongoose.connection.db;
  if (!database) throw new Error("Databasanslutningen saknas");
  for (const definition of collections) {
    const collection = database.collection(definition.name);
    const indexes = await readIndexes(definition.name);
    for (const index of indexes) {
      if (
        index.name &&
        index.name !== "_id_" &&
        Object.hasOwn(index.key, "domain")
      ) {
        await collection.dropIndex(index.name);
      }
    }
    const remainingNames = new Set(
      (await readIndexes(definition.name))
        .map((index) => index.name)
        .filter((name): name is string => Boolean(name))
    );
    for (const indexName of redundantIndexes[definition.name] ?? []) {
      if (remainingNames.has(indexName)) {
        await collection.dropIndex(indexName);
      }
    }
  }
};

const audit = async () => {
  const database = mongoose.connection.db;
  if (!database) throw new Error("Databasanslutningen saknas");
  const summary: Record<
    string,
    {
      documents: number;
      domainFields: number;
      invalidGlobalIndexes: string[];
      legacyDomainIndexes: string[];
    }
  > = {};
  for (const definition of collections) {
    const collection = database.collection(definition.name);
    const [documents, domainFields, indexes] = await Promise.all([
      collection.countDocuments({}),
      collection.countDocuments({ domain: { $exists: true } }),
      readIndexes(definition.name),
    ]);
    summary[definition.name] = {
      documents,
      domainFields,
      invalidGlobalIndexes: definition.indexes
        .filter(
          (desired) =>
            !indexes.some(
              (index) =>
                sameValue(index.key, desired.key) &&
                hasExpectedOptions(index, desired)
            )
        )
        .map((index) => index.name),
      legacyDomainIndexes: indexes
        .filter((index) => Object.hasOwn(index.key, "domain"))
        .map((index) => index.name)
        .filter((name): name is string => Boolean(name)),
    };
  }
  return summary;
};

const run = async () => {
  const target = readArgument("--target") as Target | undefined;
  const apply = process.argv.includes("--apply");
  if (!target || !(target in DATABASES)) {
    throw new Error("Ange --target=stage eller --target=production");
  }
  if (
    target === "production" &&
    apply &&
    !process.argv.includes("--confirm-production=single-store")
  ) {
    throw new Error(
      "Production kräver --confirm-production=single-store efter lyckad deploy"
    );
  }

  await connectToDatabase();
  const database = mongoose.connection.db;
  if (!database) throw new Error("Databasanslutningen saknas");
  if (database.databaseName !== DATABASES[target]) {
    throw new Error(
      `${target} kräver ${DATABASES[target]}, fick ${database.databaseName}`
    );
  }

  for (const definition of collections) {
    const unexpected = await database.collection(definition.name).findOne({
      domain: { $exists: true, $ne: STORE_ID },
    });
    if (unexpected) {
      throw new Error(
        `${definition.name} innehåller en annan domain än ${STORE_ID}: ${String(
          unexpected.domain
        )}`
      );
    }
  }
  await assertNoGlobalKeyCollisions();
  const before = await audit();
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        target,
        database: database.databaseName,
        before,
      },
      null,
      2
    )
  );
  if (!apply) return;

  // Indexes are built before fields are removed, so the deployed single-store
  // queries remain indexed throughout the migration.
  await ensureIndexes();
  const session = mongoose.connection.getClient().startSession();
  try {
    await session.withTransaction(async () => {
      for (const definition of collections) {
        if (definition.name === "verificationCounters") continue;
        await database
          .collection(definition.name)
          .updateMany({}, { $unset: { domain: "" } }, { session });
      }
      await normalizeVerificationCounter(session);
    });
  } finally {
    await session.endSession();
  }
  await dropLegacyDomainIndexes();

  const after = await audit();
  const incomplete = Object.entries(after).filter(
    ([, result]) =>
      result.domainFields !== 0 ||
      result.invalidGlobalIndexes.length !== 0 ||
      result.legacyDomainIndexes.length !== 0
  );
  if (incomplete.length) {
    throw new Error(
      `Efterkontrollen misslyckades: ${incomplete
        .map(([name]) => name)
        .join(", ")}`
    );
  }
  const counter = await database
    .collection("verificationCounters")
    .find({})
    .toArray();
  if (counter.length !== 1 || counter[0].key !== "global") {
    throw new Error("Den globala verifikationsräknaren kunde inte verifieras");
  }
  console.log(JSON.stringify({ saved: true, after }, null, 2));
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
