import type { ActionFunction } from "react-router";
import { data as json } from "react-router";
import { v4 as uuidv4 } from "uuid";
import {
  interpretAccountingDocument,
  toAccountingDocumentLabel,
  toVerificationSuggestion,
} from "~/services/accounting-document.server";
import { auth } from "~/services/auth.server";
import {
  MAX_VERIFICATION_FILE_SIZE,
  MAX_VERIFICATION_REQUEST_SIZE,
  VerificationFileValidationError,
  isSupportedVerificationFile,
  readVerifiedVerificationFile,
} from "~/services/verification-files.server";
import {
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";

const failedInterpretation = (error: string) =>
  json({
    uuid: uuidv4(),
    verificationData: null,
    status: "failed",
    error,
  });

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

  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(
      request,
      MAX_VERIFICATION_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return failedInterpretation("Filen är större än 20 MB.");
    }
    throw error;
  }
  const file = formData.get("file");

  if (!file || typeof file === "string") {
    return failedInterpretation(
      "Ingen fil kom fram. Välj filen igen och försök en gång till."
    );
  }

  if (!isSupportedVerificationFile(file)) {
    return failedInterpretation(
      "Filtypen stöds inte. Välj en PDF eller en vanlig bildfil."
    );
  }

  if (file.size <= 0 || file.size > MAX_VERIFICATION_FILE_SIZE) {
    return failedInterpretation(
      file.size <= 0 ? "Filen är tom." : "Filen är större än 20 MB."
    );
  }

  let verifiedFile: Awaited<ReturnType<typeof readVerifiedVerificationFile>>;
  try {
    verifiedFile = await readVerifiedVerificationFile(file);
  } catch (error) {
    return failedInterpretation(
      error instanceof VerificationFileValidationError
        ? error.message
        : "Filen kunde inte läsas. Välj en PDF eller en vanlig bildfil."
    );
  }

  let analysis;
  try {
    analysis = await interpretAccountingDocument({
      buffer: verifiedFile.buffer,
      mimeType: verifiedFile.mimeType,
      fileName: file.name,
    });
  } catch (error) {
    console.error(
      "Accounting document interpretation failed",
      getSafeErrorMetadata(error)
    );
    return failedInterpretation(
      "Filen gick att läsa, men innehållet kunde inte tolkas. Prova igen eller fyll i manuellt."
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
