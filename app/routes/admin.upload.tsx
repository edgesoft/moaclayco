import { data as json } from "react-router";
import type { ActionFunction, LoaderFunction } from "react-router";
import { Collections } from "~/schemas/collections";
import { auth } from "~/services/auth.server";
import { processAndStoreDraftImage } from "~/services/image-upload.server";
import {
  ImageProcessingBusyError,
  UnsupportedImageFormatError,
} from "~/utils/imageProcessing.server";
import {
  ImageUploadTooLargeError,
  ImageUploadBusyError,
  InvalidImageUploadError,
  parseTemporaryImageUpload,
} from "~/utils/imageUpload.server";
import {
  acceptedImageFileNamePattern,
  MAX_IMAGE_SIZE,
} from "~/utils/imageUpload.shared";
import {
  InvalidImageDraftError,
  isValidImageDraftId,
} from "~/services/image-drafts.server";

const awsItemPath = process.env.AWS_ITEM_PATH;

if (!awsItemPath) {
  throw new Error(
    "AWS configuration is not complete. Please check your environment variables."
  );
}

export const action: ActionFunction = async ({ request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  let upload;
  try {
    upload = await parseTemporaryImageUpload(request);
  } catch (error) {
    if (error instanceof ImageUploadBusyError) {
      return json(
        { error: "För många bilder bearbetas just nu. Vänta en stund och försök igen." },
        { status: 503 }
      );
    }
    if (error instanceof ImageUploadTooLargeError) {
      return json({ error: "Bilden är större än 18 MB." }, { status: 413 });
    }
    if (error instanceof InvalidImageUploadError) {
      return json({ error: "Bilduppladdningen är ogiltig." }, { status: 400 });
    }
    throw error;
  }
  const collectionRef = upload.fields.get("collectionRef")?.toString().trim();
  const draftId = upload.fields.get("draftId")?.toString().trim() ?? "";

  try {
    if (!collectionRef) {
      return json({ error: "Kollektionen saknas." }, { status: 400 });
    }
    if (!isValidImageDraftId(draftId)) {
      return json({ error: "Bilduppladdningen saknar ett giltigt utkast." }, { status: 400 });
    }

    const collection = await Collections.exists({
      shortUrl: collectionRef,
    });
    if (!collection) {
      return json({ error: "Kollektionen kunde inte hittas." }, { status: 404 });
    }

    if (!acceptedImageFileNamePattern.test(upload.file.name)) {
      return json(
        { error: "Välj en bild i JPG-, PNG-, WebP- eller HEIC-format." },
        { status: 415 }
      );
    }
    if (upload.file.size > MAX_IMAGE_SIZE) {
      return json({ error: "Bilden är större än 18 MB." }, { status: 413 });
    }

    try {
      return json(
        await processAndStoreDraftImage({
          collectionRef,
          draftId,
          inputPath: upload.file.path,
          kind: "item",
          maxWidth: 1600,
          storagePath: awsItemPath,
        })
      );
    } catch (error) {
      if (error instanceof ImageProcessingBusyError) {
        return json(
          { error: "Bildkön är full. Vänta en stund och försök igen." },
          { status: 503 }
        );
      }
      if (
        error instanceof UnsupportedImageFormatError ||
        error instanceof InvalidImageDraftError
      ) {
        return json(
          { error: "Filen är inte en giltig JPG-, PNG-, WebP- eller HEIC-bild." },
          { status: 415 }
        );
      }
      console.error("Image upload failed", error);
      return json(
        { error: "Bilden kunde inte bearbetas eller laddas upp." },
        { status: 500 }
      );
    }
  } finally {
    await upload.cleanup();
  }
};

export const loader: LoaderFunction = async ({ request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  return null;
};
