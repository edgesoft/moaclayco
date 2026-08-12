import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { data as json, redirect } from "react-router";
import type { ActionFunction } from "react-router";
import { z } from "zod";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";
import { auth } from "~/services/auth.server";
import { s3Client } from "~/services/s3.server";
import type { CollectionProps } from "~/types";
import { getDomain } from "~/utils/domain";
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

async function deleteAssetKeys(keys: Array<string | null>) {
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  const uniqueKeys = [...new Set(keys.filter((key): key is string => Boolean(key)))];
  if (!bucket || !uniqueKeys.length) return;

  for (let start = 0; start < uniqueKeys.length; start += 1000) {
    await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: uniqueKeys.slice(start, start + 1000).map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );
  }
}

export const CollectionAction: ActionFunction = async ({ params, request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const domain = getDomain(request);
  if (!domain) return json({ errors: { form: "Okänd domän" } }, { status: 400 });

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
        domain: domain.domain,
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
      domain: domain.domain,
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

    await Items.deleteMany({
      collectionRef: params.collection,
      domain: domain.domain,
    });
    await Collections.deleteOne({
      _id: currentCollection._id,
      domain: domain.domain,
    });

    try {
      await deleteAssetKeys(assetKeys);
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
    domain: domain.domain,
    shortUrl: validated.data.shortUrl,
  }).lean();
  if (duplicate) {
    return json(
      { errors: { shortUrl: "URL-namnet används redan av en annan Collection" } },
      { status: 409 }
    );
  }

  const data = {
    domain: domain.domain,
    headline: validated.data.headline,
    image: validated.data.image,
    instagram: result.instagram?.trim() ?? "",
    longDescription: validated.data.longDescription,
    shortDescription: validated.data.shortDescription,
    shortUrl: validated.data.shortUrl,
    twitter: result.twitter?.trim() ?? "",
  };

  if (currentCollection && params.collection) {
    await Collections.updateOne(
      { _id: currentCollection._id, domain: domain.domain },
      data
    );
    if (params.collection !== validated.data.shortUrl) {
      await Items.updateMany(
        { collectionRef: params.collection, domain: domain.domain },
        { collectionRef: validated.data.shortUrl }
      );
    }

    if (currentCollection.image && currentCollection.image !== validated.data.image) {
      try {
        await deleteAssetKeys([
          keyFromAssetUrl(currentCollection.image, process.env.AWS_COLLECTION_PATH),
        ]);
      } catch (error) {
        console.error("Previous collection image could not be removed", error);
      }
    }
  } else {
    await Collections.updateMany(
      { domain: domain.domain },
      { $inc: { sortOrder: 1 } }
    );
    await Collections.create({ ...data, sortOrder: 0 });
  }

  return redirect(`/collections/${validated.data.shortUrl}`);
};
