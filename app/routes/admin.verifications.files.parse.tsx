import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { v4 as uuidv4 } from "uuid";
import {
  interpretAccountingDocument,
  toAccountingDocumentLabel,
  toVerificationSuggestion,
} from "~/services/accounting-document.server";
import { auth } from "~/services/auth.server";
import {
  MAX_VERIFICATION_FILE_SIZE,
  isSupportedVerificationFile,
} from "~/services/verification-files.server";


const getSafeErrorMetadata = (error: unknown) => {
  if (!(error instanceof Error)) {
    return { name: "UnknownError" };
  }

  const apiError = error as Error & { status?: number; request_id?: string };
  return {
    name: apiError.name,
    status: apiError.status,
    requestId: apiError.request_id,
  };
};

export const action: ActionFunction = async ({ request }) => {
  await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });

  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || typeof file === "string") {
    return json(
      { uuid: uuidv4(), verificationData: null, status: "failed" },
      { status: 400 }
    );
  }

  if (!isSupportedVerificationFile(file)) {
    return json(
      { uuid: uuidv4(), verificationData: null, status: "failed" },
      { status: 415 }
    );
  }

  if (file.size <= 0 || file.size > MAX_VERIFICATION_FILE_SIZE) {
    return json(
      { uuid: uuidv4(), verificationData: null, status: "failed" },
      { status: 413 }
    );
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  let analysis;
  try {
    analysis = await interpretAccountingDocument({
      buffer: fileBuffer,
      mimeType: file.type,
      fileName: file.name,
    });
  } catch (error) {
    console.error(
      "Accounting document interpretation failed",
      getSafeErrorMetadata(error)
    );
    return json(
      { uuid: uuidv4(), verificationData: null, status: "failed" },
      { status: 422 }
    );
  }

  const suggestions = analysis.entries.map(toVerificationSuggestion);
  const requiresReview =
    suggestions.length !== 1 ||
    analysis.warnings.length > 0 ||
    suggestions.some(
      (suggestion) =>
        suggestion.confidence < 0.85 ||
        suggestion.sourceAccount === "unknown" ||
        suggestion.warnings.length > 0
    );

  return json({
    uuid: uuidv4(),
    file: { label: toAccountingDocumentLabel(analysis, file.name) },
    verificationData: requiresReview ? null : suggestions[0],
    suggestions,
    document: {
      type: analysis.documentType,
      warnings: analysis.warnings,
    },
    status: requiresReview ? "review" : "success",
  });
};
