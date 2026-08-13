/* global URL, console, process */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { EJSON } from "bson";
import { MongoClient } from "mongodb";

const DOMAIN = "moaclayco";
const SOURCE_DATABASE = "storm";
const TARGET_DATABASE = "storm-stage";
const SOURCE_BUCKET = "moaclayco-prod";
const SCOPED_COLLECTIONS = [
  "collections",
  "discounts",
  "items",
  "orders",
  "verificationCounters",
  "verifications",
];

const apply = process.argv.includes("--apply");
const verifyOnly = process.argv.includes("--verify");
if (apply && verifyOnly) throw new Error("Välj antingen --apply eller --verify");
const production = parseEnv(readFileSync(".env.production.local", "utf8"));
const stage = parseEnv(readFileSync(".env.stage.local", "utf8"));

const required = (environment, key) => {
  const value = environment[key];
  if (!value) throw new Error(`${key} saknas`);
  return value;
};

const sourceUrl = required(production, "MONGODB_URL");
const targetUrl = required(stage, "MONGODB_URL");
const sourceParsed = new URL(sourceUrl);
const targetParsed = new URL(targetUrl);
const sourceDatabase = sourceParsed.pathname.replace(/^\//, "");
const targetDatabase = targetParsed.pathname.replace(/^\//, "");
const targetBucket = required(stage, "AWS_S3_BUCKET_NAME");
const sourceRegion = required(production, "AWS_REGION");
const region = required(stage, "AWS_REGION");

if (sourceDatabase !== SOURCE_DATABASE) {
  throw new Error(`Källdatabasen måste vara ${SOURCE_DATABASE}, fick ${sourceDatabase}`);
}
if (targetDatabase !== TARGET_DATABASE) {
  throw new Error(`Måldatabasen måste vara ${TARGET_DATABASE}, fick ${targetDatabase}`);
}
if (sourceParsed.host !== targetParsed.host) {
  throw new Error("Källa och mål måste ligga i det verifierade Atlas-klustret");
}
if (targetBucket !== "moaclayco-stage") {
  throw new Error(`Mål-bucket måste vara moaclayco-stage, fick ${targetBucket}`);
}

const credentialsFor = (environment) => ({
  accessKeyId: required(environment, "AWS_ACCESS_KEY_ID"),
  secretAccessKey: required(environment, "AWS_SECRET_ACCESS_KEY"),
  ...(environment.AWS_SESSION_TOKEN
    ? { sessionToken: environment.AWS_SESSION_TOKEN }
    : {}),
});

const sourceS3 = new S3Client({
  region: sourceRegion,
  credentials: credentialsFor(production),
});
const targetS3 = new S3Client({
  region,
  credentials: credentialsFor(stage),
});

const sourcePrefixToTarget = new Map([
  ["items", required(stage, "AWS_ITEM_PATH")],
  ["collections", required(stage, "AWS_COLLECTION_PATH")],
  ["verifications", required(stage, "AWS_VERIFICATIONS_PATH")],
]);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    if (typeof value.toHexString === "function") return value.toHexString();
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
};

const documentsHash = (documents) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        documents
          .map((document) =>
            canonicalize(
              JSON.parse(EJSON.stringify(document, { relaxed: false }))
            )
          )
          .sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right))
          )
      )
    )
    .digest("hex");

const assetCopies = new Map();

const mapAssetUrl = (rawValue, field) => {
  if (!rawValue) return rawValue;
  const source = new URL(rawValue);
  const sourceKey = decodeURIComponent(source.pathname.replace(/^\/+/, ""));
  const [sourcePrefix, ...suffix] = sourceKey.split("/");
  const targetPrefix = sourcePrefixToTarget.get(sourcePrefix);
  if (!targetPrefix || suffix.length === 0) {
    throw new Error(`Oväntad production-path i ${field}: ${sourcePrefix}`);
  }
  if (
    field === "verifications.files.path" &&
    source.host !== `${SOURCE_BUCKET}.s3.${sourceRegion}.amazonaws.com`
  ) {
    throw new Error(`Oväntad production-host i ${field}: ${source.host}`);
  }
  if (
    field !== "verifications.files.path" &&
    source.host !== "38vabcm3.twic.pics"
  ) {
    throw new Error(`Oväntad bild-host i ${field}: ${source.host}`);
  }

  const targetKey = [targetPrefix.replace(/^\/+|\/+$/g, ""), ...suffix].join(
    "/"
  );
  const existing = assetCopies.get(targetKey);
  if (existing && existing.sourceKey !== sourceKey) {
    throw new Error(`Två production-objekt mappar till samma stage-nyckel: ${targetKey}`);
  }
  assetCopies.set(targetKey, { sourceKey, targetKey });

  if (field === "verifications.files.path") {
    const target = new URL(
      `https://${targetBucket}.s3.${region}.amazonaws.com`
    );
    target.pathname = `/${targetKey}`;
    return target.toString();
  }
  source.pathname = `/${targetKey}`;
  return source.toString();
};

const transformDocuments = (collectionName, documents) =>
  documents.map((document) => {
    if (document.domain !== DOMAIN) {
      throw new Error(`${collectionName} innehåller dokument utanför ${DOMAIN}`);
    }
    const transformed = { ...document };
    if (collectionName === "collections") {
      transformed.image = mapAssetUrl(
        transformed.image,
        "collections.image"
      );
    }
    if (collectionName === "items") {
      transformed.images = (transformed.images ?? []).map((image) =>
        mapAssetUrl(image, "items.images")
      );
    }
    if (collectionName === "orders") {
      transformed.items = (transformed.items ?? []).map((item) => ({
        ...item,
        image: mapAssetUrl(item.image, "orders.items.image"),
      }));
    }
    if (collectionName === "verifications") {
      transformed.files = (transformed.files ?? []).map((file) => ({
        ...file,
        path: mapAssetUrl(file.path, "verifications.files.path"),
      }));
    }
    return transformed;
  });

const isMissing = (error) =>
  error?.name === "NotFound" ||
  error?.name === "NoSuchKey" ||
  error?.$metadata?.httpStatusCode === 404;

const headOrNull = async (client, bucket, key) => {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
};

const ensureAsset = async ({ sourceKey, targetKey }) => {
  const sourceHead = await headOrNull(sourceS3, SOURCE_BUCKET, sourceKey);
  const targetHead = await headOrNull(targetS3, targetBucket, targetKey);
  if (!sourceHead) {
    if (targetHead) return "target-only";
    throw new Error(
      `Objektet saknas i både production och stage: ${sourceKey}`
    );
  }
  if (
    targetHead &&
    targetHead.ContentLength === sourceHead.ContentLength &&
    targetHead.ETag === sourceHead.ETag
  ) {
    return "unchanged";
  }
  if (!apply) return targetHead ? "would-update" : "would-copy";

  const sourceObject = await sourceS3.send(
    new GetObjectCommand({ Bucket: SOURCE_BUCKET, Key: sourceKey })
  );
  if (!sourceObject.Body) throw new Error(`Production-objekt saknar innehåll: ${sourceKey}`);
  await targetS3.send(
    new PutObjectCommand({
      Bucket: targetBucket,
      Key: targetKey,
      Body: sourceObject.Body,
      ContentLength: sourceObject.ContentLength,
      ContentType: sourceObject.ContentType,
      CacheControl: sourceObject.CacheControl,
      ContentDisposition: sourceObject.ContentDisposition,
      ContentEncoding: sourceObject.ContentEncoding,
      ContentLanguage: sourceObject.ContentLanguage,
      Metadata: sourceObject.Metadata,
    })
  );
  const verified = await headOrNull(targetS3, targetBucket, targetKey);
  if (!verified || verified.ContentLength !== sourceHead.ContentLength) {
    throw new Error(`Stage-objekt kunde inte verifieras: ${targetKey}`);
  }
  return targetHead ? "updated" : "copied";
};

const mapWithConcurrency = async (values, concurrency, worker) => {
  const results = new Array(values.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await worker(values[index]);
    }
  });
  await Promise.all(runners);
  return results;
};

const sourceClient = new MongoClient(sourceUrl, { serverSelectionTimeoutMS: 15_000 });
const targetClient = new MongoClient(targetUrl, { serverSelectionTimeoutMS: 15_000 });

await Promise.all([sourceClient.connect(), targetClient.connect()]);

try {
  const sourceDb = sourceClient.db(sourceDatabase);
  const targetDb = targetClient.db(targetDatabase);
  const sourceDocuments = new Map();
  const transformedDocuments = new Map();
  const targetSgwoodsBefore = new Map();

  for (const collectionName of SCOPED_COLLECTIONS) {
    const documents = await sourceDb
      .collection(collectionName)
      .find({ domain: DOMAIN })
      .toArray();
    sourceDocuments.set(collectionName, documents);
    transformedDocuments.set(
      collectionName,
      transformDocuments(collectionName, documents)
    );
    const sgwoods = await targetDb
      .collection(collectionName)
      .find({ domain: "sgwoods" })
      .toArray();
    targetSgwoodsBefore.set(collectionName, {
      count: sgwoods.length,
      hash: documentsHash(sgwoods),
    });
  }

  const assetResults = await mapWithConcurrency(
    Array.from(assetCopies.values()),
    10,
    ensureAsset
  );
  const assetSummary = Object.fromEntries(
    Array.from(new Set(assetResults)).map((status) => [
      status,
      assetResults.filter((value) => value === status).length,
    ])
  );

  const planned = Object.fromEntries(
    SCOPED_COLLECTIONS.map((collectionName) => [
      collectionName,
      transformedDocuments.get(collectionName).length,
    ])
  );
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : verifyOnly ? "verify" : "dry-run",
        sourceDatabase,
        targetDatabase,
        domain: DOMAIN,
        plannedDocuments: planned,
        referencedAssets: assetCopies.size,
        assetSummary,
        untouchedCollections: ["users", "webhookEvents"],
      },
      null,
      2
    )
  );

  if (apply) {
    const session = targetClient.startSession();
    try {
      await session.withTransaction(
        async () => {
          for (const collectionName of SCOPED_COLLECTIONS) {
            const collection = targetDb.collection(collectionName);
            await collection.deleteMany({ domain: DOMAIN }, { session });
            const documents = transformedDocuments.get(collectionName);
            if (documents.length) await collection.insertMany(documents, { session });
          }
        },
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
        }
      );
    } finally {
      await session.endSession();
    }

  }

  if (apply || verifyOnly) {
    const verification = {};
    for (const collectionName of SCOPED_COLLECTIONS) {
      const actual = await targetDb
        .collection(collectionName)
        .find({ domain: DOMAIN })
        .toArray();
      const expected = transformedDocuments.get(collectionName);
      const expectedHash = documentsHash(expected);
      const actualHash = documentsHash(actual);
      if (actual.length !== expected.length || actualHash !== expectedHash) {
        throw new Error(`Verifieringen misslyckades för ${collectionName}`);
      }

      const sgwoods = await targetDb
        .collection(collectionName)
        .find({ domain: "sgwoods" })
        .toArray();
      const sgwoodsBefore = targetSgwoodsBefore.get(collectionName);
      if (
        sgwoods.length !== sgwoodsBefore.count ||
        documentsHash(sgwoods) !== sgwoodsBefore.hash
      ) {
        throw new Error(`SGWoods ändrades oväntat i ${collectionName}`);
      }
      verification[collectionName] = actual.length;
    }

    console.log(
      JSON.stringify(
        {
          copiedDocuments: verification,
          verifiedDomain: DOMAIN,
          sgwoods: "unchanged",
          stageAssets: "verified",
        },
        null,
        2
      )
    );
  }
} finally {
  await Promise.all([sourceClient.close(), targetClient.close()]);
  sourceS3.destroy();
  targetS3.destroy();
}
