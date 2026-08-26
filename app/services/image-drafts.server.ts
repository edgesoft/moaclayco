import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import type { ClientSession } from "mongoose";
import { ImageDrafts } from "~/schemas/image-drafts";
import { s3Client } from "~/services/s3.server";

export type ImageDraftKind = "collection" | "item" | "special-order";

export const IMAGE_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_RETRY_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 20;
const safeDraftIdPattern = /^[a-zA-Z0-9_-]{8,100}$/;

export class InvalidImageDraftError extends Error {
  constructor() {
    super("Image upload does not belong to this editor draft");
    this.name = "InvalidImageDraftError";
  }
}

type ImageDraftCleanupState = {
  lastStartedAt: number;
  pending?: Promise<void>;
};

const globalForImageDraftCleanup = globalThis as typeof globalThis & {
  __moaImageDraftCleanup?: ImageDraftCleanupState;
};

const cleanupState =
  globalForImageDraftCleanup.__moaImageDraftCleanup ??
  (globalForImageDraftCleanup.__moaImageDraftCleanup = {
    lastStartedAt: 0,
  });

export const isValidImageDraftId = (draftId: string) =>
  safeDraftIdPattern.test(draftId);

export async function registerImageDraft(input: {
  collectionRef?: string;
  draftId: string;
  key: string;
  kind: ImageDraftKind;
  url: string;
}) {
  if (!isValidImageDraftId(input.draftId)) throw new InvalidImageDraftError();
  await ImageDrafts.create({
    ...input,
    expiresAt: new Date(Date.now() + IMAGE_DRAFT_TTL_MS),
    status: "draft",
  });
}

export async function consumeImageDrafts(input: {
  collectionRef?: string;
  draftId: string;
  kind: ImageDraftKind;
  session: ClientSession;
  urls: string[];
}) {
  const urls = [...new Set(input.urls)];
  if (!urls.length) return;
  if (!isValidImageDraftId(input.draftId)) throw new InvalidImageDraftError();

  const result = await ImageDrafts.deleteMany(
    {
      ...(input.collectionRef ? { collectionRef: input.collectionRef } : {}),
      draftId: input.draftId,
      kind: input.kind,
      status: "draft",
      url: { $in: urls },
    },
    { session: input.session }
  );
  if (result.deletedCount !== urls.length) throw new InvalidImageDraftError();
}

async function removeDraftObject(key: string) {
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!bucket) throw new Error("S3 bucket is not configured");
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

async function deleteClaimedDraft(draft: {
  _id: unknown;
  key: string;
}) {
  try {
    await removeDraftObject(draft.key);
    await ImageDrafts.deleteOne({ _id: draft._id, status: "deleting" });
    return true;
  } catch (error) {
    await ImageDrafts.updateOne(
      { _id: draft._id, status: "deleting" },
      {
        $set: {
          expiresAt: new Date(Date.now() + CLEANUP_RETRY_MS),
          status: "draft",
        },
      }
    );
    throw error;
  }
}

export async function cleanupImageDraft(input: {
  draftId: string;
  url: string;
}) {
  if (!isValidImageDraftId(input.draftId)) return false;
  const draft = await ImageDrafts.findOneAndUpdate(
    {
      draftId: input.draftId,
      status: "draft",
      url: input.url,
    },
    { $set: { status: "deleting" } },
    { new: true }
  )
    .select("key")
    .lean<{ _id: unknown; key: string }>();
  if (!draft) return false;
  return deleteClaimedDraft(draft);
}

async function cleanupExpiredImageDrafts() {
  const expired = await ImageDrafts.find({
    expiresAt: { $lte: new Date() },
    status: "draft",
  })
    .select("_id")
    .limit(CLEANUP_BATCH_SIZE)
    .lean<Array<{ _id: unknown }>>();

  for (const candidate of expired) {
    const draft = await ImageDrafts.findOneAndUpdate(
      { _id: candidate._id, status: "draft" },
      { $set: { status: "deleting" } },
      { new: true }
    )
      .select("key")
      .lean<{ _id: unknown; key: string }>();
    if (!draft) continue;
    try {
      await deleteClaimedDraft(draft);
    } catch (error) {
      console.error("Expired image draft could not be removed", {
        draftId: String(draft._id),
        error,
      });
    }
  }
}

export function scheduleExpiredImageDraftCleanup() {
  const now = Date.now();
  if (
    cleanupState.pending ||
    now - cleanupState.lastStartedAt < CLEANUP_INTERVAL_MS
  ) {
    return;
  }
  cleanupState.lastStartedAt = now;
  cleanupState.pending = cleanupExpiredImageDrafts()
    .catch((error) => console.error("Image draft cleanup failed", error))
    .finally(() => {
      cleanupState.pending = undefined;
    });
}
