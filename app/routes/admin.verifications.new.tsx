import {
  useActionData,
  useFetcher,
  useNavigate,
  useOutletContext,
  useSubmit,
} from "react-router";
import {
  ChangeEvent,
  DragEvent,
  MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { z, ZodError } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "react-toastify";
import Select from "react-select";
import { accounts } from "~/utils/accounts";
import { Verifications } from "~/schemas/verifications";
import { ActionFunction, data as json } from "react-router";
import ClientOnly from "~/components/ClientOnly";
import { getDomain } from "~/utils/domain";
import { loader as rootLoader } from "~/root";
import { auth } from "~/services/auth.server";
import { createVerification, ensureIncomingBalance } from "~/services/verification.server";
import {
  accountingDateKey,
  accountingMonthKey,
  accountingYear,
  parseAccountingDate,
} from "~/utils/accountingDates";
import {
  deleteUploadedVerificationFile,
  uploadVerificationFile,
  validateVerificationFile,
} from "~/services/verification-files.server";
import { AccountingDateField } from "~/components/admin/AccountingDateField";
import {
  hasMeaningfulVerificationInput,
  sanitizeVerificationFileLabel,
} from "~/utils/verificationFiles";
import { VerificationValidationError } from "~/utils/verificationValidation";

const formSchema = z.object({
  description: z.string().min(1, "Beskrivning är obligatorisk"),
  verificationDate: z.string().nonempty("Datum är obligatoriskt"),
  journalEntries: z
    .array(
      z.object({
        account: z.number().min(1, "Konto är obligatoriskt"),
        debit: z.preprocess(
          (v) => (v === "" || v === null ? 0 : parseFloat(v as string)),
          z.number().min(0, "Debet måste vara ett tal")
        ),
        credit: z.preprocess(
          (v) => (v === "" || v === null ? 0 : parseFloat(v as string)),
          z.number().min(0, "Kredit måste vara ett tal")
        ),
      })
    )
    .min(2, "Du måste lägga till minst två konteringsrader")
    .refine(
      (entries) =>
        entries.every(
          (entry) =>
            (entry.debit > 0 && entry.credit === 0) ||
            (entry.credit > 0 && entry.debit === 0)
        ),
      {
        message: "Varje rad måste ha belopp på exakt en av debet eller kredit",
      }
    ),
});

type FormData = z.infer<typeof formSchema>;

type AccountEntry = {
  debit?: number;
  credit?: number;
};

type VerificationData = {
  description: string;
  date: string;
  accounts: { [accountNumber: string]: AccountEntry };
};

type SuggestedVerificationData = VerificationData & {
  confidence?: number;
  warnings?: string[];
  sourceReference?: string;
};

type SuggestionProps = {
  status: string;
  verificationData: SuggestedVerificationData | null;
  suggestions?: SuggestedVerificationData[];
  file?: { label: string };
  document?: { type: string; warnings: string[] };
  uuid: string;
};

export const loader = rootLoader;

const FileUpload = ({
  onSuggestionsReceived,
  onFileSelected,
}: {
  onSuggestionsReceived: (suggestions: SuggestionProps) => void;
  onFileSelected: (file: File) => void; // Definiera en typ för callback-funktionen
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher<SuggestionProps>();
  const handledUuidRef = useRef<string | null>(null);

  useEffect(() => {
    const response = fetcher.data;
    if (!response || handledUuidRef.current === response.uuid) return;

    handledUuidRef.current = response.uuid;
    onSuggestionsReceived(response);
  }, [fetcher.data, onSuggestionsReceived]);

  const submitFile = (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    onFileSelected(file);
    fetcher.submit(formData, {
      action: "/admin/verifications/files/parse",
      method: "post",
      encType: "multipart/form-data",
    });
  };

  const handleFileInputClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.target.files?.[0];
    if (file) {
      submitFile(file);
      event.target.value = "";
    }
  };

  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) submitFile(file);
      }}
      className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center transition hover:border-emerald-400 hover:bg-emerald-50/40 sm:p-7"
    >
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-lg font-bold text-emerald-800" aria-hidden="true">
        ↑
      </div>
      <p className="mt-3 text-sm font-bold text-slate-900">
        Ladda upp ett underlag
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        PDF eller bild. Vi läser in datum, beskrivning och föreslagen kontering.
      </p>
      <button
        type="button"
        onClick={handleFileInputClick}
        className="relative mt-4 inline-flex h-12 min-w-[13rem] items-center justify-center rounded-2xl border border-[#a85f4b] bg-[#a85f4b] px-12 text-sm font-bold text-white shadow-[0_7px_18px_rgba(126,67,51,0.14)] transition hover:-translate-y-px hover:border-[#8f4f3e] hover:bg-[#8f4f3e] focus:outline-none focus:ring-2 focus:ring-[#d7b0a3] focus:ring-offset-2"
      >
        Välj fil från enheten
        <span
          aria-hidden="true"
          className="absolute right-2.5 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 text-base"
        >
          →
        </span>
      </button>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="application/pdf,image/*"
      />
    </div>
  );
};

const showVATToast = (
  account: number,
  devide: number,
  onConfirm: () => void,
  onCancel: () => void
) => {
  toast(
    <div>
      <p className="text-sm font-bold text-stone-900">Fördela moms?</p>
      <p className="mt-1 text-xs font-medium leading-5 text-stone-500">
        Konto {account} har momskonto {devide}.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            onConfirm();
            toast.dismiss(); // Stäng toasten efter valet
          }}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-[#a85f4b] bg-[#a85f4b] px-3.5 text-xs font-bold text-white transition hover:border-[#8f4f3e] hover:bg-[#8f4f3e]"
        >
          Ja, fördela
        </button>
        <button
          type="button"
          onClick={() => {
            onCancel();
            toast.dismiss(); // Stäng toasten efter valet
          }}
          className="inline-flex h-9 items-center justify-center rounded-lg border border-stone-300 bg-[#fffdf9] px-3.5 text-xs font-bold text-stone-600 transition hover:border-[#c58a79] hover:text-[#985744]"
        >
          Utan moms
        </button>
      </div>
    </div>,
    {
      position: "top-right",
      autoClose: false, // Tillåt att toasten stannar kvar tills användaren väljer
      closeOnClick: false,
      draggable: false,
      hideProgressBar: true,
      pauseOnHover: false,
    }
  );
};

type ActionData =
  | {
      success: true;
      message: string;
      errors: { [key: string]: string };
      verification: {
        description: string;
        verificationNumber: number;
        verificationDate: Date;
        journalEntries: Array<{
          account: number;
          debit: number;
          credit: number;
        }>;
        files: Array<{
          name: string;
          path: string;
        }>;
      };
    }
  | {
      success: false;
      errors: { [key: string]: string };
    };

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const domain = getDomain(request);
  const user = await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });

  if (!domain) throw new Error("Could not find domain");
  const description = formData.get("description");
  const verificationDate = formData.get("verificationDate");
  const rawJournalEntries = formData.get("journalEntries");
  let journalEntries: FormData["journalEntries"];
  try {
    journalEntries = JSON.parse(
      typeof rawJournalEntries === "string" ? rawJournalEntries : ""
    ) as FormData["journalEntries"];
  } catch {
    return json(
      {
        success: false,
        errors: { journalEntries: "Konteringsraderna kunde inte läsas" },
      },
      { status: 400 }
    );
  }

  if (typeof verificationDate !== "string") {
    return json(
      { success: false, errors: { verificationDate: "Datum är obligatoriskt" } },
      { status: 400 }
    );
  }

  const supportingFile = formData.get("supportingFile");
  const supportingFileLabel = formData.get("supportingFileLabel");
  if (supportingFile instanceof File && supportingFile.size > 0) {
    try {
      validateVerificationFile(supportingFile);
    } catch (error) {
      return json(
        { success: false, errors: { file: error instanceof Error ? error.message : "Ogiltig fil" } },
        { status: 400 }
      );
    }
  }

  const dateForDatabase = parseAccountingDate(verificationDate);
  if (!dateForDatabase) {
    return json(
      { success: false, errors: { verificationDate: "Datumet är ogiltigt" } },
      { status: 400 }
    );
  }

  const verificationYear = accountingYear(dateForDatabase);
  if (user.fiscalYear !== verificationYear) {
    return json(
      {
        success: false,
        errors: {
          yearError: {
            message: `Året måste vara samma bokföringsår som ${user.fiscalYear}`,
          },
        },
      },
      { status: 400 }
    );
  }

  // Validera med Zod och kolla om resultatet är success
  const result = formSchema.safeParse({
    description,
    verificationDate,
    journalEntries,
  });

  if (!result.success) {
    const s = result.error as ZodError;

    return json(
      {
        success: false,
        errors: s.issues.reduce((acc, i) => {
          acc[i.path[0]] = i.message;
          return acc;
        }, {} as any),
      },
      { status: 400 }
    );
  }

  // check if VAT is already registered for the month

  const vatEntries = journalEntries.filter((f) => {
    return (
      f.account === 2611 ||
      f.account === 2640 ||
      f.account === 3001 
    )
  });

  if (vatEntries.length > 0) {
    const monthKey = accountingMonthKey(dateForDatabase);
    const isVatRegistered = monthKey
      ? await Verifications.findOne({
      domain: domain?.domain,
      metadata: { $elemMatch: { key: "vatReport", value: monthKey } },
    }).exec()
      : null;

    if (isVatRegistered) {
      return json(
        {
          success: false,
          errors: {
            yearError: {
              message: `Momsrapporten är redan registrerad för denna månad`,
            },
          },
        },
        { status: 400 }
      );
    }
  }

  await ensureIncomingBalance(domain.domain, verificationYear);

  try {
    let uploadedFile: Awaited<ReturnType<typeof uploadVerificationFile>> | null = null;
    try {
      if (supportingFile instanceof File && supportingFile.size > 0) {
        uploadedFile = await uploadVerificationFile(supportingFile);
      }
      const newVerification = await createVerification({
        domain: domain?.domain,
        description: result.data.description,
        verificationDate: dateForDatabase,
        journalEntries: result.data.journalEntries,
        files: uploadedFile
          ? [
              {
                name:
                  typeof supportingFileLabel === "string" &&
                  supportingFileLabel.trim()
                    ? sanitizeVerificationFileLabel(supportingFileLabel)
                    : uploadedFile.name,
                path: uploadedFile.path,
              },
            ]
          : [],
      });

      return json({
        success: true,
        message: "Verifikation sparades",
        verification: newVerification,
      });
    } catch (error) {
      if (uploadedFile) {
        await deleteUploadedVerificationFile(uploadedFile.key).catch((cleanupError) =>
          console.error("Kunde inte rensa en misslyckad filuppladdning", cleanupError)
        );
      }
      throw error;
    }
  } catch (e) {
    if (e instanceof VerificationValidationError) {
      return json(
        { success: false, errors: { journalEntries: e.message } },
        { status: 400 }
      );
    }
    console.error("Verifikationen kunde inte sparas", {
      name: e instanceof Error ? e.name : "UnknownError",
    });
    return json(
      {
        success: false,
        message: "Ett fel inträffade vid sparande av verifikation",
      },
      { status: 500 }
    );
  }
};

type ContextType = {
  latestVerificationNumber: number;
};

enum UploadingState {
  IDLE = 1,
  UPLOADING = 2,
  FAILED = 3,
  SUCCESS = 4,
  REVIEW = 5,
}

export default function Verification() {
  const actionData = useActionData<ActionData>();
  const data = useOutletContext<ContextType>();
  const submit = useSubmit();
  const [uploadedFile, setUploadedFile] = useState<{ label: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [reviewSuggestions, setReviewSuggestions] = useState<SuggestedVerificationData[]>([]);
  const [interpretationWarnings, setInterpretationWarnings] = useState<string[]>([]);
  const [protectingManualInput, setProtectingManualInput] = useState(false);
  const navigate = useNavigate();
  const previousVerification = useRef<number | null>(null);
  const [uploadingState, setUploadingState] = useState<UploadingState>(
    UploadingState.IDLE
  );
  const [entryMode, setEntryMode] = useState<"choose" | "upload" | "manual">(
    "choose"
  );
  const initialVerificationDate = useRef(
    accountingDateKey(new Date()) ?? new Date().toISOString().split("T")[0]
  ).current;

  const {
    register,
    handleSubmit,
    control,
    getValues,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      description: "",
      verificationDate: initialVerificationDate,
      journalEntries: [{ account: 0, debit: 0, credit: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "journalEntries",
  });

  const handleAddRow = () => {
    const journalEntries = getValues("journalEntries");

    // Kontrollera om det finns fler än en rad
    if (journalEntries.length > 1) {
      append({ account: 0, debit: 0, credit: 0 });
      return;
    }

    const lastEntry = journalEntries[journalEntries.length - 1];

    // Hitta det senaste kontot i accounts listan baserat på account-value
    const lastAccount = accounts.find((acc) => acc.value === lastEntry.account);

    // Om kontot har ett kopplat vatAccount, visa moms-toast och hantera moms
    if (lastAccount?.vatAccount) {
      const vatAccount = lastAccount.vatAccount;

      showVATToast(
        lastEntry.account,
        vatAccount, // Moms-kontot från accounts
        () => {
          const debitOrCredit = lastEntry.debit ? "debit" : "credit";
          const baseAmount = Number(lastEntry[debitOrCredit]) || 0; // Omvandla till nummer
          const vatAmount = Number(baseAmount * 0.25); // Beräkna moms

          // Lägg till momsrad
          append({
            account: vatAccount,
            debit: debitOrCredit === "credit" ? 0 : Number(vatAmount),
            credit: debitOrCredit === "debit" ? 0 : Number(vatAmount),
          });

          // Lägg till summeringsrad
          append({
            account: 0, // Tom rad för summering
            debit:
              debitOrCredit === "debit"
                ? 0
                : Number(baseAmount) + Number(vatAmount),
            credit:
              debitOrCredit === "credit"
                ? 0
                : Number(baseAmount) + Number(vatAmount),
          });
        },
        () => {
          append({ account: 0, debit: 0, credit: 0 });
        }
      );
      return;
    }

    append({ account: 0, debit: 0, credit: 0 });
  };

  const applySuggestion = (
    suggestion: SuggestedVerificationData,
    documentWarnings: string[] = interpretationWarnings
  ) => {
    remove(fields.map((_, index) => index));
    setValue("description", suggestion.description || "");
    setValue("verificationDate", suggestion.date || "");
    Object.entries(suggestion.accounts).forEach(([accountNumber, values]) => {
      append({
        account: Number(accountNumber),
        debit: values.debit || 0,
        credit: values.credit || 0,
      });
    });
    setInterpretationWarnings(
      Array.from(new Set([...documentWarnings, ...(suggestion.warnings ?? [])]))
    );
    setReviewSuggestions([]);
    setProtectingManualInput(false);
    setUploadingState(UploadingState.SUCCESS);
  };

  function handleSuggestions(data: SuggestionProps): void {
    if (data.status === "success" && data.verificationData && data.file) {
      if (data && data.verificationData && data.verificationData.accounts) {
        setUploadedFile(data.file);
        if (protectingManualInput) {
          setReviewSuggestions([data.verificationData]);
          setInterpretationWarnings(data.document?.warnings ?? []);
          setUploadingState(UploadingState.REVIEW);
        } else {
          applySuggestion(data.verificationData, data.document?.warnings ?? []);
        }
      } else {
        setUploadingState(UploadingState.FAILED);
        console.error("Account data saknas");
      }
    } else if (
      data.status === "review" &&
      data.file &&
      data.suggestions &&
      data.suggestions.length > 0
    ) {
      setUploadedFile(data.file);
      setReviewSuggestions(data.suggestions);
      setInterpretationWarnings(data.document?.warnings ?? []);
      setUploadingState(UploadingState.REVIEW);
    } else {
      setUploadingState(UploadingState.FAILED);
      if (fields.length === 0) append({ account: 0, debit: 0, credit: 0 });
    }
  }

  const showToast = (message: string) => {
    toast.warn(message, {
      position: "top-right",
      autoClose: 2000,
      hideProgressBar: true,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: false,
      progress: undefined,
      theme: "light",
    });
  };

  useEffect(() => {
    if (actionData?.success) {
      return;
    }
    const findFirstError = (errorObj: any): string | null => {
      for (const key in errorObj) {
        const entry = errorObj[key];

        // Om entry är ett objekt, iterera genom dess fält rekursivt
        if (typeof entry === "object" && entry !== null && !entry.message) {
          const nestedError = findFirstError(entry); // Rekursiv kontroll av nested objekt
          if (nestedError) return nestedError; // Returnera det första felet som hittas
        }

        // Om ett meddelande finns på det nuvarande fältet, returnera det
        if (entry?.message) {
          return entry.message;
        }
      }
      return null; // Om inget fel hittas, returnera null
    };

    const combinedErrors = { ...errors, ...actionData?.errors };

    const firstError = findFirstError(combinedErrors);
    if (firstError) {
      showToast(firstError); // Visa det första felet som hittas
      return;
    }
  }, [actionData, errors]);

  useEffect(() => {
    if (actionData?.success) {
      const verificationNumber = actionData.verification.verificationNumber;

      // Kör endast om verifikationsnumret är nytt
      if (verificationNumber !== previousVerification.current) {
        // Uppdatera föregående verifikationsnummer
        previousVerification.current = verificationNumber;
        setUploadedFile(null);
        setSelectedFile(null);
        setReviewSuggestions([]);
        setInterpretationWarnings([]);
        setProtectingManualInput(false);
        reset();
        // Visa toast
        toast.success(`Verifikation ${verificationNumber} sparades`, {
          position: "top-right",
          autoClose: 2000,
          hideProgressBar: true,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: false,
          progress: undefined,
          theme: "light",
        });
        navigate("/admin/verifications");
      }
    }
  }, [actionData, navigate, previousVerification, reset]);

  const currentEntries = watch("journalEntries") || [];
  const currentDescription = watch("description") || "";
  const currentVerificationDate = watch("verificationDate") || "";
  const currentSums = currentEntries.reduce(
    (sum, entry) => ({
      debit: sum.debit + Number(entry?.debit || 0),
      credit: sum.credit + Number(entry?.credit || 0),
    }),
    { debit: 0, credit: 0 }
  );
  const balanceDifference = Number(
    Math.abs(currentSums.debit - currentSums.credit).toFixed(2)
  );
  const isBalanced =
    currentSums.debit > 0 && currentSums.credit > 0 && balanceDifference === 0;
  const hasStartedVerification =
    Boolean(selectedFile) ||
    hasMeaningfulVerificationInput({
      description: currentDescription,
      journalEntries: currentEntries,
      verificationDate: currentVerificationDate,
      initialVerificationDate,
    });
  const isReadyToSave =
    uploadingState !== UploadingState.UPLOADING &&
    isBalanced &&
    formSchema.safeParse({
      description: currentDescription,
      verificationDate: currentVerificationDate,
      journalEntries: currentEntries,
    }).success;
  const showMobileModeChoice =
    entryMode === "choose" && !hasStartedVerification;
  const showMobileUpload =
    entryMode === "upload" ||
    Boolean(selectedFile) ||
    uploadingState !== UploadingState.IDLE;
  const showMobileManual =
    entryMode === "manual" ||
    (hasStartedVerification && !selectedFile) ||
    uploadingState === UploadingState.SUCCESS ||
    protectingManualInput;

  const submitVerification = handleSubmit((formValues) => {
    const sums = formValues.journalEntries.reduce(
      (sum, { debit = 0, credit = 0 }) => ({
        debit: sum.debit + Number(debit),
        credit: sum.credit + Number(credit),
      }),
      { debit: 0, credit: 0 }
    );

    if (sums.debit.toFixed(2) !== sums.credit.toFixed(2)) {
      toast.warn(
        `Debet ${sums.debit.toLocaleString("sv-SE", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} kr och kredit ${sums.credit.toLocaleString("sv-SE", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} kr måste vara lika.`,
        {
          position: "top-right",
          autoClose: 2500,
          hideProgressBar: true,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: false,
          theme: "light",
        }
      );
      return;
    }

    const submission = new FormData();
    submission.append("description", formValues.description);
    submission.append("verificationDate", formValues.verificationDate);
    submission.append("journalEntries", JSON.stringify(formValues.journalEntries));
    if (selectedFile) {
      submission.append("supportingFile", selectedFile);
      if (uploadedFile?.label) {
        submission.append("supportingFileLabel", uploadedFile.label);
      }
    }
    submit(submission, { method: "post", encType: "multipart/form-data" });
  });

  return (
    <section aria-labelledby="new-verification-title">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate("/admin/verifications")}
            className="mb-3 inline-flex h-10 items-center rounded-lg px-1 text-xs font-bold text-slate-500 hover:text-slate-900"
          >
            <span aria-hidden="true" className="mr-2">←</span>
            Till verifikationer
          </button>
          <h2
            id="new-verification-title"
            className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl"
          >
            Ny verifikation
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Nästa verifikationsnummer blir A{data.latestVerificationNumber + 1}.
          </p>
        </div>
      </div>

      <form onSubmit={submitVerification} className="space-y-5">
        <div className="lg:hidden">
          {showMobileModeChoice ? (
            <section aria-labelledby="verification-mode-title" className="border-y border-stone-300 py-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#985744]">
                Välj arbetssätt
              </p>
              <h3 id="verification-mode-title" className="mt-1 text-2xl text-stone-950">
                Hur vill du börja?
              </h3>
              <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
                <button
                  type="button"
                  onClick={() => setEntryMode("upload")}
                  className="group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-4 text-left"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f7e9e4] text-[#985744]" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                      <path d="M12 16V5M8 9l4-4 4 4M5 19h14" />
                    </svg>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-stone-900">Ladda upp underlag</span>
                    <span className="mt-0.5 block text-xs leading-5 text-stone-500">
                      Vi läser datum, beskrivning och föreslagen kontering.
                    </span>
                  </span>
                  <span className="text-lg text-stone-400 transition group-hover:translate-x-0.5 group-hover:text-[#985744]" aria-hidden="true">→</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEntryMode("manual")}
                  className="group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-4 text-left"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-100 text-stone-600" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                      <path d="M6 5h12v14H6zM9 9h6M9 13h6" />
                    </svg>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-stone-900">Registrera manuellt</span>
                    <span className="mt-0.5 block text-xs leading-5 text-stone-500">
                      Fyll i uppgifter och konteringsrader själv.
                    </span>
                  </span>
                  <span className="text-lg text-stone-400 transition group-hover:translate-x-0.5 group-hover:text-[#985744]" aria-hidden="true">→</span>
                </button>
              </div>
            </section>
          ) : !hasStartedVerification && uploadingState === UploadingState.IDLE ? (
            <button
              type="button"
              onClick={() => setEntryMode("choose")}
              className="inline-flex min-h-10 items-center text-xs font-bold text-stone-500 transition hover:text-[#985744]"
            >
              <span aria-hidden="true" className="mr-2">←</span>
              Byt registreringssätt
            </button>
          ) : null}
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div
            className={`${showMobileManual ? "block" : "hidden"} order-2 space-y-5 lg:order-1 lg:block ${
              uploadingState === UploadingState.UPLOADING ? "opacity-60" : ""
            }`}
          >
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">
                  Grunduppgifter
                </p>
                <h3 className="mt-1 text-lg font-bold text-slate-950">
                  Vad gäller verifikationen?
                </h3>
              </div>

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
                <div>
                  <label
                    htmlFor="description"
                    className="mb-1.5 block text-xs font-bold text-slate-700"
                  >
                    Beskrivning
                  </label>
                  <input
                    id="description"
                    {...register("description")}
                    type="text"
                    autoComplete="off"
                    placeholder="Exempel: Inköp av emballage"
                    className={`h-12 w-full rounded-xl border bg-white px-4 text-base text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 sm:text-sm ${
                      errors.description
                        ? "border-red-400 focus:border-red-500 focus:ring-red-100"
                        : "border-slate-300 focus:border-emerald-600 focus:ring-emerald-100"
                    }`}
                  />
                </div>
                <div>
                  <label
                    htmlFor="verificationDate"
                    className="mb-1.5 block text-xs font-bold text-slate-700"
                  >
                    Bokföringsdatum
                  </label>
                  <Controller
                    control={control}
                    name="verificationDate"
                    render={({ field }) => (
                      <AccountingDateField
                        id="verificationDate"
                        value={field.value}
                        onChange={field.onChange}
                        label="Välj bokföringsdatum"
                        error={Boolean(errors.verificationDate)}
                      />
                    )}
                  />
                </div>
              </div>
            </section>

            <section className="overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4 sm:p-6">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">
                    Kontering
                  </p>
                  <h3 className="mt-1 text-lg font-bold text-slate-950">
                    Debet och kredit
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Lägg till minst två rader. Summorna måste balansera innan du sparar.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                  {fields.length} {fields.length === 1 ? "rad" : "rader"}
                </span>
              </div>

              <div className="space-y-4 p-4 sm:p-6">
                {fields.map((entry, index) => (
                  <div
                    key={entry.id}
                    className="rounded-[1.25rem] border border-stone-200 bg-[#fbfaf8] p-4 shadow-[0_1px_0_rgba(41,37,36,0.03)] sm:p-5"
                  >
                    <div className="mb-4 flex min-h-[2rem] items-center justify-between gap-3 border-b border-stone-200 pb-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-500">
                        Konteringsrad {index + 1}
                      </p>
                      {fields.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          aria-label={`Ta bort konteringsrad ${index + 1}`}
                          className="inline-flex h-9 items-center justify-center rounded-lg px-2.5 text-[11px] font-bold text-stone-400 transition hover:bg-red-50 hover:text-red-700"
                        >
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="mr-1.5 h-3.5 w-3.5">
                            <path d="M5 7h14M9 7V4.5h6V7M8 10.5v6M12 10.5v6M16 10.5v6M7 7l1 13h8l1-13" />
                          </svg>
                          Ta bort
                        </button>
                      ) : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.25fr)_minmax(145px,.75fr)_minmax(145px,.75fr)]">
                      <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                        <label
                          className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.13em] text-stone-500"
                          htmlFor={`account-select-${index}`}
                        >
                          Konto
                        </label>
                        <Controller
                          control={control}
                          name={`journalEntries.${index}.account`}
                          render={({ field }) => (
                            <ClientOnly fallback={<div className="h-[3.25rem] rounded-2xl bg-stone-100" />}>
                              {() => (
                                <Select
                                  instanceId={`account-select-${index}`}
                                  inputId={`account-select-${index}`}
                                  {...field}
                                  options={accounts}
                                  onChange={(option) =>
                                    field.onChange(option ? option.value : null)
                                  }
                                  value={accounts.find(
                                    (account) => account.value === field.value
                                  )}
                                  placeholder="Sök eller välj konto"
                                  className="text-sm"
                                  classNamePrefix="verification-account"
                                />
                              )}
                            </ClientOnly>
                          )}
                        />
                      </div>

                      <label className="group flex min-h-[4.75rem] flex-col justify-between rounded-2xl border border-stone-300 bg-white px-4 py-3 transition hover:border-[#c58a79] focus-within:border-[#ad644f] focus-within:ring-2 focus-within:ring-[#f3e4de]">
                        <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-stone-500 transition group-focus-within:text-[#985744]">
                          Debet
                        </span>
                        <span className="mt-1 flex items-baseline gap-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            placeholder="0,00"
                            {...register(`journalEntries.${index}.debit` as const)}
                            className="verification-amount-input min-w-0 flex-1 border-0 bg-transparent p-0 text-right text-xl font-semibold leading-none tabular-nums text-stone-900 outline-none placeholder:text-stone-300"
                          />
                          <span className="shrink-0 text-[11px] font-bold uppercase text-stone-400">
                            kr
                          </span>
                        </span>
                      </label>

                      <label className="group flex min-h-[4.75rem] flex-col justify-between rounded-2xl border border-stone-300 bg-white px-4 py-3 transition hover:border-[#c58a79] focus-within:border-[#ad644f] focus-within:ring-2 focus-within:ring-[#f3e4de]">
                        <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-stone-500 transition group-focus-within:text-[#985744]">
                          Kredit
                        </span>
                        <span className="mt-1 flex items-baseline gap-2">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            placeholder="0,00"
                            {...register(`journalEntries.${index}.credit` as const)}
                            className="verification-amount-input min-w-0 flex-1 border-0 bg-transparent p-0 text-right text-xl font-semibold leading-none tabular-nums text-stone-900 outline-none placeholder:text-stone-300"
                          />
                          <span className="shrink-0 text-[11px] font-bold uppercase text-stone-400">
                            kr
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={handleAddRow}
                  className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-[#fffdf9] px-5 text-sm font-bold text-stone-600 transition hover:border-[#c58a79] hover:bg-[#fbf3ef] hover:text-[#985744] sm:w-auto"
                >
                  <span aria-hidden="true" className="mr-2 text-lg">+</span>
                  Lägg till konteringsrad
                </button>
              </div>
            </section>
          </div>

          <aside className={`${showMobileUpload ? "block" : "hidden"} order-1 space-y-3 lg:order-2 lg:block lg:sticky lg:top-28`}>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">
                  Underlag
                </p>
                <h3 className="mt-1 text-base font-bold text-slate-950">
                  Snabbast med en fil
                </h3>
              </div>

              {uploadingState === UploadingState.UPLOADING ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                  <div className="h-2 overflow-hidden rounded-full bg-emerald-100">
                    <div className="h-full w-full animate-stripe bg-[repeating-linear-gradient(45deg,_#047857_0px,_#047857_10px,_#34d399_10px,_#34d399_20px)] bg-[length:120%_100%]" />
                  </div>
                  <p className="mt-3 text-sm font-bold text-emerald-900">
                    Tolkar underlaget…
                  </p>
                  <p className="mt-1 text-xs leading-5 text-emerald-800/70">
                    {protectingManualInput
                      ? "Dina ifyllda fält ligger kvar medan förslaget tas fram."
                      : "Datum, text och kontering fylls i automatiskt."}
                  </p>
                </div>
              ) : uploadingState === UploadingState.FAILED ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                  <p className="text-sm font-bold text-red-900">
                    Filen kunde inte tolkas
                  </p>
                  <p className="mt-1 text-xs leading-5 text-red-700">
                    Du kan prova en annan fil eller fylla i verifikationen manuellt. Originalfilen bifogas om du sparar manuellt.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFile(null);
                      setUploadedFile(null);
                      setProtectingManualInput(false);
                      setUploadingState(UploadingState.IDLE);
                    }}
                    className="mt-3 h-10 rounded-xl bg-white px-4 text-xs font-bold text-red-800 ring-1 ring-red-200 transition hover:bg-red-100"
                  >
                    Försök igen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFile(null);
                      setUploadedFile(null);
                      setReviewSuggestions([]);
                      setInterpretationWarnings([]);
                      setProtectingManualInput(false);
                      setUploadingState(UploadingState.IDLE);
                      setEntryMode("manual");
                    }}
                    className="ml-3 mt-3 h-10 px-2 text-xs font-bold text-stone-600 underline decoration-stone-300 underline-offset-4 transition hover:text-[#985744]"
                  >
                    Fyll i manuellt
                  </button>
                </div>
              ) : uploadingState === UploadingState.REVIEW ? (
                <div className="space-y-3 rounded-2xl border border-[#d7b0a3] bg-[#fbf3ef] p-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-[#985744]">
                      {protectingManualInput
                        ? "Förslag från underlaget"
                        : "Välj bokföringspost"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#7d493a]">
                      {protectingManualInput
                        ? "Det du redan fyllt i ligger kvar. Använd förslaget endast om du vill ersätta fälten."
                        : "Underlaget innehåller flera separata transaktioner. Välj den som ska bli verifikation nu."}
                    </p>
                  </div>
                  {reviewSuggestions.map((suggestion, index) => (
                    <button
                      key={`${suggestion.date}-${suggestion.sourceReference}-${index}`}
                      type="button"
                      onClick={() => applySuggestion(suggestion)}
                      className="block w-full rounded-xl border border-[#dfc1b7] bg-white p-3 text-left transition hover:border-[#b86e59]"
                    >
                      <span className="block text-xs font-bold text-stone-900">
                        {suggestion.description}
                      </span>
                      <span className="mt-1 block text-[11px] text-stone-500">
                        {suggestion.date}{suggestion.sourceReference ? ` · ${suggestion.sourceReference}` : ""}
                        {typeof suggestion.confidence === "number" ? ` · ${Math.round(suggestion.confidence * 100)} % säkerhet` : ""}
                      </span>
                      {suggestion.warnings?.length ? (
                        <span className="mt-1 block text-[11px] leading-4 text-amber-800">
                          {suggestion.warnings.join(" · ")}
                        </span>
                      ) : null}
                    </button>
                  ))}
                  {interpretationWarnings.length ? (
                    <p className="text-[11px] leading-4 text-amber-800">
                      {interpretationWarnings.join(" · ")}
                    </p>
                  ) : null}
                </div>
              ) : uploadedFile ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                    Underlag kopplat
                  </p>
                  <p className="mt-1 truncate text-sm font-bold text-emerald-950">
                    {uploadedFile.label}
                  </p>
                  {interpretationWarnings.length ? (
                    <p className="mt-2 text-[11px] leading-4 text-amber-800">
                      Kontrollera: {interpretationWarnings.join(" · ")}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedFile(null);
                      setSelectedFile(null);
                      setReviewSuggestions([]);
                      setInterpretationWarnings([]);
                      setProtectingManualInput(false);
                      setUploadingState(UploadingState.IDLE);
                    }}
                    className="mt-3 text-xs font-bold text-emerald-800 underline decoration-emerald-300 underline-offset-4"
                  >
                    Ta bort underlag
                  </button>
                </div>
              ) : (
                <FileUpload
                  onSuggestionsReceived={handleSuggestions}
                  onFileSelected={(file) => {
                    setEntryMode("upload");
                    const currentValues = getValues();
                    setSelectedFile(file);
                    setUploadedFile({ label: file.name });
                    setReviewSuggestions([]);
                    setInterpretationWarnings([]);
                    setProtectingManualInput(
                      hasMeaningfulVerificationInput({
                        description: currentValues.description,
                        journalEntries: currentValues.journalEntries,
                        verificationDate: currentValues.verificationDate,
                        initialVerificationDate,
                      })
                    );
                    setUploadingState(UploadingState.UPLOADING);
                  }}
                />
              )}
            </section>

            <div className="hidden rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-500 shadow-sm lg:block">
              <p className="font-bold text-slate-800">Manuell registrering</p>
              <p className="mt-1">
                Det går lika bra att fylla i uppgifterna direkt utan underlag.
              </p>
            </div>
          </aside>
        </div>

        {hasStartedVerification ? (
          <div className="sticky bottom-0 z-[5] border-t border-stone-300 bg-[#f5f4f0] px-3 py-2.5 shadow-[0_-10px_28px_rgba(70,60,52,0.08)] sm:p-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 sm:flex sm:items-center sm:justify-between">
              <div className="grid grid-cols-2 gap-5 sm:flex sm:gap-6">
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 sm:text-[10px]">Debet</p>
                  <p className="mt-0.5 text-xs font-bold tabular-nums text-slate-900 sm:mt-1 sm:text-base">
                    {currentSums.debit.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 sm:text-[10px]">Kredit</p>
                  <p className="mt-0.5 text-xs font-bold tabular-nums text-slate-900 sm:mt-1 sm:text-base">
                    {currentSums.credit.toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="hidden sm:block">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Status</p>
                  <p className={`mt-1 text-sm font-bold ${isBalanced ? "text-emerald-700" : "text-amber-700"}`}>
                    {isBalanced ? "Balanserar" : balanceDifference ? `Diff ${balanceDifference.toLocaleString("sv-SE")}` : "Ej klar"}
                  </p>
                </div>
                <span className="sr-only">
                  {isBalanced ? "Konteringen balanserar" : balanceDifference ? `Skillnad ${balanceDifference.toLocaleString("sv-SE")}` : "Konteringen är inte klar"}
                </span>
              </div>

              <div className="sm:grid sm:gap-3 sm:grid-cols-[9.5rem_15rem]">
                <button
                  type="button"
                  onClick={() => navigate("/admin/verifications")}
                  className="hidden h-14 w-full items-center justify-center rounded-2xl border border-stone-300 bg-[#fffdf9] px-5 text-sm font-bold text-stone-700 transition hover:-translate-y-px hover:border-[#c58a79] hover:bg-white hover:text-[#985744] focus:outline-none focus:ring-2 focus:ring-[#e7c8be] focus:ring-offset-2 sm:inline-flex"
                >
                  Avbryt
                </button>
                <button
                  type="submit"
                  disabled={!isReadyToSave}
                  className="inline-flex h-12 min-w-[7.75rem] items-center justify-center gap-2 rounded-xl border border-[#a85f4b] bg-[#a85f4b] px-4 text-sm font-bold text-white shadow-[0_6px_16px_rgba(126,67,51,0.14)] transition hover:-translate-y-px hover:border-[#8f4f3e] hover:bg-[#8f4f3e] focus:outline-none focus:ring-2 focus:ring-[#d7b0a3] focus:ring-offset-2 disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-stone-200 disabled:text-stone-500 disabled:shadow-none disabled:hover:translate-y-0 sm:h-14 sm:w-full sm:rounded-2xl sm:px-6"
                >
                  <span className="sm:hidden">Spara</span>
                  <span className="hidden sm:inline">Spara verifikation</span>
                  <span aria-hidden="true" className="text-base">→</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </form>
    </section>
  );
}
