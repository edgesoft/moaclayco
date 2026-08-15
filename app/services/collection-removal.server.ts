import { randomUUID } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { z } from "zod";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";
import { invalidateCatalogCache } from "~/services/catalog-cache.server";
import { retainOrderImageSourcesBeforeCollectionDeletion } from "~/services/order-image-storage.server";
import { activeCatalogCollectionFilter } from "~/utils/catalogCollections.server";
import { activeCatalogItemFilter } from "~/utils/catalogItems.server";
import { COLLECTION_REMOVAL_UNDO_WINDOW_MS } from "~/utils/collectionRemoval.shared";

const MAX_REMOVAL_ITEMS = 500;

const removalDecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("move"),
    itemId: z.string().regex(/^[a-f\d]{24}$/i),
    targetCollectionRef: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("retire"),
    itemId: z.string().regex(/^[a-f\d]{24}$/i),
  }),
]);

const removalPlanSchema = z.array(removalDecisionSchema).max(MAX_REMOVAL_ITEMS);

export type CollectionRemovalDecision = z.infer<typeof removalDecisionSchema>;

type RemovalCollection = {
  _id: unknown;
  shortUrl?: string;
};

type RemovalUndoCollection = RemovalCollection & {
  deletionDecisions?: CollectionRemovalDecision[];
  deletionUndoExpiresAt?: Date;
};

type RemovalItem = {
  _id: unknown;
  images?: string[];
};

export class CollectionRemovalValidationError extends Error {}
export class CollectionRemovalConflictError extends Error {}
export class CollectionRemovalUndoConflictError extends Error {}
export class CollectionRemovalUndoExpiredError extends Error {}

export function parseCollectionRemovalPlan(rawPlan: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPlan);
  } catch {
    throw new CollectionRemovalValidationError(
      "Produktvalen kunde inte läsas. Öppna borttagningen igen."
    );
  }

  const result = removalPlanSchema.safeParse(parsed);
  if (!result.success) {
    throw new CollectionRemovalValidationError(
      "Ett eller flera produktval är inte giltiga."
    );
  }

  const itemIds = result.data.map((decision) => decision.itemId);
  if (new Set(itemIds).size !== itemIds.length) {
    throw new CollectionRemovalValidationError(
      "Varje produkt får bara ha ett beslut."
    );
  }

  return result.data;
}

type RemovalSession = {
  endSession(): Promise<void>;
  withTransaction<T>(work: () => Promise<T>): Promise<T>;
};

export type CollectionRemovalDependencies = {
  applyDecisions(input: {
    collectionRef: string;
    decisions: CollectionRemovalDecision[];
    operationId: string;
    retiredAt: Date;
    session: RemovalSession;
  }): Promise<number>;
  archiveCollection(input: {
    collectionId: unknown;
    decisions: CollectionRemovalDecision[];
    deletedAt: Date;
    operationId: string;
    session: RemovalSession;
    undoExpiresAt: Date;
  }): Promise<boolean>;
  createOperationId(): string;
  findActiveItems(
    collectionRef: string,
    session?: RemovalSession
  ): Promise<RemovalItem[]>;
  findCollection(
    collectionRef: string,
    session?: RemovalSession
  ): Promise<RemovalCollection | null>;
  findUndoCollection(
    operationId: string,
    session: RemovalSession
  ): Promise<RemovalUndoCollection | null>;
  invalidate(): void;
  listTargetCollectionRefs(
    refs: string[],
    session: RemovalSession
  ): Promise<string[]>;
  now(): Date;
  restoreCollection(input: {
    collectionId: unknown;
    operationId: string;
    session: RemovalSession;
  }): Promise<boolean>;
  restoreItems(input: {
    collectionRef: string;
    decisions: CollectionRemovalDecision[];
    operationId: string;
    session: RemovalSession;
  }): Promise<number>;
  retainOrderImages(itemIds: string[]): Promise<ReadonlySet<string>>;
  startSession(): Promise<RemovalSession>;
};

const defaultDependencies: CollectionRemovalDependencies = {
  applyDecisions: async ({
    collectionRef,
    decisions,
    operationId,
    retiredAt,
    session,
  }) => {
    if (!decisions.length) return 0;
    const result = await Items.bulkWrite(
      decisions.map((decision) => ({
        updateOne: {
          filter: {
            ...activeCatalogItemFilter,
            _id: decision.itemId,
            collectionRef,
          },
          update:
            decision.action === "move"
              ? {
                  $set: {
                    collectionRef: decision.targetCollectionRef,
                    lastCatalogOperationId: operationId,
                  },
                }
              : {
                  $set: {
                    catalogStatus: "retired",
                    lastCatalogOperationId: operationId,
                    retiredAt,
                    retiredFromCollection: collectionRef,
                    retirementReason: "collection_deleted",
                  },
                },
        },
      })),
      { session: session as ClientSession }
    );
    return result.matchedCount;
  },
  archiveCollection: async ({
    collectionId,
    decisions,
    deletedAt,
    operationId,
    session,
    undoExpiresAt,
  }) => {
    const result = await Collections.updateOne(
      {
        ...activeCatalogCollectionFilter,
        _id: collectionId,
      },
      {
        $set: {
          catalogStatus: "deleted",
          deletedAt,
          deletionDecisions: decisions,
          deletionOperationId: operationId,
          deletionUndoExpiresAt: undoExpiresAt,
        },
      },
      { session: session as ClientSession }
    );
    return result.modifiedCount === 1;
  },
  createOperationId: randomUUID,
  findActiveItems: async (collectionRef, session) => {
    const query = Items.find({
      ...activeCatalogItemFilter,
      collectionRef,
    })
      .select("images")
      .lean<RemovalItem[]>();
    if (session) query.session(session as ClientSession);
    return query.exec();
  },
  findCollection: async (collectionRef, session) => {
    const query = Collections.findOne({
      ...activeCatalogCollectionFilter,
      shortUrl: collectionRef,
    })
      .select("shortUrl")
      .lean<RemovalCollection>();
    if (session) query.session(session as ClientSession);
    return query.exec();
  },
  findUndoCollection: async (operationId, session) =>
    Collections.findOne({
      catalogStatus: "deleted",
      deletionOperationId: operationId,
    })
      .select("shortUrl deletionDecisions deletionUndoExpiresAt")
      .session(session as ClientSession)
      .lean<RemovalUndoCollection>(),
  invalidate: invalidateCatalogCache,
  listTargetCollectionRefs: async (refs, session) => {
    if (!refs.length) return [];
    const collections = await Collections.find({
      ...activeCatalogCollectionFilter,
      shortUrl: { $in: refs },
    })
      .select("shortUrl")
      .session(session as ClientSession)
      .lean<Array<{ shortUrl?: string }>>();
    return collections.flatMap((collection) =>
      collection.shortUrl ? [collection.shortUrl] : []
    );
  },
  now: () => new Date(),
  restoreCollection: async ({ collectionId, operationId, session }) => {
    const result = await Collections.updateOne(
      {
        _id: collectionId,
        catalogStatus: "deleted",
        deletionOperationId: operationId,
      },
      {
        $set: { catalogStatus: "active" },
        $unset: {
          deletedAt: "",
          deletionDecisions: "",
          deletionOperationId: "",
          deletionUndoExpiresAt: "",
        },
      },
      { session: session as ClientSession }
    );
    return result.modifiedCount === 1;
  },
  restoreItems: async ({
    collectionRef,
    decisions,
    operationId,
    session,
  }) => {
    if (!decisions.length) return 0;
    const result = await Items.bulkWrite(
      decisions.map((decision) => ({
        updateOne: {
          filter:
            decision.action === "move"
              ? {
                  ...activeCatalogItemFilter,
                  _id: decision.itemId,
                  collectionRef: decision.targetCollectionRef,
                  lastCatalogOperationId: operationId,
                }
              : {
                  _id: decision.itemId,
                  catalogStatus: "retired",
                  lastCatalogOperationId: operationId,
                  retiredFromCollection: collectionRef,
                },
          update:
            decision.action === "move"
              ? {
                  $set: { collectionRef },
                  $unset: { lastCatalogOperationId: "" },
                }
              : {
                  $set: { catalogStatus: "active", collectionRef },
                  $unset: {
                    lastCatalogOperationId: "",
                    retiredAt: "",
                    retiredFromCollection: "",
                    retirementReason: "",
                  },
                },
        },
      })),
      { session: session as ClientSession }
    );
    return result.matchedCount;
  },
  retainOrderImages: retainOrderImageSourcesBeforeCollectionDeletion,
  startSession: async () =>
    (await mongoose.startSession()) as unknown as RemovalSession,
};

function validateCoverage(
  collectionRef: string,
  decisions: CollectionRemovalDecision[],
  items: RemovalItem[]
) {
  const storedIds = items.map((item) => String(item._id));
  const plannedIds = new Set(decisions.map((decision) => decision.itemId));
  const coversEveryItem =
    storedIds.length === decisions.length &&
    storedIds.every((itemId) => plannedIds.has(itemId));

  if (!coversEveryItem) {
    throw new CollectionRemovalConflictError(
      "Produkterna har ändrats sedan panelen öppnades. Kontrollera valen igen."
    );
  }

  if (
    decisions.some(
      (decision) =>
        decision.action === "move" &&
        decision.targetCollectionRef === collectionRef
    )
  ) {
    throw new CollectionRemovalValidationError(
      "En produkt kan inte flyttas till samma Collection som tas bort."
    );
  }
}

export async function removeCollectionWithPlan(
  input: {
    collectionRef: string;
    decisions: CollectionRemovalDecision[];
  },
  dependencies: CollectionRemovalDependencies = defaultDependencies
) {
  const [collection, itemsBeforeTransaction] = await Promise.all([
    dependencies.findCollection(input.collectionRef),
    dependencies.findActiveItems(input.collectionRef),
  ]);
  if (!collection) {
    throw new CollectionRemovalConflictError("Collection kunde inte hittas.");
  }
  validateCoverage(input.collectionRef, input.decisions, itemsBeforeTransaction);

  const retiringIds = input.decisions
    .filter((decision) => decision.action === "retire")
    .map((decision) => decision.itemId);
  if (retiringIds.length) {
    await dependencies.retainOrderImages(retiringIds);
  }

  const deletedAt = dependencies.now();
  const operationId = dependencies.createOperationId();
  const undoExpiresAt = new Date(
    deletedAt.getTime() + COLLECTION_REMOVAL_UNDO_WINDOW_MS
  );
  const targetRefs = [
    ...new Set(
      input.decisions.flatMap((decision) =>
        decision.action === "move" ? [decision.targetCollectionRef] : []
      )
    ),
  ];
  const session = await dependencies.startSession();
  try {
    await session.withTransaction(async () => {
      // A MongoDB ClientSession may only execute one transaction operation at
      // a time. Keep these reads sequential; Promise.all causes transaction
      // number conflicts on Atlas even though every query is read-only.
      const storedCollection = await dependencies.findCollection(
        input.collectionRef,
        session
      );
      const storedItems = await dependencies.findActiveItems(
        input.collectionRef,
        session
      );
      const existingTargetRefs = await dependencies.listTargetCollectionRefs(
        targetRefs,
        session
      );
      if (!storedCollection) {
        throw new CollectionRemovalConflictError(
          "Collection har redan tagits bort."
        );
      }
      validateCoverage(input.collectionRef, input.decisions, storedItems);
      if (
        existingTargetRefs.length !== targetRefs.length ||
        targetRefs.some((ref) => !existingTargetRefs.includes(ref))
      ) {
        throw new CollectionRemovalConflictError(
          "En vald Collection finns inte längre. Kontrollera valen igen."
        );
      }

      const matchedCount = await dependencies.applyDecisions({
        collectionRef: input.collectionRef,
        decisions: input.decisions,
        operationId,
        retiredAt: deletedAt,
        session,
      });
      if (matchedCount !== input.decisions.length) {
        throw new CollectionRemovalConflictError(
          "Alla produkter kunde inte uppdateras. Kontrollera valen igen."
        );
      }
      const archived = await dependencies.archiveCollection({
        collectionId: storedCollection._id,
        decisions: input.decisions,
        deletedAt,
        operationId,
        session,
        undoExpiresAt,
      });
      if (!archived) {
        throw new CollectionRemovalConflictError(
          "Collectionen har ändrats sedan panelen öppnades. Uppdatera underlaget och försök igen."
        );
      }
    });
  } finally {
    await session.endSession();
  }

  dependencies.invalidate();
  return {
    collectionRef: input.collectionRef,
    movedCount: input.decisions.length - retiringIds.length,
    operationId,
    retiredCount: retiringIds.length,
    undoExpiresAt,
  };
}

export async function undoCollectionRemoval(
  operationId: string,
  dependencies: CollectionRemovalDependencies = defaultDependencies
) {
  const session = await dependencies.startSession();
  let collectionRef = "";
  try {
    await session.withTransaction(async () => {
      const collection = await dependencies.findUndoCollection(
        operationId,
        session
      );
      if (!collection?.shortUrl) {
        throw new CollectionRemovalUndoConflictError(
          "Den här borttagningen går inte längre att återställa."
        );
      }
      if (
        !collection.deletionUndoExpiresAt ||
        collection.deletionUndoExpiresAt.getTime() <= dependencies.now().getTime()
      ) {
        throw new CollectionRemovalUndoExpiredError(
          "Tiden för att ångra borttagningen har gått ut."
        );
      }

      const parsedDecisions = removalPlanSchema.safeParse(
        collection.deletionDecisions ?? []
      );
      if (!parsedDecisions.success) {
        throw new CollectionRemovalUndoConflictError(
          "Återställningsunderlaget är inte komplett."
        );
      }
      collectionRef = collection.shortUrl;
      const restoredItems = await dependencies.restoreItems({
        collectionRef,
        decisions: parsedDecisions.data,
        operationId,
        session,
      });
      if (restoredItems !== parsedDecisions.data.length) {
        throw new CollectionRemovalUndoConflictError(
          "Någon produkt har ändrats efter borttagningen och skrevs därför inte över."
        );
      }
      const restoredCollection = await dependencies.restoreCollection({
        collectionId: collection._id,
        operationId,
        session,
      });
      if (!restoredCollection) {
        throw new CollectionRemovalUndoConflictError(
          "Collection kunde inte återställas."
        );
      }
    });
  } finally {
    await session.endSession();
  }

  dependencies.invalidate();
  return { collectionRef };
}
