import type { ChangeEvent, DragEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import type { ActionFunction, LoaderFunction } from "react-router";
import { data as json } from "react-router";
import { Verifications } from "~/schemas/verifications";
import { getDomain } from "~/utils/domain";
import { auth } from "~/services/auth.server";
import {
  deleteUploadedVerificationFile,
  MAX_VERIFICATION_REQUEST_SIZE,
  readVerifiedVerificationFile,
  uploadVerificationFile,
  validateVerificationFile,
} from "~/services/verification-files.server";
import {
  fallbackVerificationFileLabel,
  sanitizeVerificationFileLabel,
} from "~/utils/verificationFiles";
import { toLoaderData } from "~/utils/loaderData";
import {
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";

type VerificationFile = { name: string; path: string };

type FilesLoaderData = {
  verification: {
    verificationNumber: number;
    description: string;
    verificationDate: string;
    files: VerificationFile[];
  };
};

type FilesActionData =
  | { success: true; name: string; path: string }
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

export const loader: LoaderFunction = async ({ params, request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const verificationNumber = Number(params.verificationNumber);
  if (!Number.isInteger(verificationNumber)) {
    throw new Response("Ogiltigt verifikationsnummer", { status: 400 });
  }

  const domain = getDomain(request);
  const verification = (await Verifications.findOne({
    domain: domain?.domain,
    verificationNumber,
  })
    .select("verificationNumber description verificationDate files")
    .lean()) as unknown as {
      verificationNumber: number;
      description: string;
      verificationDate: Date;
      files: VerificationFile[];
    } | null;

  if (!verification) throw new Response("Not Found", { status: 404 });

  return json(toLoaderData({
    verification: {
      verificationNumber: verification.verificationNumber,
      description: verification.description,
      verificationDate: verification.verificationDate,
      files: verification.files || [],
    },
  }));
};

export const action: ActionFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
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
  const domain = getDomain(request);
  const file = formData.get("file");
  const verificationNumber = Number(params.verificationNumber);

  if (!(file instanceof File) || !Number.isInteger(verificationNumber)) {
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
      { verificationNumber, domain: domain?.domain },
      { $push: { files: { name: label, path: uploadedFile.path } } }
    );

    if (updateResult.modifiedCount !== 1) {
      throw new Error("Verifikationen kunde inte uppdateras");
    }

    return json({ success: true, name: label, path: uploadedFile.path });
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
  const { verification } = useLoaderData<FilesLoaderData>();
  const uploadFetcher = useFetcher<FilesActionData>();
  const analysisFetcher = useFetcher<LabelAnalysisData>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handledAnalysisRef = useRef<string | null>(null);
  const activeAnalysisKeyRef = useRef<string | null>(null);
  const labelRef = useRef("");
  const labelOriginRef = useRef<LabelOrigin>(null);
  const [files, setFiles] = useState<VerificationFile[]>(verification.files || []);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [labelOrigin, setLabelOrigin] = useState<LabelOrigin>(null);
  const [suggestion, setSuggestion] = useState<FileLabelSuggestion | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [localError, setLocalError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const updateLabel = useCallback((value: string, origin: LabelOrigin) => {
    labelRef.current = value;
    labelOriginRef.current = origin;
    setLabel(value);
    setLabelOrigin(origin);
  }, []);

  const resetSelection = useCallback(() => {
    setSelectedFile(null);
    setSuggestion(null);
    setAnalysisStatus("idle");
    activeAnalysisKeyRef.current = null;
    setLocalError(null);
    setUploadError(null);
    updateLabel("", null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [updateLabel]);

  useEffect(() => {
    const response = uploadFetcher.data;
    if (response && "success" in response && response.success) {
      setFiles((current) => [
        ...current,
        { name: response.name, path: response.path },
      ]);
      resetSelection();
    } else if (response && "error" in response) {
      setUploadError(response.error);
    }
  }, [resetSelection, uploadFetcher.data]);

  useEffect(() => {
    const response = analysisFetcher.data;
    if (!response || handledAnalysisRef.current === response.requestId) return;
    handledAnalysisRef.current = response.requestId;
    if (response.analysisKey !== activeAnalysisKeyRef.current) return;

    if (response.status === "failed") {
      setAnalysisStatus("failed");
      setLocalError(response.error);
      return;
    }

    setSuggestion(response.suggestion);
    setAnalysisStatus(response.status);
    if (!labelRef.current.trim()) {
      updateLabel(response.suggestion.label, "suggestion");
    }
  }, [analysisFetcher.data, updateLabel]);

  const analyzeFile = (file: File) => {
    setLocalError(null);
    setUploadError(null);
    if (
      file.type !== "application/pdf" &&
      !file.type.startsWith("image/")
    ) {
      setLocalError("Välj en PDF eller bildfil.");
      return;
    }
    if (file.size <= 0 || file.size > MAX_CLIENT_FILE_SIZE) {
      setLocalError("Filen är tom eller större än 20 MB.");
      return;
    }

    setSelectedFile(file);
    setSuggestion(null);
    setAnalysisStatus("loading");
    if (labelOriginRef.current !== "manual") updateLabel("", null);

    const formData = new FormData();
    const analysisKey = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    activeAnalysisKeyRef.current = analysisKey;
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
    setUploadError(null);
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("label", label);
    uploadFetcher.submit(formData, {
      method: "post",
      action: `/admin/verifications/${verification.verificationNumber}/files`,
      encType: "multipart/form-data",
    });
  };

  const isUploading = uploadFetcher.state !== "idle";
  const isAnalyzing = analysisStatus === "loading";
  const suggestionMatchesLabel =
    Boolean(suggestion) && suggestion?.label.trim() === label.trim();

  return (
    <section aria-labelledby="files-title" className="pb-20">
      <header className="border-b border-stone-200 pb-5 sm:pb-7">
        <Link
          to="/admin/verifications"
          className="inline-flex h-10 items-center rounded-lg px-1 text-xs font-bold text-stone-500 transition hover:text-stone-950"
        >
          <span aria-hidden="true" className="mr-2">←</span>
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

          {files.length ? (
            <ul className="divide-y divide-stone-100">
              {files.map((file, index) => (
                <li key={`${file.path}-${index}`}>
                  <a
                    href={file.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 px-4 py-4 transition hover:bg-[#fdf8f5] sm:px-6"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#e4cec6] bg-[#fbf1ed] text-[#985744]">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
                        <path d="M7 3.5h7l4 4V20H7z" />
                        <path d="M14 3.5V8h4M9.5 12h6M9.5 15.5h6" />
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-semibold leading-5 text-stone-800 group-hover:text-[#985744] sm:truncate">
                        {fallbackVerificationFileLabel(file.name)}
                      </span>
                      <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.13em] text-stone-400">
                        {fileType(file)} · öppnas i ny flik
                      </span>
                    </span>
                    <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-stone-400 transition group-hover:bg-[#f3e4de] group-hover:text-[#985744]">
                      ↗
                    </span>
                  </a>
                </li>
              ))}
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
                      →
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
                        →
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
