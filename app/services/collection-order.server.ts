import mongoose, { type ClientSession } from "mongoose";
import { Collections } from "~/schemas/collections";
import { invalidateCatalogCache } from "~/services/catalog-cache.server";
import { activeCatalogCollectionFilter } from "~/utils/catalogCollections.server";

const MAX_COLLECTIONS = 200;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

export class CollectionOrderValidationError extends Error {}
export class CollectionOrderConflictError extends Error {}

export function parseCollectionOrder(rawOrder: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOrder);
  } catch {
    throw new CollectionOrderValidationError("Ordningen kunde inte läsas.");
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length > MAX_COLLECTIONS ||
    parsed.some(
      (collectionId) =>
        typeof collectionId !== "string" ||
        !OBJECT_ID_PATTERN.test(collectionId)
    )
  ) {
    throw new CollectionOrderValidationError("Ordningen är inte giltig.");
  }

  if (new Set(parsed).size !== parsed.length) {
    throw new CollectionOrderValidationError(
      "Samma Collection får inte förekomma flera gånger."
    );
  }

  return parsed;
}

type CollectionOrderSession = {
  endSession: () => Promise<void>;
  withTransaction: (work: () => Promise<void>) => Promise<unknown>;
};

export type CollectionOrderDependencies = {
  invalidate: () => void;
  listCollectionIds: (session: CollectionOrderSession) => Promise<string[]>;
  startSession: () => Promise<CollectionOrderSession>;
  updateCollectionOrder: (
    orderedIds: string[],
    session: CollectionOrderSession
  ) => Promise<number>;
};

const defaultDependencies: CollectionOrderDependencies = {
  invalidate: invalidateCatalogCache,
  listCollectionIds: async (session) => {
    const collections = await Collections.find(activeCatalogCollectionFilter)
      .select({ _id: 1 })
      .session(session as ClientSession)
      .lean();
    return collections.map((collection) => String(collection._id));
  },
  startSession: async () =>
    (await mongoose.startSession()) as unknown as CollectionOrderSession,
  updateCollectionOrder: async (orderedIds, session) => {
    if (!orderedIds.length) return 0;

    const result = await Collections.bulkWrite(
      orderedIds.map((collectionId, sortOrder) => ({
        updateOne: {
          filter: { ...activeCatalogCollectionFilter, _id: collectionId },
          update: { $set: { sortOrder } },
        },
      })),
      { session: session as ClientSession }
    );
    return result.matchedCount;
  },
};

export async function persistCollectionOrder(
  orderedIds: string[],
  dependencies: CollectionOrderDependencies = defaultDependencies
) {
  const session = await dependencies.startSession();

  try {
    await session.withTransaction(async () => {
      const storedIds = await dependencies.listCollectionIds(session);
      const requestedIds = new Set(orderedIds);
      const includesEveryCollection =
        storedIds.length === orderedIds.length &&
        storedIds.every((collectionId) => requestedIds.has(collectionId));

      if (!includesEveryCollection) {
        throw new CollectionOrderConflictError(
          "Listan har ändrats. Ladda om sidan och försök igen."
        );
      }

      const matchedCount = await dependencies.updateCollectionOrder(
        orderedIds,
        session
      );
      if (matchedCount !== orderedIds.length) {
        throw new CollectionOrderConflictError(
          "Alla Collections kunde inte flyttas."
        );
      }
    });
  } finally {
    await session.endSession();
  }

  dependencies.invalidate();
}
