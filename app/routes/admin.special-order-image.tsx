import mongoose from "mongoose";
import { data as json } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { Orders } from "~/schemas/orders";
import { auth } from "~/services/auth.server";
import {
  consumeImageDrafts,
  InvalidImageDraftError,
  isValidImageDraftId,
} from "~/services/image-drafts.server";
import { processAndStoreDraftImage } from "~/services/image-upload.server";
import {
  ImageProcessingBusyError,
  UnsupportedImageFormatError,
} from "~/utils/imageProcessing.server";
import {
  ImageUploadBusyError,
  ImageUploadTooLargeError,
  InvalidImageUploadError,
  parseTemporaryImageUpload,
} from "~/utils/imageUpload.server";
import {
  acceptedImageFileNamePattern,
  MAX_IMAGE_SIZE,
} from "~/utils/imageUpload.shared";

const storagePath = process.env.AWS_ITEM_PATH;

export const action = async ({ request }: ActionFunctionArgs) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  if (!storagePath) {
    return json({ error: "Bildlagringen är inte konfigurerad." }, { status: 503 });
  }

  let upload;
  try {
    upload = await parseTemporaryImageUpload(request);
  } catch (error) {
    if (error instanceof ImageUploadBusyError) {
      return json({ error: "För många bilder bearbetas. Försök snart igen." }, { status: 503 });
    }
    if (error instanceof ImageUploadTooLargeError) {
      return json({ error: "Bilden är större än 18 MB." }, { status: 413 });
    }
    if (error instanceof InvalidImageUploadError) {
      return json({ error: "Bilduppladdningen är ogiltig." }, { status: 400 });
    }
    throw error;
  }

  const orderId = upload.fields.get("orderId")?.toString().trim() ?? "";
  const draftId = upload.fields.get("draftId")?.toString().trim() ?? "";
  const purpose = upload.fields.get("purpose")?.toString() === "design"
    ? "design"
    : "final";

  try {
    if (!mongoose.Types.ObjectId.isValid(orderId) || !isValidImageDraftId(draftId)) {
      return json({ error: "Beställningen eller bilduppkastet är ogiltigt." }, { status: 400 });
    }
    const order = await Orders.findOne({ _id: orderId, kind: "SPECIAL" })
      .select("status")
      .lean<{ status?: string }>();
    if (!order) return json({ error: "Beställningen hittades inte." }, { status: 404 });
    if (purpose === "design" && order.status !== "DRAFT") {
      return json({ error: "Inspirationsbilden kan bara ändras i ett utkast." }, { status: 409 });
    }
    if (
      purpose === "final" &&
      !["SUCCESS", "PAID_REVIEW", "MANUAL_PROCESSING"].includes(String(order.status))
    ) {
      return json({ error: "Slutfotot kan läggas till när ordern är betald." }, { status: 409 });
    }
    if (!acceptedImageFileNamePattern.test(upload.file.name)) {
      return json({ error: "Välj JPG, PNG, WebP eller HEIC." }, { status: 415 });
    }
    if (upload.file.size > MAX_IMAGE_SIZE) {
      return json({ error: "Bilden är större än 18 MB." }, { status: 413 });
    }

    let stored;
    try {
      stored = await processAndStoreDraftImage({
        draftId,
        inputPath: upload.file.path,
        kind: "special-order",
        maxWidth: 1800,
        storagePath: `${storagePath.replace(/\/$/, "")}/special-orders`,
      });
    } catch (error) {
      if (error instanceof ImageProcessingBusyError) {
        return json({ error: "Bildkön är full. Försök snart igen." }, { status: 503 });
      }
      if (error instanceof UnsupportedImageFormatError) {
        return json({ error: "Filen kunde inte läsas som en bild." }, { status: 415 });
      }
      throw error;
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await consumeImageDrafts({
          draftId,
          kind: "special-order",
          session,
          urls: [stored.url],
        });
        const field = purpose === "design" ? "items.0.image" : "items.0.finalImage";
        const result = await Orders.updateOne(
          { _id: orderId, kind: "SPECIAL", status: order.status },
          { $set: { [field]: stored.url, updatedAt: new Date() } },
          { session }
        );
        if (!result.matchedCount) throw new Error("Special order changed during image upload");
      });
    } finally {
      await session.endSession();
    }
    return json({ url: stored.url });
  } catch (error) {
    if (error instanceof InvalidImageDraftError) {
      return json({ error: "Bilduppladdningen hann gå ut. Försök igen." }, { status: 409 });
    }
    console.error("Special order image upload failed", { error, orderId, purpose });
    return json({ error: "Bilden kunde inte sparas." }, { status: 500 });
  } finally {
    await upload.cleanup();
  }
};
