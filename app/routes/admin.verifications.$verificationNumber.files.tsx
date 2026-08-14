import type { ChangeEvent, DragEvent } from "react";
import { useRef, useState } from "react";
import { data as json, Link, useFetcher, useLoaderData } from "react-router";
import type { ActionFunction, LoaderFunction } from "react-router";
import { Verifications } from "~/schemas/verifications";
import { auth } from "~/services/auth.server";
import {
  deleteUploadedVerificationFile,
  MAX_VERIFICATION_REQUEST_SIZE,
  readVerifiedVerificationFile,
  uploadVerificationFile,
  validateVerificationFile,
  verificationStorageKeyFromPath,
} from "~/services/verification-files.server";
import {
  getVerificationEditPolicy,
  removeVerificationFileReference,
  VerificationEditBlockedError,
} from "~/services/verification.server";
import {
  fallbackVerificationFileLabel,
  sanitizeVerificationFileLabel,
} from "~/utils/verificationFiles";
import { accountingYear } from "~/utils/accountingDates";
import { toLoaderData } from "~/utils/loaderData";
import ArrowIcon from "~/components/ArrowIcon";
import {
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";
import { VerificationValidationError } from "~/utils/verificationValidation";

type VerificationFile = { name: string; path: string };

type FilesLoaderData = {
  verification: {
    verificationNumber: number;
    description: string;
    verificationDate: string;
    files: VerificationFile[];
  };
  removalPolicy: {
    editable: boolean;
    reason: string | null;
  };
};

type FilesActionData =
  | { success: true; action: "uploaded"; name: string; path: string }
  | {
      success: true;
      action: "removed";
      name: string;
      path: string;
      warning?: string;
    }
  | { success?: false; error: string };

type FileLabelSuggestion = {
  label: string;
  documentType:
    | "receipt"
    | "supplier_invoice"
    | "sales_invoice"
    | "tax_account_statement"
    | "vat_return"
    | "bank_statement"
    | "payment_confirmation"
    | "other";
  summary: string;
  confidence: number;
  warnings: string[];
};

type LabelAnalysisData =
  | {
      requestId: string;
      analysisKey: string;
      status: "success" | "fallback";
      suggestion: FileLabelSuggestion;
    }
  | {
      requestId: string;
      analysisKey: string;
      status: "failed";
      error: string;
    };

type LabelOrigin = "manual" | "suggestion" | null;
type AnalysisStatus = "idle" | "loading" | "success" | "fallback" | "failed";
type VerificationFilesState = {
  activeAnalysisKey: string | null;
  analysisStatus: AnalysisStatus;
  appliedAnalysisData: LabelAnalysisData | undefined;
  appliedUploadData: FilesActionData | undefined;
  appliedVerification: FilesLoaderData["verification"];
  files: VerificationFile[];
  label: string;
  labelOrigin: LabelOrigin;
  localError: string | null;
  selectedFile: File | null;
  suggestion: FileLabelSuggestion | null;
  uploadError: string | null;
};
const MAX_CLIENT_FILE_SIZE = 20 * 1024 * 1024;

const documentTypeLabels: Record<FileLabelSuggestion["documentType"], string> = {
  receipt: "Kvitto",
  supplier_invoice: "Leverantörsfaktura",
  sales_invoice: "Kundfaktura",
  tax_account_statement: "Skattekontoutdrag",
  vat_return: "Momsdeklaration",
  bank_statement: "Kontoutdrag",
  payment_confirmation: "Betalningsbekräftelse",
  other: "Dokument",
};

const formatDate = (date: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Europe/Stockholm",
  }).format(new Date(date));

const formatFileSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("sv-SE", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} MB`;
};

const fileType = (file: VerificationFile) => {
  const source = file.path || file.name;
  const extension = source.split("?")[0].split(".").pop();
  return extension && extension !== source
    ? extension.toLocaleUpperCase("sv-SE")
    : "FIL";
};

const resetSelectedFile = (
  current: VerificationFilesState
): VerificationFilesState => ({
  ...current,
  activeAnalysisKey: null,
  analysisStatus: "idle",
  label: "",
  labelOrigin: null,
  localError: null,
  selectedFile: null,
  suggestion: null,
  uploadError: null,
});

const synchronizeVerificationFiles = ({
  analysisData,
  current,
  uploadData,
  verification,
}: {
  analysisData: LabelAnalysisData | undefined;
  current: VerificationFilesState;
  uploadData: FilesActionData | undefined;
  verification: FilesLoaderData["verification"];
}): VerificationFilesState => {
  let next = current;

  if (next.appliedVerification !== verification) {
    const changesVerification =
      next.appliedVerification.verificationNumber !==
      verification.verificationNumber;
    next = {
      ...(changesVerification ? resetSelectedFile(next) : next),
      appliedAnalysisData: changesVerification
        ? analysisData
        : next.appliedAnalysisData,
      appliedUploadData: changesVerification
        ? uploadData
        : next.appliedUploadData,
      appliedVerification: verification,
      files: verification.files || [],
    };
  }

  if (next.appliedUploadData !== uploadData) {
    next = { ...next, appliedUploadData: uploadData };
    if (
      uploadData &&
      "success" in uploadData &&
      uploadData.success &&
      uploadData.action === "uploaded"
    ) {
      const uploadedFile = { name: uploadData.name, path: uploadData.path };
      const files = next.files.some((file) => file.path === uploadedFile.path)
        ? next.files
        : [...next.files, uploadedFile];
      next = { ...resetSelectedFile(next), files };
    } else if (uploadData && "error" in uploadData) {
      next = { ...next, uploadError: uploadData.error };
    }
  }

  if (next.appliedAnalysisData !== analysisData) {
    next = { ...next, appliedAnalysisData: analysisData };
    if (analysisData?.analysisKey === next.activeAnalysisKey) {
      if (analysisData.status === "failed") {
        next = {
          ...next,
          analysisStatus: "failed",
          localError: analysisData.error,
        };
      } else {
        const usesSuggestion = !next.label.trim();
        next = {
          ...next,
          analysisStatus: analysisData.status,
          label: usesSuggestion ? analysisData.suggestion.label : next.label,
          labelOrigin: usesSuggestion ? "suggestion" : next.labelOrigin,
          suggestion: analysisData.suggestion,
        };
      }
    }
  }

  return next;
};

export const loader: LoaderFunction = async ({ params, request }) => {
  const user = await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const verificationNumber = Number(params.verificationNumber);
  if (!Number.isInteger(verificationNumber)) {
    throw new Response("Ogiltigt verifikationsnummer", { status: 400 });
  }

  const verification = (await Verifications.findOne({
    verificationNumber,
  })
    .select(
      "recordType verificationNumber description verificationDate metadata files"
    )
    .lean()) as unknown as {
      recordType?: string;
      verificationNumber: number;
      description: string;
      verificationDate: Date;
      metadata?: Array<{ key?: unknown; value?: unknown }>;
      files: VerificationFile[];
    } | null;

  if (!verification) throw new Response("Not Found", { status: 404 });

  const verificationDate = new Date(verification.verificationDate);
  let removalPolicy = await getVerificationEditPolicy({
    verification: {
      recordType: verification.recordType,
      verificationDate,
      metadata: verification.metadata,
    },
  });
  const verificationYear = accountingYear(verificationDate);
  if (verificationYear !== user.fiscalYear) {
    removalPolicy = {
      editable: false,
      reportedPeriods: [],
      reason: `Välj bokföringsår ${verificationYear ?? "för verifikationen"} innan du tar bort en bilaga från A${verificationNumber}.`,
    };
  }

  return json(toLoaderData({
    verification: {
      verificationNumber: verification.verificationNumber,
      description: verification.description,
      verificationDate: verification.verificationDate,
      files: verification.files || [],
    },
    removalPolicy,
  }));
};

export const action: ActionFunction = async ({ request, params }) => {
  const user = await auth.isAuthenticated(request, { failureRedirect: "/login" });
  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(
      request,
      MAX_VERIFICATION_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ error: "Filen är större än 20 MB" }, { status: 413 });
    }
    throw error;
  }
  const verificationNumber = Number(params.verificationNumber);
  if (!Number.isInteger(verificationNumber)) {
    return json({ error: "Verifikationsnumret saknas" }, { status: 400 });
  }
  const intent = formData.get("intent");

  if (intent === "remove") {
    const path = formData.get("path");
    if (typeof path !== "string") {
      return json({ error: "Bilagan kunde inte identifieras" }, { status: 400 });
    }

    let removedFile: { name: string; path: string };
    try {
      removedFile = await removeVerificationFileReference({
        verificationNumber,
        expectedYear: user.fiscalYear,
        path,
        removedBy: user.email,
      });
    } catch (error) {
      if (error instanceof VerificationEditBlockedError) {
        return json({ error: error.message }, { status: 409 });
      }
      if (error instanceof VerificationValidationError) {
        return json({ error: error.message }, { status: 400 });
      }
      console.error("Verification file removal failed", {
        verificationNumber,
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return json(
        { error: "Bilagan kunde inte tas bort. Försök igen." },
        { status: 500 }
      );
    }

    let warning: string | undefined;
    try {
      const stillReferenced = await Verifications.exists({
        files: { $elemMatch: { path: removedFile.path } },
      });
      if (!stillReferenced) {
        const storageKey = verificationStorageKeyFromPath(removedFile.path);
        if (!storageKey) {
          warning =
            "Bilagan kopplades bort, men lagringsfilen kunde inte identifieras för automatisk rensning.";
        } else {
          const deleted = await deleteUploadedVerificationFile(storageKey);
          if (!deleted) {
            warning =
              "Bilagan kopplades bort, men lagringsfilen kunde inte rensas automatiskt.";
          }
        }
      }
    } catch (error) {
      console.error("Verification storage cleanup failed", {
        verificationNumber,
        name: error instanceof Error ? error.name : "UnknownError",
      });
      warning =
        "Bilagan kopplades bort, men lagringsfilen kunde inte rensas automatiskt.";
    }

    return json({
      success: true,
      action: "removed",
      name: removedFile.name,
      path: removedFile.path,
      warning,
    });
  }

  if (intent !== null && intent !== "upload") {
    return json({ error: "Okänd filåtgärd" }, { status: 400 });
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return json({ error: "Filen eller verifikationsnumret saknas" }, { status: 400 });
  }

  let verifiedFile: Awaited<ReturnType<typeof readVerifiedVerificationFile>>;
  try {
    validateVerificationFile(file);
    verifiedFile = await readVerifiedVerificationFile(file);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Ogiltig fil" },
      { status: 400 }
    );
  }

  const requestedLabel = formData.get("label");
  const label = sanitizeVerificationFileLabel(
    typeof requestedLabel === "string" && requestedLabel.trim()
      ? requestedLabel
      : fallbackVerificationFileLabel(file.name)
  );

  let uploadedFile: Awaited<ReturnType<typeof uploadVerificationFile>> | null = null;
  try {
    uploadedFile = await uploadVerificationFile(
      file,
      String(verificationNumber),
      verifiedFile
    );
    const updateResult = await Verifications.updateOne(
      { verificationNumber },
      { $push: { files: { name: label, path: uploadedFile.path } } }
    );

    if (updateResult.modifiedCount !== 1) {
      throw new Error("Verifikationen kunde inte uppdateras");
    }

    return json({
      success: true,
      action: "uploaded",
      name: label,
      path: uploadedFile.path,
    });
  } catch (error) {
    if (uploadedFile) {
      await deleteUploadedVerificationFile(uploadedFile.key).catch((cleanupError) =>
        console.error("Kunde inte rensa filen efter misslyckad uppdatering", cleanupError)
      );
    }
    console.error("Verification file upload failed", error);
    return json({ error: "Bilagan kunde inte sparas. Försök igen." }, { status: 500 });
  }
};

export default function VerificationFiles() {
  const { removalPolicy, verification } = useLoaderData<FilesLoaderData>();
  const uploadFetcher = useFetcher<FilesActionData>();
  const removalFetcher = useFetcher<FilesActionData>();
  const analysisFetcher = useFetcher<LabelAnalysisData>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileState, setFileState] = useState<VerificationFilesState>(() => ({
    activeAnalysisKey: null,
    analysisStatus: "idle",
    appliedAnalysisData: undefined,
    appliedUploadData: undefined,
    appliedVerification: verification,
    files: verification.files || [],
    label: "",
    labelOrigin: null,
    localError: null,
    selectedFile: null,
    suggestion: null,
    uploadError: null,
  }));
  const [isDragging, setIsDragging] = useState(false);
  const [filePendingRemoval, setFilePendingRemoval] =
    useState<VerificationFile | null>(null);
  const [submittedRemovalPath, setSubmittedRemovalPath] =
    useState<string | null>(null);

  const synchronizedFileState = synchronizeVerificationFiles({
    analysisData: analysisFetcher.data,
    current: fileState,
    uploadData: uploadFetcher.data,
    verification,
  });
  if (synchronizedFileState !== fileState) {
    setFileState(synchronizedFileState);
  }

  const {
    analysisStatus,
    files,
    label,
    labelOrigin,
    localError,
    selectedFile,
    suggestion,
    uploadError,
  } = fileState;

  const updateLabel = (value: string, origin: LabelOrigin) => {
    setFileState((current) => ({
      ...current,
      label: value,
      labelOrigin: origin,
    }));
  };

  const resetSelection = () => {
    setFileState((current) => resetSelectedFile(current));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const analyzeFile = (file: File) => {
    if (
      file.type !== "application/pdf" &&
      !file.type.startsWith("image/")
    ) {
      setFileState((current) => ({
        ...current,
        localError: "Välj en PDF eller bildfil.",
        uploadError: null,
      }));
      return;
    }
    if (file.size <= 0 || file.size > MAX_CLIENT_FILE_SIZE) {
      setFileState((current) => ({
        ...current,
        localError: "Filen är tom eller större än 20 MB.",
        uploadError: null,
      }));
      return;
    }

    const formData = new FormData();
    const analysisKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setFileState((current) => ({
      ...current,
      activeAnalysisKey: analysisKey,
      analysisStatus: "loading",
      label: current.labelOrigin === "manual" ? current.label : "",
      labelOrigin: current.labelOrigin === "manual" ? "manual" : null,
      localError: null,
      selectedFile: file,
      suggestion: null,
      uploadError: null,
    }));
    formData.append("file", file);
    formData.append("analysisKey", analysisKey);
    analysisFetcher.submit(formData, {
      method: "post",
      action: "/admin/verifications/files/label",
      encType: "multipart/form-data",
    });
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) analyzeFile(file);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) analyzeFile(file);
  };

  const saveFile = () => {
    if (!selectedFile || !label.trim()) return;
    setFileState((current) => ({ ...current, uploadError: null }));
    const formData = new FormData();
    formData.append("intent", "upload");
    formData.append("file", selectedFile);
    formData.append("label", label);
    uploadFetcher.submit(formData, {
      method: "post",
      action: `/admin/verifications/${verification.verificationNumber}/files`,
      encType: "multipart/form-data",
    });
  };

  const removeFile = (file: VerificationFile) => {
    setSubmittedRemovalPath(file.path);
    const formData = new FormData();
    formData.append("intent", "remove");
    formData.append("path", file.path);
    removalFetcher.submit(formData, {
      method: "post",
      action: `/admin/verifications/${verification.verificationNumber}/files`,
    });
  };

  const isUploading = uploadFetcher.state !== "idle";
  const isAnalyzing = analysisStatus === "loading";
  const isRemoving = removalFetcher.state !== "idle";
  const activeRemoval =
    filePendingRemoval &&
    files.some((file) => file.path === filePendingRemoval.path)
      ? filePendingRemoval
      : null;
  const removalResult =
    removalFetcher.data &&
    "success" in removalFetcher.data &&
    removalFetcher.data.success &&
    removalFetcher.data.action === "removed"
      ? removalFetcher.data
      : null;
  const removalError =
    removalFetcher.data && "error" in removalFetcher.data
      ? removalFetcher.data.error
      : null;
  const suggestionMatchesLabel =
    Boolean(suggestion) && suggestion?.label.trim() === label.trim();

  return (
    <section aria-labelledby="files-title" className="pb-20">
      <header className="border-b border-stone-200 pb-5 sm:pb-7">
        <Link
          to="/admin/verifications"
          className="inline-flex h-10 items-center rounded-lg px-1 text-xs font-bold text-stone-500 transition hover:text-stone-950"
        >
          <span aria-hidden="true" className="mr-2"><ArrowIcon direction="left" /></span>
          Till bokföringen
        </Link>
        <div className="mt-3 max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#985744]">
            Underlag · A{verification.verificationNumber}
          </p>
          <h2
            id="files-title"
            className="mt-2 font-serif text-3xl leading-tight text-stone-950 sm:text-5xl"
          >
            Bilagor till verifikationen
          </h2>
          <p className="mt-3 text-sm leading-6 text-stone-600 sm:text-base">
            {verification.description}
            <span aria-hidden="true"> · </span>
            {formatDate(verification.verificationDate)}
          </p>
        </div>
      </header>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-start lg:gap-7">
        <section
          aria-labelledby="existing-files-title"
          className="order-2 overflow-hidden rounded-[1.4rem] border border-stone-200 bg-white shadow-[0_1px_0_rgba(41,37,36,0.04)] lg:order-1"
        >
          <header className="flex items-start justify-between gap-4 border-b border-stone-200 bg-[#fbf8f4] px-4 py-4 sm:px-6 sm:py-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#985744]">
                Sparade underlag
              </p>
              <h3 id="existing-files-title" className="mt-1 font-serif text-2xl text-stone-950">
                {files.length
                  ? `${files.length} ${files.length === 1 ? "bilaga" : "bilagor"}`
                  : "Inga bilagor ännu"}
              </h3>
            </div>
            {files.length ? (
              <span className="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-semibold text-stone-500">
                A{verification.verificationNumber}
              </span>
            ) : null}
          </header>

          {removalResult ? (
            <div
              role="status"
              className="border-b border-[#cad8c9] bg-[#f4f8f2] px-4 py-3 text-xs leading-5 text-stone-700 sm:px-6"
            >
              <p>
                <strong>{fallbackVerificationFileLabel(removalResult.name)}</strong> har tagits bort från verifikationen.
              </p>
              {removalResult.warning ? (
                <p className="mt-1 text-amber-800">{removalResult.warning}</p>
              ) : null}
            </div>
          ) : null}

          {files.length > 0 && !removalPolicy.editable ? (
            <p className="border-b border-[#e2d2cb] bg-[#fbf3ef] px-4 py-3 text-xs leading-5 text-stone-600 sm:px-6">
              Sparade bilagor kan inte tas bort. {removalPolicy.reason}
            </p>
          ) : null}

          {files.length ? (
            <ul className="divide-y divide-stone-100">
              {files.map((file, index) => {
                const label = fallbackVerificationFileLabel(file.name);
                const asksForConfirmation = activeRemoval?.path === file.path;
                const confirmationTitle = `remove-file-${verification.verificationNumber}-${index}`;

                return (
                  <li key={file.path}>
                    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:px-6">
                      <a
                        href={file.path}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex min-w-0 flex-1 items-center gap-3 py-1 transition"
                      >
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#e4cec6] bg-[#fbf1ed] text-[#985744]">
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
                            <path d="M7 3.5h7l4 4V20H7z" />
                            <path d="M14 3.5V8h4M9.5 12h6M9.5 15.5h6" />
                          </svg>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-sm font-semibold leading-5 text-stone-800 group-hover:text-[#985744] sm:truncate">
                            {label}
                          </span>
                          <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.13em] text-stone-400">
                            {fileType(file)} · öppnas i ny flik
                          </span>
                        </span>
                        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-stone-400 transition group-hover:bg-[#f3e4de] group-hover:text-[#985744]">
                          <ArrowIcon direction="up-right" />
                        </span>
                      </a>
                      {removalPolicy.editable ? (
                        <button
                          type="button"
                          onClick={() => setFilePendingRemoval(file)}
                          aria-expanded={asksForConfirmation}
                          aria-controls={
                            asksForConfirmation ? confirmationTitle : undefined
                          }
                          className="inline-flex h-10 shrink-0 items-center justify-center self-end rounded-xl border border-stone-200 bg-white px-3 text-xs font-bold text-stone-500 transition hover:border-[#c58a79] hover:bg-[#fffaf7] hover:text-[#985744] sm:self-auto"
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mr-1.5 h-4 w-4">
                            <path d="M5 7h14M9 7V4h6v3M8 10v7M12 10v7M16 10v7M7 7l1 13h8l1-13" />
                          </svg>
                          Ta bort
                        </button>
                      ) : null}
                    </div>

                    {asksForConfirmation ? (
                      <div
                        id={confirmationTitle}
                        role="alertdialog"
                        aria-labelledby={`${confirmationTitle}-heading`}
                        className="border-t border-[#e2d2cb] bg-[#fbf3ef] px-4 py-4 sm:px-6"
                      >
                        <p
                          id={`${confirmationTitle}-heading`}
                          className="text-sm font-bold text-stone-900"
                        >
                          Ta bort {label}?
                        </p>
                        <p className="mt-1 max-w-xl text-xs leading-5 text-stone-600">
                          Bilagan kopplas bort och rensas ur lagringen om ingen annan verifikation använder samma fil. Händelsen sparas i revisionshistoriken.
                        </p>
                        {removalError && submittedRemovalPath === file.path ? (
                          <p role="alert" className="mt-3 border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-800">
                            {removalError}
                          </p>
                        ) : null}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => removeFile(file)}
                            disabled={isRemoving}
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-[#a85f4b] bg-[#a85f4b] px-4 text-xs font-bold text-white transition hover:border-[#8f4f3e] hover:bg-[#8f4f3e] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isRemoving ? "Tar bort…" : "Ja, ta bort bilagan"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setFilePendingRemoval(null)}
                            disabled={isRemoving}
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-stone-300 bg-white px-4 text-xs font-bold text-stone-600 transition hover:border-[#c58a79] hover:text-[#985744] disabled:opacity-50"
                          >
                            Avbryt
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-5 py-10 text-center sm:px-8 sm:py-14">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[#e4cec6] bg-[#fbf1ed] text-2xl text-[#985744]" aria-hidden="true">
                +
              </span>
              <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-stone-500">
                Lägg till kvitto, faktura, kontoutdrag eller Skatteverkets kvittens som underlag.
              </p>
            </div>
          )}
        </section>

        <aside className="order-1 lg:order-2 lg:sticky lg:top-24">
          <section className="overflow-hidden rounded-[1.4rem] border border-[#dfc8bf] bg-[#fffdf9] shadow-[0_12px_35px_rgba(86,52,40,0.08)]">
            <div className="border-b border-[#eadbd4] bg-[#fbf3ef] px-4 py-4 sm:px-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#985744]">
                Ny bilaga
              </p>
              <h3 className="mt-1 font-serif text-2xl text-stone-950">
                Låt dokumentet föreslå namn
              </h3>
              <p className="mt-2 text-xs leading-5 text-stone-600">
                Innehållet läses av, men det du själv skriver ersätts aldrig automatiskt.
              </p>
            </div>

            <div className="space-y-4 p-4 sm:p-5">
              {selectedFile ? (
                <div className="rounded-2xl border border-stone-200 bg-white p-3.5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
                        <path d="M7 3.5h7l4 4V20H7z" />
                        <path d="M14 3.5V8h4" />
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-stone-800">
                        {selectedFile.name}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-stone-400">
                        {formatFileSize(selectedFile.size)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={resetSelection}
                      aria-label="Ta bort vald fil"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-800"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onDragEnter={() => setIsDragging(true)}
                  onDragLeave={() => setIsDragging(false)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                  className={`rounded-2xl border border-dashed p-5 text-center transition sm:p-6 ${
                    isDragging
                      ? "border-[#b86e59] bg-[#fbf1ed]"
                      : "border-stone-300 bg-white hover:border-[#c58a79]"
                  }`}
                >
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fbf1ed] text-[#985744]" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                      <path d="M12 16V5M8 9l4-4 4 4" />
                      <path d="M5 14v5h14v-5" />
                    </svg>
                  </span>
                  <p className="mt-3 text-sm font-semibold text-stone-800">
                    Släpp filen här
                  </p>
                  <p className="mt-1 text-xs leading-5 text-stone-500">
                    PDF eller bild, högst 20 MB
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="relative mt-4 inline-flex h-12 min-w-[13rem] items-center justify-center rounded-2xl border border-[#a85f4b] bg-[#a85f4b] px-12 text-sm font-bold text-white shadow-[0_7px_18px_rgba(126,67,51,0.14)] transition hover:-translate-y-px hover:border-[#8f4f3e] hover:bg-[#8f4f3e] focus:outline-none focus:ring-2 focus:ring-[#d7b0a3] focus:ring-offset-2"
                  >
                    Välj från enheten
                    <span
                      aria-hidden="true"
                      className="absolute right-2.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 text-base"
                    >
                      <ArrowIcon />
                    </span>
                  </button>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={handleFileChange}
              />

              {selectedFile ? (
                <div>
                  <label htmlFor="file-label" className="mb-1.5 block text-xs font-bold text-stone-700">
                    Namn i bokföringen
                  </label>
                  <input
                    id="file-label"
                    type="text"
                    value={label}
                    maxLength={120}
                    autoComplete="off"
                    onChange={(event) => updateLabel(event.target.value, "manual")}
                    placeholder="Exempel: Skattekontoutdrag april 2026"
                    className="h-12 w-full rounded-xl border border-stone-300 bg-white px-4 text-base text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-[#ad644f] focus:ring-2 focus:ring-[#efd8d0] sm:text-sm"
                  />
                  {labelOrigin === "manual" ? (
                    <p className="mt-1.5 text-[11px] leading-4 text-stone-500">
                      Din text ligger kvar även när dokumentanalysen är klar.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {isAnalyzing ? (
                <div className="rounded-2xl border border-[#dfc8bf] bg-[#fbf3ef] p-4" aria-live="polite">
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#eadbd4]">
                    <div className="h-full w-full animate-stripe bg-[repeating-linear-gradient(45deg,_#a85f4b_0px,_#a85f4b_9px,_#cf8e79_9px,_#cf8e79_18px)] bg-[length:120%_100%]" />
                  </div>
                  <p className="mt-3 text-xs font-bold text-[#7d493a]">
                    Läser dokumentet…
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-stone-500">
                    Identifierar dokumenttyp, avsändare och period.
                  </p>
                </div>
              ) : null}

              {suggestion && !isAnalyzing ? (
                <div className="rounded-2xl border border-[#dfc1b7] bg-[#fbf3ef] p-4" aria-live="polite">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#985744]">
                        {analysisStatus === "fallback" ? "Förslag från filnamnet" : "Förslag från dokumentet"}
                      </p>
                      <p className="mt-1.5 text-sm font-bold leading-5 text-stone-900">
                        {suggestion.label}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-[#985744] ring-1 ring-[#e6cec5]">
                      {documentTypeLabels[suggestion.documentType]}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-stone-600">
                    {suggestion.summary}
                  </p>
                  {suggestion.warnings.length ? (
                    <p className="mt-2 text-[11px] leading-4 text-amber-800">
                      {suggestion.warnings.join(" · ")}
                    </p>
                  ) : null}
                  {suggestionMatchesLabel ? (
                    <p className="mt-3 text-[11px] font-bold text-[#985744]">
                      Förslaget används som namn.
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => updateLabel(suggestion.label, "suggestion")}
                      className="mt-3 inline-flex h-10 items-center rounded-xl border border-[#d7b0a3] bg-white px-4 text-xs font-bold text-[#8b4f3e] transition hover:border-[#b86e59] hover:bg-[#fffaf7]"
                    >
                      Använd förslaget
                    </button>
                  )}
                </div>
              ) : null}

              {localError || uploadError ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-800" role="alert">
                  {localError || uploadError}
                </p>
              ) : null}

              {selectedFile ? (
                <div className="grid gap-3 border-t border-stone-200 pt-4">
                  <button
                    type="button"
                    onClick={saveFile}
                    disabled={!label.trim() || isAnalyzing || isUploading}
                    className="relative order-1 inline-flex h-14 w-full items-center justify-center rounded-2xl border border-[#a85f4b] bg-[#a85f4b] px-14 text-sm font-bold text-white shadow-[0_8px_22px_rgba(126,67,51,0.16)] transition hover:-translate-y-px hover:border-[#8f4f3e] hover:bg-[#8f4f3e] focus:outline-none focus:ring-2 focus:ring-[#d7b0a3] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
                  >
                    {isUploading ? "Sparar bilagan…" : "Lägg till bilaga"}
                    {!isUploading ? (
                      <span
                        aria-hidden="true"
                        className="absolute right-3 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/15 text-lg"
                      >
                        <ArrowIcon />
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="order-2 inline-flex h-12 w-full items-center justify-center rounded-2xl border border-stone-300 bg-[#fffdf9] px-5 text-sm font-bold text-stone-700 transition hover:-translate-y-px hover:border-[#c58a79] hover:bg-white hover:text-[#985744] focus:outline-none focus:ring-2 focus:ring-[#e7c8be] focus:ring-offset-2 disabled:opacity-50"
                  >
                    <span aria-hidden="true" className="mr-2 text-base">↻</span>
                    Byt fil
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
