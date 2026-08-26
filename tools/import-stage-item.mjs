/* global URL, console, process */

import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { EJSON, ObjectId } from "bson";
import { MongoClient } from "mongodb";

const SOURCE_DATABASE = "storm";
const TARGET_DATABASE = "storm-stage";
const SOURCE_BUCKET = "moaclayco-prod";
const TARGET_BUCKET = "moaclayco-stage";

const apply = process.argv.includes("--apply");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : "";
};
const itemId = argument("--id");
const headline = argument("--headline");
if (Boolean(itemId) === Boolean(headline)) {
  throw new Error("Ange exakt en av --id eller --headline");
}
if (itemId && !ObjectId.isValid(itemId)) throw new Error("Ogiltigt artikel-id");

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
const sourceRegion = required(production, "AWS_REGION");
const targetRegion = required(stage, "AWS_REGION");
const targetBucket = required(stage, "AWS_S3_BUCKET_NAME");
const targetItemPrefix = required(stage, "AWS_ITEM_PATH").replace(
  /^\/+|\/+$/g,
  ""
);

if (sourceDatabase !== SOURCE_DATABASE || targetDatabase !== TARGET_DATABASE) {
  throw new Error(
    `Importen kräver ${SOURCE_DATABASE} -> ${TARGET_DATABASE}, fick ${sourceDatabase} -> ${targetDatabase}`
  );
}
if (sourceParsed.host !== targetParsed.host) {
  throw new Error("Källa och mål måste ligga i samma verifierade Atlas-kluster");
}
if (targetBucket !== TARGET_BUCKET || targetItemPrefix !== "items-stage") {
  throw new Error(
    `Ogiltigt stage-mål: bucket ${targetBucket}, prefix ${targetItemPrefix}`
  );
}

const credentialsFor = (environment) => ({
  accessKeyId: required(environment, "AWS_ACCESS_KEY_ID"),
  secretAccessKey: required(environment, "AWS_SECRET_ACCESS_KEY"),
  ...(environment.AWS_SESSION_TOKEN
    ? { sessionToken: environment.AWS_SESSION_TOKEN }
    : {}),
});
const sourceS3 = new S3Client({
  credentials: credentialsFor(production),
  region: sourceRegion,
});
const targetS3 = new S3Client({
  credentials: credentialsFor(stage),
  region: targetRegion,
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

const mapImage = (rawValue) => {
  const url = new URL(rawValue);
  if (url.host !== "38vabcm3.twic.pics") {
    throw new Error(`Oväntad bild-host: ${url.host}`);
  }
  const sourceKey = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const [prefix, ...suffix] = sourceKey.split("/");
  if (prefix !== "items" || !suffix.length) {
    throw new Error(`Oväntad produktbilds-path: ${sourceKey}`);
  }
  const targetKey = [targetItemPrefix, ...suffix].join("/");
  url.pathname = `/${targetKey}`;
  return { sourceKey, targetKey, targetUrl: url.toString() };
};

const ensureImage = async ({ sourceKey, targetKey }) => {
  const sourceHead = await headOrNull(sourceS3, SOURCE_BUCKET, sourceKey);
  if (!sourceHead) throw new Error(`Storm-bilden saknas i S3: ${sourceKey}`);
  const targetHead = await headOrNull(targetS3, targetBucket, targetKey);
  const unchanged =
    targetHead &&
    targetHead.ContentLength === sourceHead.ContentLength &&
    targetHead.ETag === sourceHead.ETag;
  if (unchanged) return "unchanged";
  if (!apply) return targetHead ? "would-update" : "would-copy";

  const sourceObject = await sourceS3.send(
    new GetObjectCommand({ Bucket: SOURCE_BUCKET, Key: sourceKey })
  );
  if (!sourceObject.Body) throw new Error(`Storm-bilden saknar innehåll: ${sourceKey}`);
  await targetS3.send(
    new PutObjectCommand({
      Body: sourceObject.Body,
      Bucket: targetBucket,
      CacheControl: sourceObject.CacheControl,
      ContentDisposition: sourceObject.ContentDisposition,
      ContentEncoding: sourceObject.ContentEncoding,
      ContentLanguage: sourceObject.ContentLanguage,
      ContentLength: sourceObject.ContentLength,
      ContentType: sourceObject.ContentType,
      Key: targetKey,
      Metadata: sourceObject.Metadata,
    })
  );
  const verified = await headOrNull(targetS3, targetBucket, targetKey);
  if (!verified || verified.ContentLength !== sourceHead.ContentLength) {
    throw new Error(`Stage-bilden kunde inte verifieras: ${targetKey}`);
  }
  return targetHead ? "updated" : "copied";
};

const sourceClient = new MongoClient(sourceUrl, { serverSelectionTimeoutMS: 15_000 });
const targetClient = new MongoClient(targetUrl, { serverSelectionTimeoutMS: 15_000 });
await Promise.all([sourceClient.connect(), targetClient.connect()]);

try {
  const sourceItems = sourceClient.db(sourceDatabase).collection("items");
  const targetItems = targetClient.db(targetDatabase).collection("items");
  const query = itemId ? { _id: new ObjectId(itemId) } : { headline };
  const matches = await sourceItems.find(query).limit(2).toArray();
  if (matches.length !== 1) {
    throw new Error(
      matches.length ? "Flera Storm-artiklar matchar" : "Storm-artikeln hittades inte"
    );
  }

  const sourceItem = matches[0];
  const sourceImages = (sourceItem.images ?? []).filter(Boolean);
  if (!sourceImages.length) {
    throw new Error(`Storm-artikeln ${sourceItem.headline} saknar egna bilder`);
  }
  const mappedImages = sourceImages.map(mapImage);
  const imageStatuses = await Promise.all(mappedImages.map(ensureImage));
  const transformedItem = {
    ...sourceItem,
    images: mappedImages.map((image) => image.targetUrl),
  };
  const existing = await targetItems.findOne({ _id: sourceItem._id });

  console.log(
    JSON.stringify(
      {
        database: `${sourceDatabase} -> ${targetDatabase}`,
        existingStageImages: existing?.images ?? [],
        headline: sourceItem.headline,
        id: String(sourceItem._id),
        imageStatuses: mappedImages.map((image, index) => ({
          sourceKey: image.sourceKey,
          status: imageStatuses[index],
          targetKey: image.targetKey,
        })),
        mode: apply ? "apply" : "dry-run",
        targetImages: transformedItem.images,
      },
      null,
      2
    )
  );

  if (apply) {
    await targetItems.replaceOne(
      { _id: sourceItem._id },
      transformedItem,
      { upsert: true }
    );
    const verified = await targetItems.findOne({ _id: sourceItem._id });
    if (EJSON.stringify(verified) !== EJSON.stringify(transformedItem)) {
      throw new Error("Stage-artikeln matchar inte Storm efter importen");
    }
    console.log(
      JSON.stringify(
        {
          imported: String(sourceItem._id),
          stageAssets: "verified",
          stageDatabase: targetDatabase,
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
