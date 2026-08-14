import { data as json } from "react-router";
import type { ActionFunction } from "react-router";
import { auth } from "~/services/auth.server";
import { cleanupImageDraft } from "~/services/image-drafts.server";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";

export const action: ActionFunction = async ({ request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });

  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(
      request,
      MAX_STANDARD_FORM_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ error: "Formuläret är för stort." }, { status: 413 });
    }
    throw error;
  }

  const draftId = formData.get("draftId")?.toString().trim();
  const url = formData.get("url")?.toString().trim();
  if (!draftId || !url) {
    return json({ error: "Bildunderlaget är ofullständigt." }, { status: 400 });
  }

  try {
    await cleanupImageDraft({ draftId, url });
    return json({ success: true });
  } catch (error) {
    console.error("Image draft could not be removed", error);
    return json(
      { error: "Utkastbilden kunde inte tas bort." },
      { status: 500 }
    );
  }
};
