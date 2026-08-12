import type { ActionFunction } from "react-router";
import { data as json } from "react-router";
import { v4 as uuidv4 } from "uuid";
import { auth } from "~/services/auth.server";
import { suggestVerificationFileLabel } from "~/services/verification-file-label.server";
import {
  MAX_VERIFICATION_FILE_SIZE,
  isSupportedVerificationFile,
} from "~/services/verification-files.server";
import { fallbackVerificationFileLabel } from "~/utils/verificationFiles";

const safeErrorMetadata = (error: unknown) => {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  const apiError = error as Error & { status?: number; request_id?: string };
  return {
    name: apiError.name,
    status: apiError.status,
    requestId: apiError.request_id,
  };
};

export const action: ActionFunction = async ({ request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });

  const formData = await request.formData();
  const file = formData.get("file");
  const requestedAnalysisKey = formData.get("analysisKey");
  const analysisKey =
    typeof requestedAnalysisKey === "string"
      ? requestedAnalysisKey.slice(0, 100)
      : "";
  const requestId = uuidv4();

  if (!(file instanceof File)) {
    return json({ requestId, analysisKey, status: "failed", error: "Ingen fil vald" }, { status: 400 });
  }
  if (!isSupportedVerificationFile(file)) {
    return json({ requestId, analysisKey, status: "failed", error: "Filtypen stöds inte" }, { status: 415 });
  }
  if (file.size <= 0 || file.size > MAX_VERIFICATION_FILE_SIZE) {
    return json({ requestId, analysisKey, status: "failed", error: "Filen är tom eller för stor" }, { status: 413 });
  }

  try {
    const suggestion = await suggestVerificationFileLabel({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      fileName: file.name,
    });

    return json({ requestId, analysisKey, status: "success", suggestion });
  } catch (error) {
    console.error("Verification file label analysis failed", safeErrorMetadata(error));
    return json({
      requestId,
      analysisKey,
      status: "fallback",
      suggestion: {
        label: fallbackVerificationFileLabel(file.name),
        documentType: "other",
        summary: "Dokumentet kunde inte tolkas automatiskt. Kontrollera namnet innan du sparar.",
        confidence: 0,
        warnings: ["AI-tolkningen kunde inte slutföras."],
      },
    });
  }
};
