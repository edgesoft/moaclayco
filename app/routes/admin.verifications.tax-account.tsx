import { createHash } from "node:crypto";
import type { ActionFunction, LoaderFunction } from "react-router";
import {
  Link,
  data as json,
  useFetcher,
  useLoaderData,
  useNavigate,
} from "react-router";
import {
  ChangeEvent,
  DragEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import Select from "react-select";
import { z } from "zod";
import ClientOnly from "~/components/ClientOnly";
import JournalEntryAmountField from "~/components/admin/JournalEntryAmountField";
import ArrowIcon from "~/components/ArrowIcon";
import { Verifications } from "~/schemas/verifications";
import { auth } from "~/services/auth.server";
import { interpretTaxAccountStatement } from "~/services/tax-account-document.server";
import {
  deleteUploadedVerificationFile,
  uploadVerificationFile,
  validateVerificationFile,
} from "~/services/verification-files.server";
import {
  createVerificationsBatch,
  ensureIncomingBalance,
} from "~/services/verification.server";
import { accounts } from "~/utils/accounts";
import {
  getAccountingYearBounds,
  parseAccountingDate,
} from "~/utils/accountingDates";
import { sanitizeVerificationFileLabel } from "~/utils/verificationFiles";
import {
  VerificationValidationError,
  normalizeJournalEntries,
} from "~/utils/verificationValidation";
import {
  ReconciledTaxAccountRow,
  TaxAccountBankChoice,
  TaxAccountJournalEntry,
  TaxAccountPosting,
  buildTaxAccountPosting,
  calculateTaxAccountBalance,
  calculateTaxAccountOpeningState,
  reconcileTaxAccountRows,
  taxAccountBankChoices,
} from "~/utils/taxAccountReconciliation";

type LoaderData = {
  year: number;
};

type TaxAccountDraft = {
  documentHash: string;
  fileName: string;
  fileLabel: string;
  statement: {
    accountHolder: string;
    organizationNumber: string;
    accountNumber: string;
    periodStart: string;
    periodEnd: string;
    openingBalance: number;
    closingBalance: number;
    transactionTotal: number;
    warnings: string[];
  };
  rows: ReconciledTaxAccountRow[];
  checks: {
    bookedOpeningBalance: number;
    bookedClosingBalance: number;
    openingDifference: number;
    closingDifference: number;
  };
  summary: {
    booked: number;
    missing: number;
    review: number;
  };
};

type ActionData =
  | { success: true; intent: "parse"; draft: TaxAccountDraft }
  | {
      success: true;
      intent: "commit";
      registeredNumbers: number[];
      linkedCount: number;
      filePath: string;
    }
  | { success: false; intent: "parse" | "commit"; message: string };

type EditablePosting = Omit<TaxAccountPosting, "journalEntries"> & {
  journalEntries: Array<TaxAccountJournalEntry & { editorId: string }>;
};

type EditableRow = Omit<ReconciledTaxAccountRow, "posting"> & {
  posting: EditablePosting | null;
  selected: boolean;
  editorOpen: boolean;
};

type CommitSuccess = Extract<ActionData, { success: true; intent: "commit" }>;
type TaxAccountFilter = "all" | "missing" | "review" | "booked";

type TaxAccountPageState = {
  appliedActionData: ActionData | undefined;
  completion: CommitSuccess | null;
  draft: TaxAccountDraft | null;
  filter: TaxAccountFilter;
  rows: EditableRow[];
};

const roundCurrency = (value: number) => Math.round(Number(value) * 100) / 100;
const formatCurrency = (value: number) =>
  new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
const formatDate = (value: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
const dateKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};
const hashFile = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");

const toReconciliationVerification = (verification: any) => ({
  recordType: verification.recordType,
  description: verification.description,
  verificationNumber: Number(verification.verificationNumber),
  verificationDate: verification.verificationDate,
  metadata: (verification.metadata ?? []).map((entry: any) => ({
    key: String(entry.key),
    value: String(entry.value),
  })),
  journalEntries: (verification.journalEntries ?? []).map((entry: any) => ({
    account: Number(entry.account),
    debit: Number(entry.debit || 0),
    credit: Number(entry.credit || 0),
  })),
});

export const loader: LoaderFunction = async ({ request }) => {
  const user = await auth.isAuthenticated(request, { failureRedirect: "/login" });
  return json({ year: user.fiscalYear });
};

const parseStatement = async ({
  file,
  fiscalYear,
}: {
  file: File;
  fiscalYear: number;
}) => {
  validateVerificationFile(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  const statement = await interpretTaxAccountStatement({
    buffer,
    mimeType: file.type,
    fileName: file.name,
  });
  if (
    Number(statement.periodStart.slice(0, 4)) !== fiscalYear ||
    Number(statement.periodEnd.slice(0, 4)) !== fiscalYear
  ) {
    throw new Error(`Utdraget måste tillhöra bokföringsår ${fiscalYear}`);
  }

  const yearBounds = getAccountingYearBounds(fiscalYear);
  if (!yearBounds) throw new Error("Bokföringsåret är ogiltigt");
  const verifications = await Verifications.find({
    verificationDate: { $gte: yearBounds.start, $lt: yearBounds.end },
  })
    .select(
      "recordType description verificationNumber verificationDate metadata journalEntries"
    )
    .sort({ verificationDate: 1, verificationNumber: 1 })
    .lean()
    .exec();
  const reconciliationVerifications = verifications.map(
    toReconciliationVerification
  );
  const rows = reconcileTaxAccountRows(
    statement.transactions,
    reconciliationVerifications
  );
  const closingVerifications = reconciliationVerifications.filter(
    (verification) => dateKey(verification.verificationDate) <= statement.periodEnd
  );
  const openingState = calculateTaxAccountOpeningState({
    verifications: reconciliationVerifications,
    fiscalYear,
    periodStart: statement.periodStart,
    expectedOpeningBalance: statement.openingBalance,
  });
  const bookedClosing = calculateTaxAccountBalance(closingVerifications);
  const transactionTotal = roundCurrency(
    statement.transactions.reduce((sum, row) => sum + row.amount, 0)
  );

  return {
    documentHash: hashFile(buffer),
    fileName: file.name,
    fileLabel: sanitizeVerificationFileLabel(
      `Skattekonto ${statement.periodStart}–${statement.periodEnd}`
    ),
    statement: {
      accountHolder: statement.accountHolder,
      organizationNumber: statement.organizationNumber,
      accountNumber: statement.accountNumber,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      openingBalance: roundCurrency(statement.openingBalance),
      closingBalance: roundCurrency(statement.closingBalance),
      transactionTotal,
      warnings: statement.warnings,
    },
    rows,
    checks: {
      bookedOpeningBalance: openingState.bookBalance,
      bookedClosingBalance: bookedClosing.total,
      openingDifference: openingState.difference,
      closingDifference: roundCurrency(bookedClosing.total - statement.closingBalance),
    },
    summary: {
      booked: rows.filter((row) => row.status === "booked").length,
      missing: rows.filter((row) => row.status === "missing").length,
      review: rows.filter((row) => row.status === "review").length,
    },
  } satisfies TaxAccountDraft;
};

const journalEntrySchema = z.object({
  account: z.number().int().min(1000).max(9999),
  debit: z.number().min(0),
  credit: z.number().min(0),
});

const commitPayloadSchema = z.object({
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  fileLabel: z.string().min(1).max(255),
  selectedRows: z
    .array(
      z.object({
        id: z.string().min(1).max(180),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        description: z.string().min(1).max(1000),
        sourceReference: z.string().max(500),
        journalEntries: z.array(journalEntrySchema).min(2).max(12),
      })
    )
    .max(250),
  matchedRows: z
    .array(
      z.object({
        id: z.string().min(1).max(180),
        verificationNumber: z.number().int().positive(),
        sourceReference: z.string().max(500),
      })
    )
    .max(250),
});

const commitStatement = async ({
  file,
  rawPayload,
  fiscalYear,
}: {
  file: File;
  rawPayload: string;
  fiscalYear: number;
}) => {
  validateVerificationFile(file);
  const payload = commitPayloadSchema.parse(JSON.parse(rawPayload));
  const buffer = Buffer.from(await file.arrayBuffer());
  if (hashFile(buffer) !== payload.documentHash) {
    throw new Error("PDF-filen är inte samma fil som kontrollerades");
  }
  if (new Set(payload.selectedRows.map((row) => row.id)).size !== payload.selectedRows.length) {
    throw new Error("Samma skattekontorad kan inte bokföras flera gånger");
  }
  if (new Set(payload.matchedRows.map((row) => row.id)).size !== payload.matchedRows.length) {
    throw new Error("Samma skattekontorad kan inte kopplas flera gånger");
  }

  const selectedRows = payload.selectedRows
    .map((row) => {
      const verificationDate = parseAccountingDate(row.date);
      if (!verificationDate || Number(row.date.slice(0, 4)) !== fiscalYear) {
        throw new Error(`Skattekontorad ${row.id} har ett ogiltigt bokföringsdatum`);
      }
      return {
        ...row,
        verificationDate,
        journalEntries: normalizeJournalEntries(row.journalEntries),
      };
    })
    .sort(
      (a, b) =>
        a.verificationDate.getTime() - b.verificationDate.getTime() ||
        a.id.localeCompare(b.id)
    );

  const matchedNumbers = Array.from(
    new Set(payload.matchedRows.map((row) => row.verificationNumber))
  );
  if (matchedNumbers.length) {
    const matchedCount = await Verifications.countDocuments({
      verificationNumber: { $in: matchedNumbers },
    });
    if (matchedCount !== matchedNumbers.length) {
      throw new Error("En matchad verifikation finns inte längre");
    }
  }

  const safeFileLabel = sanitizeVerificationFileLabel(payload.fileLabel);
  const previousSource = await Verifications.findOne({
    metadata: {
      $elemMatch: { key: "taxAccountDocument", value: payload.documentHash },
    },
    files: { $elemMatch: { name: safeFileLabel } },
  })
    .select("files")
    .lean()
    .exec();
  const previousFile = (previousSource as any)?.files?.find(
    (fileEntry: { name?: string }) => fileEntry.name === safeFileLabel
  ) as
    | { name: string; path: string }
    | undefined;
  let uploadedFile: Awaited<ReturnType<typeof uploadVerificationFile>> | null = null;
  let hasDatabaseReference = Boolean(previousFile);

  try {
    if (!previousFile) {
      uploadedFile = await uploadVerificationFile(
        file,
        `tax-account-statements/${fiscalYear}`
      );
    }
    const sourceFile = previousFile ?? {
      name: payload.fileLabel,
      path: uploadedFile!.path,
    };
    const fileReference = {
      name: safeFileLabel,
      path: sourceFile.path,
    };

    if (selectedRows.length) {
      await ensureIncomingBalance(fiscalYear);
    }
    const verificationInputs = selectedRows.map((row) => ({
      description: row.description,
      verificationDate: row.verificationDate,
      journalEntries: row.journalEntries,
      idempotencyKey: `tax-account:${payload.documentHash}:${row.id}`,
      metadata: [
        { key: "taxAccountDocument", value: payload.documentHash },
        { key: "taxAccountRow", value: row.id },
        { key: "taxAccountSourceReference", value: row.sourceReference },
      ],
      files: [fileReference],
    }));
    const saved = await createVerificationsBatch(verificationInputs);
    if (saved.length) hasDatabaseReference = true;

    if (payload.matchedRows.length) {
      const result = await Verifications.bulkWrite(
        payload.matchedRows.map((row) => ({
          updateOne: {
            filter: { verificationNumber: row.verificationNumber },
            update: {
              $addToSet: {
                files: fileReference,
                metadata: {
                  $each: [
                    { key: "taxAccountDocument", value: payload.documentHash },
                    { key: "taxAccountRow", value: row.id },
                    {
                      key: "taxAccountSourceReference",
                      value: row.sourceReference,
                    },
                  ],
                },
              },
            },
          },
        })) as any
      );
      if (result.matchedCount) hasDatabaseReference = true;
    }

    return {
      registeredNumbers: saved.map((verification: any) =>
        Number(verification.verificationNumber)
      ),
      linkedCount: payload.matchedRows.length,
      filePath: sourceFile.path,
    };
  } catch (error) {
    if (uploadedFile && !hasDatabaseReference) {
      await deleteUploadedVerificationFile(uploadedFile.key).catch((cleanupError) =>
        console.error("Kunde inte rensa skattekontofilen", cleanupError)
      );
    }
    throw error;
  }
};

const safeErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof VerificationValidationError) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message || fallback;
  if (error instanceof SyntaxError) return "Registreringen kunde inte läsas";
  if (error instanceof Error && error.message.length < 180) return error.message;
  return fallback;
};

export const action: ActionFunction = async ({ request }) => {
  const user = await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const formData = await request.formData();
  const intent = formData.get("intent");
  const file = formData.get("file");

  if ((intent !== "parse" && intent !== "commit") || !(file instanceof File)) {
    return json(
      { success: false, intent: intent === "commit" ? "commit" : "parse", message: "Välj en PDF från Skatteverket" },
      { status: 400 }
    );
  }

  try {
    if (intent === "parse") {
      const draft = await parseStatement({
        file,
        fiscalYear: user.fiscalYear,
      });
      return json({ success: true, intent, draft });
    }
    const rawPayload = formData.get("payload");
    if (typeof rawPayload !== "string") throw new Error("Registreringen saknas");
    const result = await commitStatement({
      file,
      rawPayload,
      fiscalYear: user.fiscalYear,
    });
    return json({ success: true, intent, ...result });
  } catch (error) {
    console.error(`Tax account ${intent} failed`, {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json(
      {
        success: false,
        intent,
        message: safeErrorMessage(
          error,
          intent === "parse"
            ? "Skattekontoutdraget kunde inte läsas. Kontrollera att PDF-filen kommer från Skatteverket."
            : "Skattekontot kunde inte registreras. Inga nya rader har lagts till."
        ),
      },
      { status: intent === "parse" ? 422 : 400 }
    );
  }
};

const toEditablePosting = (
  rowId: string,
  posting: TaxAccountPosting | null
): EditablePosting | null =>
  posting
    ? {
        ...posting,
        journalEntries: posting.journalEntries.map((entry, entryPosition) => ({
          ...entry,
          editorId: `${rowId}:entry:${entryPosition + 1}`,
        })),
      }
    : null;

const createEditableRows = (draft: TaxAccountDraft): EditableRow[] =>
  draft.rows.map((row) => {
    const fallbackPosting =
      row.posting || row.kind !== "other"
        ? row.posting
        : {
            description: row.description,
            journalEntries:
              row.amount > 0
                ? [
                    { account: 2012, debit: Math.abs(row.amount), credit: 0 },
                    { account: 0, debit: 0, credit: Math.abs(row.amount) },
                  ]
                : [
                    { account: 0, debit: Math.abs(row.amount), credit: 0 },
                    { account: 2012, debit: 0, credit: Math.abs(row.amount) },
                  ],
          };
    return {
      ...row,
      posting: toEditablePosting(row.id, fallbackPosting),
      selected:
        row.status === "missing" &&
        Boolean(row.posting) &&
        (!row.needsBankChoice || Boolean(row.bankChoice)),
      editorOpen: row.kind === "other",
    };
  });

const createEmptyPageState = (
  appliedActionData: ActionData | undefined
): TaxAccountPageState => ({
  appliedActionData,
  completion: null,
  draft: null,
  filter: "all",
  rows: [],
});

const applyActionData = (
  current: TaxAccountPageState,
  actionData: ActionData | undefined
): TaxAccountPageState => {
  if (current.appliedActionData === actionData) return current;
  if (actionData?.success && actionData.intent === "parse") {
    return {
      appliedActionData: actionData,
      completion: null,
      draft: actionData.draft,
      filter: actionData.draft.summary.missing ? "missing" : "all",
      rows: createEditableRows(actionData.draft),
    };
  }
  if (actionData?.success && actionData.intent === "commit") {
    return {
      ...current,
      appliedActionData: actionData,
      completion: actionData,
    };
  }
  return { ...current, appliedActionData: actionData };
};

const statusLabel = (status: EditableRow["status"]) => {
  if (status === "booked") return "Redan bokförd";
  if (status === "review") return "Kontrollera";
  return "Saknas";
};

function TaxAccountRowCard({
  row,
  onChange,
}: {
  row: EditableRow;
  onChange: (row: EditableRow) => void;
}) {
  const selectedBank = taxAccountBankChoices.find(
    (choice) => choice.id === row.bankChoice
  );
  const updatePostingEntry = (
    index: number,
    key: keyof TaxAccountJournalEntry,
    value: number
  ) => {
    if (!row.posting) return;
    const journalEntries = row.posting.journalEntries.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [key]: value } : entry
    );
    onChange({ ...row, posting: { ...row.posting, journalEntries } });
  };
  const updatePostingAmount = (
    index: number,
    amounts: Pick<TaxAccountJournalEntry, "debit" | "credit">
  ) => {
    if (!row.posting) return;
    const journalEntries = row.posting.journalEntries.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, ...amounts } : entry
    );
    onChange({ ...row, posting: { ...row.posting, journalEntries } });
  };

  return (
    <article
      className={`tax-account-row tax-account-row--${row.status} ${
        row.status === "missing" && !row.selected
          ? "tax-account-row--skipped"
          : ""
      }`}
    >
      <div className="tax-account-row__main">
        <div className="tax-account-row__date">
          <span>{formatDate(row.date).split(" ")[0]}</span>
          <small>{formatDate(row.date).split(" ").slice(1).join(" ")}</small>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-sm font-semibold text-stone-900 sm:text-[15px]">
              {row.description}
            </p>
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-400">
              {row.kindLabel}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-stone-500">
            {row.sourceReference && row.sourceReference !== row.description
              ? row.sourceReference
              : row.balanceAfter !== null
              ? `Saldo efter raden ${formatCurrency(row.balanceAfter)}`
              : "Rad från Skatteverkets kontoutdrag"}
          </p>
        </div>
        <div className={`tax-account-row__amount ${row.amount < 0 ? "is-negative" : ""}`}>
          {row.amount > 0 ? "+" : "−"}
          {formatCurrency(Math.abs(row.amount))}
        </div>
        <div className={`tax-account-status tax-account-status--${row.status}`}>
          <span aria-hidden="true" />
          {statusLabel(row.status)}
        </div>
      </div>

      {row.status === "booked" && row.match ? (
        <div className="tax-account-row__detail">
          <p className="text-xs leading-5 text-stone-600">
            Matchar verifikation{" "}
            <Link
              to={`/admin/verifications/${row.match.verificationNumber}/files`}
              className="font-bold text-[#985744] underline decoration-[#d8b8ae] underline-offset-4"
            >
              A{row.match.verificationNumber}
            </Link>
            . PDF:en kopplas till den när du slutför kontrollen.
          </p>
        </div>
      ) : null}

      {row.status === "review" && row.match ? (
        <div className="tax-account-row__detail tax-account-row__detail--warning">
          <div>
            <p className="text-xs font-bold text-amber-950">
              Belopp och datum liknar A{row.match.verificationNumber}, men konteringen avviker.
            </p>
            <p className="mt-1 text-xs leading-5 text-amber-900/75">
              Raden bokförs inte automatiskt. Öppna verifikationen och kontrollera den innan en eventuell rättelse.
            </p>
          </div>
          <Link
            to={`/admin/verifications/${row.match.verificationNumber}/files`}
            className="accounting-secondary-action shrink-0"
          >
            Granska A{row.match.verificationNumber}
          </Link>
        </div>
      ) : null}

      {row.status === "missing" ? (
        <div className="tax-account-row__detail space-y-4">
          {row.needsBankChoice ? (
            <fieldset>
              <legend className="text-xs font-bold text-stone-800">
                {row.kind === "deposit"
                  ? "Varifrån betalades pengarna in?"
                  : "Vart betalades pengarna ut?"}
              </legend>
              <p className="mt-1 text-xs leading-5 text-stone-500">
                Skattekontot är redan känt. Välj bara det verkliga bankkonto som pengarna passerade.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {taxAccountBankChoices.map((choice) => {
                  const active = choice.id === row.bankChoice;
                  return (
                    <button
                      key={choice.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        const posting = toEditablePosting(
                          row.id,
                          buildTaxAccountPosting(
                            row,
                            choice.id as TaxAccountBankChoice
                          )
                        );
                        onChange({
                          ...row,
                          bankChoice: choice.id,
                          posting,
                          selected: row.selected,
                        });
                      }}
                      className={`tax-account-bank-choice ${
                        active ? "tax-account-bank-choice--active" : ""
                      }`}
                    >
                      <span className="tax-account-bank-choice__mark" aria-hidden="true" />
                      <span className="min-w-0 text-left">
                        <strong>{choice.name}</strong>
                        <small>{choice.detail}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {row.posting ? (
            <div className="flex flex-col gap-3 border-t border-stone-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-stone-800">
                  {row.posting.description}
                </p>
                {row.selected ? (
                  <p className="mt-1 text-xs text-stone-500">
                    {row.posting.journalEntries
                      .map((entry) => {
                        const side = entry.debit > 0 ? "D" : "K";
                        return `${side} ${entry.account || "välj konto"}`;
                      })
                      .join(" · ")}
                    {selectedBank ? ` · ${selectedBank.name} ${selectedBank.masked}` : ""}
                  </p>
                ) : (
                  <p className="tax-account-skipped-note mt-1">
                    <span aria-hidden="true" />
                    Bokförs inte nu
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChange({ ...row, editorOpen: !row.editorOpen })}
                  className="tax-account-text-action"
                >
                  {row.editorOpen ? "Dölj kontering" : "Ändra kontering"}
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ ...row, selected: !row.selected })}
                  className={`tax-account-skip-action ${
                    row.selected ? "" : "tax-account-skip-action--restore"
                  }`}
                >
                  {row.selected ? "Hoppa över raden" : "Ta med raden igen"}
                </button>
              </div>
            </div>
          ) : null}

          {row.editorOpen && row.posting ? (
            <div className="tax-account-editor">
              <label className="block">
                <span className="tax-account-field-label">Beskrivning</span>
                <input
                  type="text"
                  value={row.posting.description}
                  onChange={(event) =>
                    onChange({
                      ...row,
                      posting: { ...row.posting!, description: event.target.value },
                    })
                  }
                  className="tax-account-input"
                />
              </label>
              <div className="mt-3 space-y-2">
                {row.posting.journalEntries.map((entry, index) => (
                  <div
                    key={entry.editorId}
                    className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_minmax(250px,.8fr)]"
                  >
                    <div className="min-w-0">
                      <span className="tax-account-field-label">Konto</span>
                      <ClientOnly fallback={<div className="h-12 bg-stone-100" />}>
                        {() => (
                          <Select
                            instanceId={`${entry.editorId}-account`}
                            options={accounts}
                            value={accounts.find((account) => account.value === entry.account) || null}
                            onChange={(option) =>
                              updatePostingEntry(index, "account", option?.value || 0)
                            }
                            placeholder="Sök BAS-konto"
                            className="text-sm"
                            classNamePrefix="verification-account"
                          />
                        )}
                      </ClientOnly>
                    </div>
                    <JournalEntryAmountField
                      id={`tax-account-entry-${entry.editorId}`}
                      debit={entry.debit}
                      credit={entry.credit}
                      onChange={(amounts) => updatePostingAmount(index, amounts)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default function TaxAccountPage() {
  const { year } = useLoaderData<LoaderData>();
  const fetcher = useFetcher<ActionData>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pageState, setPageState] = useState<TaxAccountPageState>(() =>
    createEmptyPageState(undefined)
  );

  const actionData = fetcher.data;
  const isWorking = fetcher.state !== "idle";
  const submittedIntent = fetcher.formData?.get("intent");
  const activeIntent =
    isWorking && (submittedIntent === "parse" || submittedIntent === "commit")
      ? submittedIntent
      : null;

  if (pageState.appliedActionData !== actionData) {
    setPageState((current) => applyActionData(current, actionData));
  }

  const { completion, draft, filter, rows } = pageState;

  const submitFile = (file: File) => {
    const formData = new FormData();
    formData.append("intent", "parse");
    formData.append("file", file);
    setSelectedFile(file);
    setPageState(createEmptyPageState(actionData));
    fetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
  };

  const visibleRows = useMemo(
    () => rows.filter((row) => filter === "all" || row.status === filter),
    [filter, rows]
  );
  const selectedRows = rows.filter(
    (row) => row.status === "missing" && row.selected && row.posting
  );
  const unresolvedRows = rows.filter(
    (row) =>
      row.status === "missing" &&
      (!row.posting ||
        row.posting.journalEntries.some((entry) => entry.account < 1000))
  );
  const skippedRows = rows.filter(
    (row) => row.status === "missing" && !row.selected && Boolean(row.posting)
  );
  const updateRow = (updated: EditableRow) =>
    setPageState((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.id === updated.id ? updated : row
      ),
    }));

  const commit = () => {
    if (!selectedFile || !draft) return;
    let preparedRows;
    try {
      preparedRows = selectedRows.map((row) => ({
        id: row.id,
        date: row.date,
        description: row.posting!.description,
        sourceReference: row.sourceReference,
        journalEntries: normalizeJournalEntries(row.posting!.journalEntries),
      }));
    } catch {
      setPageState((current) => ({
        ...current,
        rows: current.rows.map((row) =>
          row.selected ? { ...row, editorOpen: true } : row
        ),
      }));
      return;
    }
    const payload = {
      documentHash: draft.documentHash,
      fileLabel: draft.fileLabel,
      selectedRows: preparedRows,
      matchedRows: rows
        .filter((row) => row.status === "booked" && row.match)
        .map((row) => ({
          id: row.id,
          verificationNumber: row.match!.verificationNumber,
          sourceReference: row.sourceReference,
        })),
    };
    const formData = new FormData();
    formData.append("intent", "commit");
    formData.append("file", selectedFile);
    formData.append("payload", JSON.stringify(payload));
    fetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
  };

  const reset = () => {
    setSelectedFile(null);
    setPageState(createEmptyPageState(actionData));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (completion) {
    return (
      <section className="tax-account-complete" aria-labelledby="tax-account-complete-title">
        <div className="tax-account-complete__mark" aria-hidden="true">✓</div>
        <p className="accounting-kicker text-xs font-bold uppercase tracking-[0.14em]">
          Skattekontot är klart
        </p>
        <h2 id="tax-account-complete-title" className="mt-3 text-3xl text-stone-950 sm:text-4xl">
          Underlaget är kopplat och konteringen har slagit igenom.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-stone-500">
          {completion.registeredNumbers.length
            ? `${completion.registeredNumbers.length} verifikationer registrerades: ${completion.registeredNumbers
                .map((number) => `A${number}`)
                .join(", ")}. `
            : "Inga nya verifikationer behövdes. "}
          PDF-filen sparades en gång och kopplades till {completion.linkedCount} redan bokförda poster.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => navigate("/admin/verifications")} className="accounting-primary-action">
            Visa verifikationer
          </button>
          <button type="button" onClick={reset} className="accounting-secondary-action">
            Kontrollera ett nytt utdrag
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="tax-account-title" className="tax-account-view">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="accounting-kicker text-xs font-bold uppercase tracking-[0.14em]">
            Avstämning
          </p>
          <h2 id="tax-account-title" className="mt-2 text-3xl text-stone-950 sm:text-4xl">
            Skattekonto
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
            Ladda upp Skatteverkets PDF för {year}. Vi läser saldokedjan, hittar redan bokförda poster och förbereder bara det som återstår.
          </p>
        </div>
        {draft ? (
          <button type="button" onClick={reset} className="accounting-secondary-action self-start sm:self-auto">
            Byt PDF
          </button>
        ) : null}
      </div>

      {actionData && !actionData.success ? (
        <div className="tax-account-message tax-account-message--error" role="alert">
          <strong>{actionData.intent === "parse" ? "PDF-filen kunde inte kontrolleras" : "Registreringen kunde inte slutföras"}</strong>
          <span>{actionData.message}</span>
        </div>
      ) : null}

      {!draft ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,.6fr)]">
          <div
            className={`tax-account-dropzone ${isWorking ? "tax-account-dropzone--working" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (file && !isWorking) submitFile(file);
            }}
          >
            <div className="tax-account-document-icon" aria-hidden="true">
              <svg viewBox="0 0 48 56" fill="none">
                <path d="M10 1h20l9 10v37a7 7 0 0 1-7 7H10a7 7 0 0 1-7-7V8a7 7 0 0 1 7-7Z" />
                <path d="M30 1v10h9M12 24h18M12 32h18M12 40h11" />
              </svg>
            </div>
            {isWorking && activeIntent === "parse" ? (
              <>
                <p className="mt-5 text-xl text-stone-950">Läser hela skattekontot…</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-stone-500">
                  Vi kontrollerar transaktioner, saldon och tidigare verifikationer. Det kan ta någon minut för en längre PDF.
                </p>
                <div className="tax-account-progress mt-6" aria-hidden="true"><span /></div>
              </>
            ) : (
              <>
                <p className="mt-5 text-xl text-stone-950">Släpp Skatteverkets PDF här</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-stone-500">
                  Kontoutdraget används som gemensamt underlag för alla rader. PDF, högst 20 MB.
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="accounting-primary-action mt-6"
                >
                  <span aria-hidden="true" className="mr-2"><ArrowIcon direction="up" /></span>
                  Välj PDF
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const file = event.target.files?.[0];
                    if (file) submitFile(file);
                  }}
                />
              </>
            )}
          </div>

          <aside className="tax-account-guide">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#985744]">
              Tre lugna steg
            </p>
            <ol className="mt-4 space-y-5">
              {[
                ["01", "Vi läser saldot", "Ingående saldo, varje transaktion och utgående saldo måste bilda en obruten kedja."],
                ["02", "Vi jämför bokföringen", "Redan bokförda rader lämnas orörda. Avvikelser markeras för granskning."],
                ["03", "Du godkänner resten", "Bara vid in- och utbetalningar väljer du vilket av Moas verkliga bankkonton som användes."],
              ].map(([number, title, text]) => (
                <li key={number} className="grid grid-cols-[2.3rem_1fr] gap-3">
                  <span className="font-serif text-lg text-[#b86e59]">{number}</span>
                  <span>
                    <strong className="block text-sm text-stone-900">{title}</strong>
                    <small className="mt-1 block text-xs leading-5 text-stone-500">{text}</small>
                  </span>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      ) : (
        <div className="space-y-5">
          <section className="tax-account-source">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#985744]">Kontrollerat underlag</p>
              <h3 className="mt-1 truncate text-lg text-stone-950">{draft.fileName}</h3>
              <p className="mt-1 text-xs leading-5 text-stone-500">
                {draft.statement.accountHolder || "Kontohavare saknas"}
                {draft.statement.organizationNumber ? ` · ${draft.statement.organizationNumber}` : ""}
                {draft.statement.accountNumber ? ` · Skattekonto ${draft.statement.accountNumber}` : ""}
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-400">Period</p>
              <p className="mt-1 text-sm font-semibold text-stone-800">
                {formatDate(draft.statement.periodStart)}–{formatDate(draft.statement.periodEnd)}
              </p>
            </div>
          </section>

          <section className="tax-account-balance" aria-label="Saldokontroll">
            <div>
              <span>Ingående saldo</span>
              <strong>{formatCurrency(draft.statement.openingBalance)}</strong>
            </div>
            <span className="tax-account-balance__operator" aria-hidden="true">+</span>
            <div>
              <span>Periodens förändring</span>
              <strong>{formatCurrency(draft.statement.transactionTotal)}</strong>
            </div>
            <span className="tax-account-balance__operator" aria-hidden="true">=</span>
            <div>
              <span>Utgående saldo</span>
              <strong>{formatCurrency(draft.statement.closingBalance)}</strong>
            </div>
            <div className="tax-account-balance__check">
              <span aria-hidden="true">✓</span>
              PDF:ens saldokedja stämmer
            </div>
          </section>

          {draft.checks.openingDifference !== 0 ? (
            <div className="tax-account-message tax-account-message--warning">
              <strong>Bokföringens ingående skattekontosaldo avviker med {formatCurrency(Math.abs(draft.checks.openingDifference))}</strong>
              <span>
                PDF:en visar {formatCurrency(draft.statement.openingBalance)}, medan konto 2012 visar {formatCurrency(draft.checks.bookedOpeningBalance)}. Raderna nedan kan fortfarande granskas, men årets IB bör kontrolleras separat.
              </span>
            </div>
          ) : null}

          <div className="tax-account-review-head">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#985744]">Rad för rad</p>
              <h3 className="mt-1 text-2xl text-stone-950">{rows.length} transaktioner kontrollerade</h3>
            </div>
            <div className="tax-account-filters" role="group" aria-label="Filtrera transaktioner">
              {([
                ["all", "Alla", rows.length],
                ["missing", "Saknas", rows.filter((row) => row.status === "missing").length],
                ["review", "Kontrollera", rows.filter((row) => row.status === "review").length],
                ["booked", "Bokförda", rows.filter((row) => row.status === "booked").length],
              ] as const).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() =>
                    setPageState((current) => ({
                      ...current,
                      filter: value,
                    }))
                  }
                  className={filter === value ? "is-active" : ""}
                >
                  {label} <span>{count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {visibleRows.map((row) => (
              <TaxAccountRowCard key={row.id} row={row} onChange={updateRow} />
            ))}
          </div>

          <section className="tax-account-submit">
            <div>
              <p className="text-sm font-semibold text-stone-900">
                {selectedRows.length
                  ? `${selectedRows.length} ${selectedRows.length === 1 ? "rad" : "rader"} redo att bokföras`
                  : "Inga nya rader valda"}
              </p>
              <p className="mt-1 text-xs leading-5 text-stone-500">
                {skippedRows.length
                  ? `${skippedRows.length} ${
                      skippedRows.length === 1 ? "rad bokförs" : "rader bokförs"
                    } inte nu.`
                  : unresolvedRows.length
                  ? `${unresolvedRows.length} ${
                      unresolvedRows.length === 1 ? "rad behöver" : "rader behöver"
                    } ett konto eller en manuell kontering.`
                  : "Original-PDF:en sparas en gång och länkas till berörda verifikationer."}
              </p>
            </div>
            <button
              type="button"
              onClick={commit}
              disabled={isWorking || (!selectedRows.length && !draft.summary.booked)}
              className="accounting-primary-action disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isWorking && activeIntent === "commit"
                ? "Registrerar…"
                : selectedRows.length
                ? `Bokför ${selectedRows.length} ${selectedRows.length === 1 ? "rad" : "rader"}`
                : "Koppla underlaget"}
              <span aria-hidden="true" className="ml-3"><ArrowIcon /></span>
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
