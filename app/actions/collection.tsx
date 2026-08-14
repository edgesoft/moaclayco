import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { data as json, redirect } from "react-router";
import type { ActionFunction } from "react-router";
import mongoose from "mongoose";
import { z } from "zod";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";
import { auth } from "~/services/auth.server";
import { s3Client } from "~/services/s3.server";
import { invalidateCatalogCache } from "~/services/catalog-cache.server";
import {
  consumeImageDrafts,
  InvalidImageDraftError,
} from "~/services/image-drafts.server";
import { retainOrderImageSourcesBeforeCollectionDeletion } from "~/services/order-image-storage.server";
import type { CollectionProps } from "~/types";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";

const CollectionSchema = z.object({
  headline: z.string().trim().min(1, "Fyll i ett namn"),
  image: z.string().trim().min(1, "Ladda upp en bild"),
  longDescription: z.string().trim().max(1600, "Beskrivningen är för lång"),
  shortDescription: z
    .string()
    .trim()
    .min(1, "Fyll i en kort beskrivning")
    .max(240, "Den korta beskrivningen är för lång"),
  shortUrl: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "URL-namnet får bara innehålla små bokstäver, siffror och bindestreck"
    ),
});

const keyFromAssetUrl = (assetUrl: string, allowedPrefix?: string) => {
  if (!assetUrl || !allowedPrefix) return null;
  try {
    const key = new URL(assetUrl).pathname.replace(/^\/+/, "");
    return key.startsWith(`${allowedPrefix}/`) ? key : null;
  } catch {
    return null;
  }
};

async function deleteAssetKeys(
  keys: Array<string | null>,
  retainedKeys: ReadonlySet<string> = new Set()
) {
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  const uniqueKeys = [
    ...new Set(
      keys.filter(
        (key): key is string => Boolean(key) && !retainedKeys.has(String(key))
      )
    ),
  ];
  if (!bucket || !uniqueKeys.length) return;

  for (let start = 0; start < uniqueKeys.length; start += 1000) {
    const response = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: uniqueKeys.slice(start, start + 1000).map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );
    if (response.Errors?.length) {
      throw new Error(
        `S3 could not remove ${response.Errors.length} collection asset(s)`
      );
    }
  }
}

export const CollectionAction: ActionFunction = async ({ params, request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });

  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(
      request,
      MAX_STANDARD_FORM_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json(
        { errors: { form: "Formuläret är för stort" } },
        { status: 413 }
      );
    }
    throw error;
  }
  const intent = formData.get("intent")?.toString();
  const currentCollection = (params.collection
    ? await Collections.findOne({
        shortUrl: params.collection,
      }).lean()
    : null) as (CollectionProps & { _id: any }) | null;

  if (params.collection && !currentCollection) {
    return json({ errors: { form: "Collection kunde inte hittas" } }, { status: 404 });
  }

  if (intent === "delete") {
    if (!currentCollection || !params.collection) {
      return json({ errors: { form: "Collection kunde inte hittas" } }, { status: 404 });
    }

    const items = await Items.find({
      collectionRef: params.collection,
    })
      .select({ images: 1 })
      .lean();
    const assetKeys = [
      keyFromAssetUrl(currentCollection.image, process.env.AWS_COLLECTION_PATH),
      ...items.flatMap((item) =>
        (item.images ?? []).map((image: string) =>
          keyFromAssetUrl(image, process.env.AWS_ITEM_PATH)
        )
      ),
    ];

    const itemIds = items.map((item) => String(item._id));
    const retainedOrderKeys = itemIds.length
      ? await retainOrderImageSourcesBeforeCollectionDeletion(itemIds)
      : new Set<string>();

    const deleteSession = await mongoose.startSession();
    try {
      await deleteSession.withTransaction(async () => {
        await Items.deleteMany(
          { collectionRef: params.collection },
          { session: deleteSession }
        );
        const collectionDeletion = await Collections.deleteOne(
          { _id: currentCollection._id },
          { session: deleteSession }
        );
        if (collectionDeletion.deletedCount !== 1) {
          throw new Error(`Collection ${params.collection} could not be deleted`);
        }
      });
    } finally {
      await deleteSession.endSession();
    }
    invalidateCatalogCache();

    try {
      await deleteAssetKeys(assetKeys, retainedOrderKeys);
    } catch (error) {
      console.error("Collection assets could not be fully removed", error);
    }

    return redirect("/#collections");
  }

  const result = Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, value.toString()])
  );
  const validated = CollectionSchema.safeParse({
    headline: result.headline ?? "",
    image: result.image ?? "",
    longDescription: result.longDescription ?? "",
    shortDescription: result.shortDescription ?? "",
    shortUrl: result.shortUrl ?? "",
  });

  if (!validated.success) {
    return json(
      {
        errors: validated.error.issues.reduce<Record<string, string>>(
          (errors, issue) => {
            errors[String(issue.path[0])] = issue.message;
            return errors;
          },
          {}
        ),
      },
      { status: 400 }
    );
  }

  const duplicate = await Collections.findOne({
    ...(currentCollection ? { _id: { $ne: currentCollection._id } } : {}),
    shortUrl: validated.data.shortUrl,
  }).lean();
  if (duplicate) {
    return json(
      { errors: { shortUrl: "URL-namnet används redan av en annan Collection" } },
      { status: 409 }
    );
  }

  const data = {
    headline: validated.data.headline,
    image: validated.data.image,
    instagram: result.instagram?.trim() ?? "",
    longDescription: validated.data.longDescription,
    shortDescription: validated.data.shortDescription,
    shortUrl: validated.data.shortUrl,
    twitter: result.twitter?.trim() ?? "",
  };

  const newImageUrls =
    currentCollection?.image === validated.data.image
      ? []
      : [validated.data.image];
  const imageDraftId = result.imageDraftId?.trim() ?? "";
  const previousImage = currentCollection?.image;

  const saveSession = await mongoose.startSession();
  try {
    await saveSession.withTransaction(async () => {
      await consumeImageDrafts({
        draftId: imageDraftId,
        kind: "collection",
        session: saveSession,
        urls: newImageUrls,
      });

      if (currentCollection && params.collection) {
        const collectionUpdate = await Collections.updateOne(
          { _id: currentCollection._id },
          data,
          { session: saveSession }
        );
        if (!collectionUpdate.matchedCount) {
          throw new Error(`Collection ${params.collection} disappeared during update`);
        }
        if (params.collection !== validated.data.shortUrl) {
          await Items.updateMany(
            { collectionRef: params.collection },
            { collectionRef: validated.data.shortUrl },
            { session: saveSession }
          );
        }
      } else {
        await Collections.updateMany(
          {},
          { $inc: { sortOrder: 1 } },
          { session: saveSession }
        );
        await Collections.create([{ ...data, sortOrder: 0 }], {
          session: saveSession,
        });
      }
    });
  } catch (error) {
    if (error instanceof InvalidImageDraftError) {
      return json(
        { errors: { image: "Den uppladdade bilden är inte längre giltig. Ladda upp den igen." } },
        { status: 409 }
      );
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    ) {
      return json(
        { errors: { shortUrl: "URL-namnet används redan av en annan Collection" } },
        { status: 409 }
      );
    }
    throw error;
  } finally {
    await saveSession.endSession();
  }

  if (previousImage && previousImage !== validated.data.image) {
    try {
      await deleteAssetKeys([
        keyFromAssetUrl(previousImage, process.env.AWS_COLLECTION_PATH),
      ]);
    } catch (error) {
      console.error("Previous collection image could not be removed", error);
    }
  }

  invalidateCatalogCache();
  return redirect(`/collections/${validated.data.shortUrl}`);
};
