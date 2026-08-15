import { data as json, redirect } from "react-router";
import type { ActionFunction } from "react-router";
import mongoose from "mongoose";
import { z } from "zod";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";
import { auth } from "~/services/auth.server";
import { deleteItemWithAssets } from "~/services/item-deletion.server";
import { invalidateCatalogCache } from "~/services/catalog-cache.server";
import {
  consumeImageDrafts,
  InvalidImageDraftError,
} from "~/services/image-drafts.server";
import { MAX_ITEM_IMAGES } from "~/utils/imageUpload.shared";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";
import { activeCatalogItemFilter } from "~/utils/catalogItems.server";
import { activeCatalogCollectionFilter } from "~/utils/catalogCollections.server";

const ItemSchema = z.object({
  amount: z
    .string()
    .min(1, { message: "Var god skriv in antal" })
    .refine(
      (value) => Number.isInteger(Number(value)) && Number(value) >= 0,
      "Antal måste vara ett heltal på 0 eller mer"
    ),
  headline: z.string().trim().min(1, { message: "Var god fyll i namn" }),
  images: z.string().min(1, { message: "Var god ladda upp minst en bild" }),
  itemPrice: z
    .string()
    .min(1, { message: "Var god skriv in pris" })
    .refine(
      (value) => Number.isFinite(Number(value)) && Number(value) >= 0,
      "Pris måste vara 0 eller mer"
    ),
});

const ProductInfoSchema = z.array(
  z.object({
    name: z.string().optional(),
    noValue: z.boolean().optional(),
    value: z.string().min(1),
  })
);

const AdditionalItemsSchema = z.array(
  z.object({
    name: z.string().min(1),
    value: z.union([z.string(), z.number()]).refine(
      (value) => Number.isFinite(Number(value)) && Number(value) >= 0,
      "Tillvalets pris måste vara 0 eller mer"
    ),
  })
);

export const ItemAction: ActionFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });

  const collection = await Collections.findOne({
    ...activeCatalogCollectionFilter,
    shortUrl: params.collection,
  });
  if (!collection) return redirect("/");

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
  if (intent === "delete") {
    if (!params.id || !params.collection) {
      return json(
        { errors: { form: "Produkten kunde inte hittas" } },
        { status: 404 }
      );
    }

    const deletion = await deleteItemWithAssets({
      collection: params.collection,
      id: params.id,
    });

    if (deletion.status === "not_found") {
      return json(
        { errors: { form: "Produkten kunde inte hittas" } },
        { status: 404 }
      );
    }

    invalidateCatalogCache();
    return redirect(`/collections/${params.collection}`);
  }

  const result = Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, value.toString()])
  );
  const targetCollectionRef =
    result.collectionRef?.trim() || String(params.collection);
  const targetCollection =
    targetCollectionRef === params.collection
      ? collection
      : await Collections.findOne({
          ...activeCatalogCollectionFilter,
          shortUrl: targetCollectionRef,
        })
          .select("shortUrl")
          .lean();
  if (!targetCollection) {
    return json(
      { errors: { collectionRef: "Den valda Collectionen finns inte längre" } },
      { status: 409 }
    );
  }
  const validatedItem = ItemSchema.safeParse(result);

  if (!validatedItem.success) {
    return json(
      {
        errors: validatedItem.error.issues.reduce<Record<string, string>>(
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

  let productInfos: z.infer<typeof ProductInfoSchema>;
  let additionalItems: z.infer<typeof AdditionalItemsSchema>;
  try {
    productInfos = ProductInfoSchema.parse(JSON.parse(result.productInfos ?? "[]"));
    additionalItems = AdditionalItemsSchema.parse(
      JSON.parse(result.additionalItems ?? "[]")
    );
  } catch {
    return json(
      { errors: { form: "Detaljer eller tillval innehåller ogiltiga värden" } },
      { status: 400 }
    );
  }

  const images = validatedItem.data.images
    .split(",")
    .map((image) => image.trim())
    .filter(Boolean);
  if (!images.length) {
    return json(
      { errors: { images: "Var god ladda upp minst en bild" } },
      { status: 400 }
    );
  }
  if (images.length > MAX_ITEM_IMAGES || new Set(images).size !== images.length) {
    return json(
      { errors: { images: `En produkt kan ha högst ${MAX_ITEM_IMAGES} unika bilder` } },
      { status: 400 }
    );
  }

  const currentItem = params.id
    ? await Items.findOne({
        ...activeCatalogItemFilter,
        _id: params.id,
        collectionRef: params.collection,
      })
        .select("images")
        .lean<{ images?: string[] }>()
    : null;
  if (params.id && !currentItem) {
    return json({ errors: { form: "Produkten kunde inte hittas" } }, { status: 404 });
  }

  const storedImages = currentItem?.images ?? [];
  const submittedImageSet = new Set(images);
  if (storedImages.some((image) => !submittedImageSet.has(image))) {
    return json(
      {
        errors: {
          images:
            "En sparad bild ändrades utanför bildkontrollen. Ladda om sidan och försök igen.",
        },
      },
      { status: 409 }
    );
  }
  const storedImageSet = new Set(storedImages);
  const newImages = images.filter((image) => !storedImageSet.has(image));
  const imageDraftId = result.imageDraftId?.trim() ?? "";

  const data = {
    additionalItems: additionalItems.map((addition) => ({
      name: addition.name.trim(),
      price: Number(addition.value),
    })),
    amount: Number(validatedItem.data.amount),
    collectionRef: targetCollectionRef,
    headline: validatedItem.data.headline,
    images,
    instagram: result.instagram?.trim() ?? "",
    longDescription: result.longDescription?.trim() ?? "",
    price: Number(validatedItem.data.itemPrice),
    productInfos: productInfos.map((info) =>
      info.noValue ? info.value.trim() : `${info.name?.trim()}: ${info.value.trim()}`
    ),
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await consumeImageDrafts({
        collectionRef: params.collection,
        draftId: imageDraftId,
        kind: "item",
        session,
        urls: newImages,
      });

      if (params.id) {
        const updateResult = await Items.updateOne(
          {
            ...activeCatalogItemFilter,
            _id: params.id,
            collectionRef: params.collection,
          },
          {
            $set: data,
            $unset: { lastCatalogOperationId: "" },
          },
          { session }
        );
        if (!updateResult.matchedCount) {
          throw new Error(`Product ${params.id} disappeared during update`);
        }
      } else {
        await Items.create([data], { session });
      }
    });
  } catch (error) {
    if (error instanceof InvalidImageDraftError) {
      return json(
        { errors: { images: "En uppladdad bild är inte längre giltig. Ladda upp den igen." } },
        { status: 409 }
      );
    }
    throw error;
  } finally {
    await session.endSession();
  }

  invalidateCatalogCache();
  return redirect(`/collections/${targetCollectionRef}`);
};
