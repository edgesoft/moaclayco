import {
  ActionFunction,
  data as json,
  LinksFunction,
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
import ClientOnly from "~/components/ClientOnly";
import { auth } from "~/services/auth.server";
import {
  AccountingYearClosedError,
  createVerification,
  ensureIncomingBalance,
} from "~/services/verification.server";
import {
  accountingDateKey,
  accountingMonthKey,
  accountingYear,
  parseAccountingDate,
} from "~/utils/accountingDates";
import {
  deleteUploadedVerificationFile,
  MAX_VERIFICATION_REQUEST_SIZE,
  readVerifiedVerificationFile,
  uploadVerificationFile,
  validateVerificationFile,
} from "~/services/verification-files.server";
import { AccountingDateField } from "~/components/admin/AccountingDateField";
import JournalEntryAmountField from "~/components/admin/JournalEntryAmountField";
import ArrowIcon from "~/components/ArrowIcon";
import PlusMinusIcon from "~/components/PlusMinusIcon";
import {
  hasMeaningfulVerificationInput,
  sanitizeVerificationFileLabel,
} from "~/utils/verificationFiles";
import {
  isEmptyJournalEntry,
  VerificationValidationError,
  withoutEmptyJournalEntries,
} from "~/utils/verificationValidation";
import {
  getVerificationSuggestionDateNotice,
  type VerificationSuggestionDateNotice,
} from "~/utils/verificationSuggestionDates";
import {
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";
import reactToastifyStyles from "react-toastify/dist/ReactToastify.css?url";
import toastStyles from "~/styles/toast.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: reactToastifyStyles },
  { rel: "stylesheet", href: toastStyles },
];

const formSchema = z.object({
  description: z.string().min(1, "Beskrivning är obligatorisk"),
  verificationDate: z.string().nonempty("Datum är obligatoriskt"),
  journalEntries: z
    .array(
      z.object({
        account: z.number().min(1, "Konto är obligatoriskt"),
        debit: z.number().min(0, "Debet måste vara ett tal"),
        credit: z.number().min(0, "Kredit måste vara ett tal"),
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

const clientFormSchema = formSchema.extend({
  journalEntries: z
    .array(
      z.object({
        account: z.number(),
        debit: z.number(),
        credit: z.number(),
      })
    )
    .transform((entries) => withoutEmptyJournalEntries(entries))
    .pipe(formSchema.shape.journalEntries),
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

type ReviewSuggestion = SuggestedVerificationData & {
  uiId: string;
};

const ReviewWarnings = ({
  label = "Saker att kontrollera",
  warnings,
}: {
  label?: string;
  warnings?: string[];
}) => {
  const uniqueWarnings = Array.from(
    new Set(warnings?.map((warning) => warning.trim()).filter(Boolean) ?? [])
  );
  if (!uniqueWarnings.length) return null;

  return (
    <details className="mt-2 border-t border-[#ead8d1] pt-2 text-[#8d4b39]">
      <summary className="flex min-h-8 list-none cursor-pointer items-center justify-between gap-3 text-[11px] font-bold marker:content-none">
        <span>
          {label} · {uniqueWarnings.length}
        </span>
        <span aria-hidden="true" className="text-base font-normal">
          +
        </span>
      </summary>
      <ul className="mt-1 space-y-1.5 pb-1 text-[11px] font-normal leading-4 text-stone-600">
        {uniqueWarnings.map((warning) => (
          <li key={warning} className="border-l border-[#d7b0a3] pl-2.5">
            {warning}
          </li>
        ))}
      </ul>
    </details>
  );
};

const SuggestedDateNotice = ({
  notice,
}: {
  notice: VerificationSuggestionDateNotice | null;
}) => {
  if (!notice) return null;

  return (
    <div
      role={notice.blocksAutomaticDate ? "alert" : "status"}
      className="mt-3 border-l-2 border-[#a85f4b] bg-[#fbf1ed] px-3 py-2 text-[11px] font-medium leading-5 text-[#7c4435]"
    >
      <strong className="block text-[10px] uppercase tracking-[0.12em]">
        {notice.blocksAutomaticDate
          ? "Datum utanför bokföringsåret"
          : "Gammalt underlag"}
      </strong>
      {notice.message}
    </div>
  );
};

type SuggestionProps = {
  status: string;
  verificationData: SuggestedVerificationData | null;
  suggestions?: SuggestedVerificationData[];
  file?: { label: string };
  document?: { type: string; warnings: string[] };
  uuid: string;
  error?: string;
};

const FileUpload = ({
  onFileSelected,
}: {
  onFileSelected: (file: File) => void;
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submitFile = (file: File) => {
    onFileSelected(file);
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
      className="rounded-2xl border border-dashed border-stone-300 bg-[#fcfaf7] p-5 text-center transition hover:border-[#c58a79] hover:bg-[#fbf1ed] sm:p-7"
    >
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#f3e4de] text-lg font-bold text-[#985744]" aria-hidden="true">
        <ArrowIcon direction="up" />
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
          <ArrowIcon />
        </span>
      </button>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept=".pdf,.avif,.gif,.heic,.heif,.jpeg,.jpg,.png,.tif,.tiff,.webp,application/pdf,image/avif,image/gif,image/heic,image/heif,image/jpeg,image/png,image/tiff,image/webp"
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
  const user = await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });
  let requestFormData: globalThis.FormData;
  try {
    requestFormData = await parseFormDataWithinLimit(
      request,
      MAX_VERIFICATION_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json(
        { success: false, errors: { file: "Filen är större än 20 MB" } },
        { status: 413 }
      );
    }
    throw error;
  }

  const description = requestFormData.get("description");
  const verificationDate = requestFormData.get("verificationDate");
  const rawJournalEntries = requestFormData.get("journalEntries");
  let journalEntries: FormData["journalEntries"];
  try {
    journalEntries = withoutEmptyJournalEntries(
      JSON.parse(
        typeof rawJournalEntries === "string" ? rawJournalEntries : ""
      ) as FormData["journalEntries"]
    );
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

  const supportingFile = requestFormData.get("supportingFile");
  const supportingFileLabel = requestFormData.get("supportingFileLabel");
  let verifiedSupportingFile:
    | Awaited<ReturnType<typeof readVerifiedVerificationFile>>
    | undefined;
  if (supportingFile instanceof File && supportingFile.size > 0) {
    try {
      validateVerificationFile(supportingFile);
      verifiedSupportingFile = await readVerifiedVerificationFile(supportingFile);
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
      metadata: { $elemMatch: { key: "vatReport", value: monthKey } },
    })
        .select("_id")
        .lean()
        .exec()
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

  await ensureIncomingBalance(verificationYear);

  try {
    let uploadedFile: Awaited<ReturnType<typeof uploadVerificationFile>> | null = null;
    try {
      if (supportingFile instanceof File && supportingFile.size > 0) {
        uploadedFile = await uploadVerificationFile(
          supportingFile,
          "documents",
          verifiedSupportingFile
        );
      }
      const newVerification = await createVerification({
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
    if (e instanceof AccountingYearClosedError) {
      return json(
        { success: false, errors: { yearError: { message: e.message } } },
        { status: 409 }
      );
    }
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
  year: number;
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
  const interpretationFetcher = useFetcher<SuggestionProps>();
  const handledInterpretationUuidRef = useRef<string | null>(null);
  const preUploadFormValuesRef = useRef<FormData | null>(null);
  const handleSuggestionsRef = useRef<(data: SuggestionProps) => void>(
    () => undefined
  );
  const [uploadedFile, setUploadedFile] = useState<{ label: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [reviewSuggestions, setReviewSuggestions] = useState<ReviewSuggestion[]>([]);
  const [interpretationWarnings, setInterpretationWarnings] = useState<string[]>([]);
  const [protectingManualInput, setProtectingManualInput] = useState(false);
  const [suggestedDateNotice, setSuggestedDateNotice] =
    useState<VerificationSuggestionDateNotice | null>(null);
  const saveSummaryRef = useRef<HTMLDivElement>(null);
  const journalSectionRef = useRef<HTMLElement>(null);
  const journalBottomRef = useRef<HTMLButtonElement>(null);
  const [isSaveSummaryVisible, setIsSaveSummaryVisible] = useState(false);
  const [isJournalSectionVisible, setIsJournalSectionVisible] = useState(false);
  const [isJournalBottomVisible, setIsJournalBottomVisible] = useState(false);
  const navigate = useNavigate();
  const previousVerificationRef = useRef<number | null>(null);
  const [uploadingState, setUploadingState] = useState<UploadingState>(
    UploadingState.IDLE
  );
  const [entryMode, setEntryMode] = useState<"choose" | "upload" | "manual">(
    "choose"
  );
  const [initialVerificationDate] = useState(() => {
    const now = new Date();
    const today = accountingDateKey(now) ?? now.toISOString().split("T")[0];
    return Number(today.slice(0, 4)) === data.year ? today : "";
  });

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
    resolver: zodResolver(clientFormSchema),
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
    const dateNotice = getVerificationSuggestionDateNotice({
      dateKey: suggestion.date,
      fiscalYear: data.year,
    });
    remove(fields.map((_, index) => index));
    setValue("description", suggestion.description || "");
    setValue(
      "verificationDate",
      dateNotice?.blocksAutomaticDate ? "" : suggestion.date || ""
    );
    setSuggestedDateNotice(dateNotice);
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
    setUploadError(null);
    setProtectingManualInput(false);
    setUploadingState(UploadingState.SUCCESS);
  };

  const removeUploadedMaterial = () => {
    const previousManualValues = preUploadFormValuesRef.current;

    reset(
      previousManualValues ?? {
        description: "",
        verificationDate: initialVerificationDate,
        journalEntries: [{ account: 0, debit: 0, credit: 0 }],
      }
    );
    preUploadFormValuesRef.current = null;
    setUploadedFile(null);
    setSelectedFile(null);
    setUploadError(null);
    setReviewSuggestions([]);
    setInterpretationWarnings([]);
    setSuggestedDateNotice(null);
    setProtectingManualInput(false);
    setUploadingState(UploadingState.IDLE);
    setEntryMode(previousManualValues ? "manual" : "choose");
  };

  function handleSuggestions(data: SuggestionProps): void {
    if (data.status === "success" && data.verificationData && data.file) {
      if (data && data.verificationData && data.verificationData.accounts) {
        setUploadedFile(data.file);
        setUploadError(null);
        if (protectingManualInput) {
          setReviewSuggestions([
            { ...data.verificationData, uiId: `${data.uuid}:suggestion:1` },
          ]);
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
      setUploadError(null);
      setReviewSuggestions(
        data.suggestions.map((suggestion, suggestionPosition) => ({
          ...suggestion,
          uiId: `${data.uuid}:suggestion:${suggestionPosition + 1}`,
        }))
      );
      setInterpretationWarnings(data.document?.warnings ?? []);
      setUploadingState(UploadingState.REVIEW);
    } else {
      setUploadError(
        data.error ??
          "Underlaget kunde inte tolkas. Prova igen eller fyll i manuellt."
      );
      setUploadingState(UploadingState.FAILED);
      if (fields.length === 0) append({ account: 0, debit: 0, credit: 0 });
    }
  }

  handleSuggestionsRef.current = handleSuggestions;

  useEffect(() => {
    const response = interpretationFetcher.data;
    if (
      !response ||
      handledInterpretationUuidRef.current === response.uuid
    ) {
      return;
    }

    handledInterpretationUuidRef.current = response.uuid;
    handleSuggestionsRef.current(response);
  }, [interpretationFetcher.data]);

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
      if (verificationNumber !== previousVerificationRef.current) {
        // Uppdatera föregående verifikationsnummer
        previousVerificationRef.current = verificationNumber;
        setUploadedFile(null);
        setSelectedFile(null);
        preUploadFormValuesRef.current = null;
        setReviewSuggestions([]);
        setInterpretationWarnings([]);
        setSuggestedDateNotice(null);
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
  }, [actionData, navigate, previousVerificationRef, reset]);

  const currentEntries = watch("journalEntries") || [];
  const currentEntriesForSaving = withoutEmptyJournalEntries(currentEntries);
  const currentDescription = watch("description") || "";
  const currentVerificationDate = watch("verificationDate") || "";
  const currentSums = currentEntriesForSaving.reduce(
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
  const interpretationBlocksForm =
    uploadingState === UploadingState.UPLOADING ||
    uploadingState === UploadingState.REVIEW ||
    uploadingState === UploadingState.FAILED;
  const showVerificationActions =
    hasStartedVerification && !interpretationBlocksForm;
  const hasIncompleteJournalEntry = currentEntries.some((entry) => {
    if (isEmptyJournalEntry(entry)) return false;

    const debit = Number(entry?.debit || 0);
    const credit = Number(entry?.credit || 0);
    return (
      Number(entry?.account || 0) <= 0 ||
      !((debit > 0 && credit === 0) || (credit > 0 && debit === 0))
    );
  });
  const saveBlockReason = !currentDescription.trim()
    ? "Skriv en beskrivning för att kunna spara."
    : !currentVerificationDate
      ? "Välj bokföringsdatum för att kunna spara."
      : currentEntriesForSaving.length < 2
        ? "Minst två kompletta konteringsrader krävs."
        : hasIncompleteJournalEntry
          ? "Fyll i den påbörjade konteringsraden."
          : !isBalanced
            ? "Debet och kredit måste balansera."
            : null;
  const isReadyToSave =
    showVerificationActions &&
    !saveBlockReason &&
    formSchema.safeParse({
      description: currentDescription,
      verificationDate: currentVerificationDate,
      journalEntries: currentEntriesForSaving,
    }).success;

  useEffect(() => {
    const saveSummary = saveSummaryRef.current;
    if (!saveSummary || typeof IntersectionObserver === "undefined") {
      setIsSaveSummaryVisible(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsSaveSummaryVisible(entry.isIntersecting),
      { threshold: 0.05 }
    );
    observer.observe(saveSummary);
    return () => observer.disconnect();
  }, [showVerificationActions]);

  useEffect(() => {
    const journalSection = journalSectionRef.current;
    const journalBottom = journalBottomRef.current;
    if (
      !showVerificationActions ||
      !journalSection ||
      !journalBottom ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const sectionObserver = new IntersectionObserver(
      ([entry]) => setIsJournalSectionVisible(entry.isIntersecting),
      { threshold: 0 }
    );
    const bottomObserver = new IntersectionObserver(
      ([entry]) => setIsJournalBottomVisible(entry.isIntersecting),
      { threshold: 0.01 }
    );
    sectionObserver.observe(journalSection);
    bottomObserver.observe(journalBottom);

    return () => {
      sectionObserver.disconnect();
      bottomObserver.disconnect();
    };
  }, [showVerificationActions]);
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
  const singleReviewSuggestion =
    reviewSuggestions.length === 1 ? reviewSuggestions[0] : null;
  const singleReviewWarnings = singleReviewSuggestion
    ? Array.from(
        new Set([
          ...(singleReviewSuggestion.warnings ?? []),
          ...interpretationWarnings,
        ])
      )
    : [];
  const singleReviewDateNotice = singleReviewSuggestion
    ? getVerificationSuggestionDateNotice({
        dateKey: singleReviewSuggestion.date,
        fiscalYear: data.year,
      })
    : null;

  const submitVerification = handleSubmit((formValues) => {
    const journalEntries = withoutEmptyJournalEntries(formValues.journalEntries);
    const sums = journalEntries.reduce(
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
    submission.append("journalEntries", JSON.stringify(journalEntries));
    if (selectedFile) {
      submission.append("supportingFile", selectedFile);
      if (uploadedFile?.label) {
        submission.append("supportingFileLabel", uploadedFile.label);
      }
    }
    submit(submission, { method: "post", encType: "multipart/form-data" });
  });

  return (
    <section
      aria-labelledby="new-verification-title"
      className="verification-page w-full min-w-0 max-w-full"
    >
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => navigate("/admin/verifications")}
            className="mb-3 inline-flex h-10 items-center rounded-lg px-1 text-xs font-bold text-slate-500 hover:text-slate-900"
          >
            <span aria-hidden="true" className="mr-2"><ArrowIcon direction="left" /></span>
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

      <form
        onSubmit={submitVerification}
        className="w-full min-w-0 max-w-full space-y-5"
      >
        <div className="verification-mobile-mode">
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
                  <span className="text-lg text-stone-400 transition group-hover:translate-x-0.5 group-hover:text-[#985744]" aria-hidden="true"><ArrowIcon /></span>
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
                  <span className="text-lg text-stone-400 transition group-hover:translate-x-0.5 group-hover:text-[#985744]" aria-hidden="true"><ArrowIcon /></span>
                </button>
              </div>
            </section>
          ) : !hasStartedVerification && uploadingState === UploadingState.IDLE ? (
            <button
              type="button"
              onClick={() => setEntryMode("choose")}
              className="inline-flex min-h-10 items-center text-xs font-bold text-stone-500 transition hover:text-[#985744]"
            >
              <span aria-hidden="true" className="mr-2"><ArrowIcon direction="left" /></span>
              Byt registreringssätt
            </button>
          ) : null}
        </div>

        <div className="verification-layout grid w-full min-w-0 max-w-full gap-5">
          <div
            className={`${showMobileManual ? "block" : "hidden"} verification-manual min-w-0 space-y-5 ${
              uploadingState === UploadingState.UPLOADING ? "opacity-60" : ""
            }`}
          >
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#985744]">
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
                        : "border-slate-300 focus:border-[#ad644f] focus:ring-[#f3e4de]"
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
                        onChange={(value) => {
                          field.onChange(value);
                          setSuggestedDateNotice(null);
                        }}
                        label="Välj bokföringsdatum"
                        error={
                          Boolean(errors.verificationDate) ||
                          Boolean(suggestedDateNotice?.blocksAutomaticDate)
                        }
                        allowedYear={data.year}
                      />
                    )}
                  />
                  <SuggestedDateNotice notice={suggestedDateNotice} />
                </div>
              </div>
            </section>

            <section
              ref={journalSectionRef}
              className="min-w-0 max-w-full overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4 sm:p-6">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#985744]">
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

              <div className="min-w-0 max-w-full p-4 sm:p-6">
                <div
                  data-testid="verification-journal-rows"
                  className="min-w-0 max-w-full space-y-4"
                >
                {showVerificationActions &&
                fields.length > 2 &&
                isJournalSectionVisible &&
                !isJournalBottomVisible &&
                !isSaveSummaryVisible ? (
                <div
                  data-testid="verification-balance-dock"
                  role="status"
                  aria-live="polite"
                  aria-label={
                    isBalanced
                      ? "Konteringen balanserar"
                      : `Konteringen skiljer ${balanceDifference.toLocaleString("sv-SE", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} kronor`
                  }
                  className="verification-balance-dock pointer-events-none z-20"
                >
                  <div
                    className={`verification-balance-dock-panel grid grid-cols-3 divide-x border-t px-4 pt-2.5 shadow-[0_-8px_24px_rgba(78,55,47,0.1)] backdrop-blur-md sm:px-6 ${
                      isBalanced
                        ? "divide-stone-200 border-stone-300 bg-[#fffdf9]/98"
                        : "divide-[#e4c8bf] border-[#c98773] bg-[#fbf1ed]/98"
                    }`}
                  >
                    <div className="min-w-0 px-2 sm:px-3">
                      <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-stone-400 sm:text-[9px]">
                        Debet
                      </p>
                      <p className="mt-0.5 truncate text-[11px] font-bold tabular-nums text-stone-900 sm:text-xs">
                        {currentSums.debit.toLocaleString("sv-SE", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="min-w-0 px-2 sm:px-3">
                      <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-stone-400 sm:text-[9px]">
                        Kredit
                      </p>
                      <p className="mt-0.5 truncate text-[11px] font-bold tabular-nums text-stone-900 sm:text-xs">
                        {currentSums.credit.toLocaleString("sv-SE", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                    <div className="min-w-0 px-2 text-right sm:px-3">
                      <p
                        className={`text-[8px] font-bold uppercase tracking-[0.12em] sm:text-[9px] ${
                          isBalanced ? "text-stone-400" : "text-[#985744]"
                        }`}
                      >
                        Diff
                      </p>
                      <p
                        className={`mt-0.5 truncate text-[11px] font-bold tabular-nums sm:text-xs ${
                          isBalanced ? "text-stone-700" : "text-[#985744]"
                        }`}
                      >
                        {balanceDifference.toLocaleString("sv-SE", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </div>
                  </div>
                </div>
                ) : null}

                {fields.map((entry, index) => (
                  <div
                    key={entry.id}
                    className="verification-entry-card w-full min-w-0 max-w-full rounded-[1.25rem] border border-stone-200 bg-[#fbfaf8] p-4 shadow-[0_1px_0_rgba(41,37,36,0.03)] sm:p-5"
                  >
                    <div className="mb-4 flex min-h-[2rem] items-center border-b border-stone-200 pb-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-500">
                        Konteringsrad {index + 1}
                      </p>
                    </div>

                    <div className="verification-entry-grid grid w-full min-w-0 max-w-full gap-3">
                      <div className="min-w-0">
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
                                  className="min-w-0 max-w-full text-sm"
                                  classNamePrefix="verification-account"
                                />
                              )}
                            </ClientOnly>
                          )}
                        />
                      </div>

                      <JournalEntryAmountField
                        id={`journal-entry-${index}`}
                        debit={Number(currentEntries[index]?.debit || 0)}
                        credit={Number(currentEntries[index]?.credit || 0)}
                        onChange={({ debit, credit }) => {
                          setValue(`journalEntries.${index}.debit`, debit, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                          setValue(`journalEntries.${index}.credit`, credit, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                        }}
                      />
                    </div>
                  </div>
                ))}
                </div>

                <button
                  ref={journalBottomRef}
                  type="button"
                  onClick={handleAddRow}
                  className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-[#fffdf9] px-5 text-sm font-bold text-stone-600 transition hover:border-[#c58a79] hover:bg-[#fbf3ef] hover:text-[#985744] sm:w-auto"
                >
                  <span aria-hidden="true" className="mr-2 text-lg"><PlusMinusIcon /></span>
                  Lägg till konteringsrad
                </button>
              </div>
            </section>
          </div>

          <aside className={`${showMobileUpload ? "block" : "hidden"} verification-aside min-w-0 max-w-full space-y-3`}>
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#985744]">
                  Underlag
                </p>
                <h3 className="mt-1 text-base font-bold text-slate-950">
                  Snabbast med en fil
                </h3>
              </div>

              {uploadingState === UploadingState.UPLOADING ? (
                <div
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  className="border-y border-stone-200 py-4"
                >
                  <div className="flex items-start gap-3.5">
                    <span
                      aria-hidden="true"
                      className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center"
                    >
                      <span className="absolute h-8 w-8 animate-ping rounded-full bg-[#c98773]/15 motion-reduce:animate-none" />
                      <span className="relative h-2.5 w-2.5 rounded-full bg-[#a85f4b]" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#985744]">
                        Läser underlag
                      </p>
                      <p className="mt-1 truncate font-serif text-lg leading-tight text-stone-950">
                        {selectedFile?.name ?? "Vald fil"}
                      </p>
                      {protectingManualInput ? (
                        <p className="mt-1 text-xs leading-5 text-stone-500">
                          Dina ifyllda uppgifter ligger kvar.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : uploadingState === UploadingState.FAILED ? (
                <div
                  role="alert"
                  className="border-y border-[#d7b0a3] py-5"
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#985744]">
                    Uppladdningen avbröts
                  </p>
                  <p className="mt-1 font-serif text-lg leading-tight text-stone-950">
                    Det gick inte att läsa filen
                  </p>
                  <p className="mt-2 text-xs leading-5 text-stone-600">
                    {uploadError ??
                      "Prova igen med en PDF eller vanlig bildfil."}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        setUploadedFile(null);
                        setUploadError(null);
                        setProtectingManualInput(false);
                        setUploadingState(UploadingState.IDLE);
                      }}
                      className="inline-flex h-10 items-center border-b border-[#a85f4b] px-0.5 text-xs font-bold text-[#985744] transition hover:text-[#7c4435]"
                    >
                      Välj en annan fil
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        setUploadedFile(null);
                        setUploadError(null);
                        setReviewSuggestions([]);
                        setInterpretationWarnings([]);
                        setProtectingManualInput(false);
                        setUploadingState(UploadingState.IDLE);
                        setEntryMode("manual");
                      }}
                      className="inline-flex h-10 items-center px-0.5 text-xs font-bold text-stone-500 transition hover:text-stone-900"
                    >
                      Fortsätt manuellt
                    </button>
                  </div>
                </div>
              ) : uploadingState === UploadingState.REVIEW && singleReviewSuggestion ? (
                <div className="border-y border-[#d7b0a3] py-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#985744]">
                    Kontrollera förslaget
                  </p>
                  <SuggestedDateNotice notice={singleReviewDateNotice} />
                  <button
                    type="button"
                    onClick={() => applySuggestion(singleReviewSuggestion)}
                    className="group mt-2 block w-full text-left"
                  >
                    <span className="line-clamp-2 text-sm font-bold leading-5 text-stone-900">
                      {singleReviewSuggestion.description}
                    </span>
                    <span className="mt-1 block text-[11px] text-stone-500">
                      {singleReviewSuggestion.date}
                      {singleReviewSuggestion.sourceReference
                        ? ` · ${singleReviewSuggestion.sourceReference}`
                        : ""}
                    </span>
                    <span className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-[#985744] transition group-hover:text-[#7c4435]">
                      {singleReviewDateNotice?.blocksAutomaticDate
                        ? "Använd och välj datum"
                        : "Använd förslaget"}
                      <span aria-hidden="true"><ArrowIcon /></span>
                    </span>
                  </button>
                  <ReviewWarnings warnings={singleReviewWarnings} />
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
                        ? "Dina ifyllda uppgifter ligger kvar."
                        : "Välj posten som ska bokföras."}
                    </p>
                  </div>
                  {reviewSuggestions.map((suggestion) => {
                    const dateNotice = getVerificationSuggestionDateNotice({
                      dateKey: suggestion.date,
                      fiscalYear: data.year,
                    });
                    return (
                    <div
                      key={suggestion.uiId}
                      className="rounded-xl border border-[#dfc1b7] bg-white transition hover:border-[#b86e59]"
                    >
                      <button
                        type="button"
                        onClick={() => applySuggestion(suggestion)}
                        className="block w-full p-3 text-left"
                      >
                        <span className="line-clamp-2 text-xs font-bold leading-5 text-stone-900">
                          {suggestion.description}
                        </span>
                        <span className="mt-1 block text-[11px] text-stone-500">
                          {suggestion.date}{suggestion.sourceReference ? ` · ${suggestion.sourceReference}` : ""}
                        </span>
                        <span className="mt-2 block text-[11px] font-bold text-[#985744]">
                          {dateNotice?.blocksAutomaticDate
                            ? "Använd och välj datum"
                            : "Använd förslaget"}
                        </span>
                      </button>
                      <div className="px-3 pb-2">
                        <SuggestedDateNotice notice={dateNotice} />
                        <ReviewWarnings warnings={suggestion.warnings} />
                      </div>
                    </div>
                    );
                  })}
                  <ReviewWarnings
                    label="Om dokumentet"
                    warnings={interpretationWarnings}
                  />
                </div>
              ) : uploadedFile ? (
                <div className="rounded-2xl border border-[#dfbcae] bg-[#fbf1ed] p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-[#985744]">
                    Underlag kopplat
                  </p>
                  <p className="mt-1 truncate text-sm font-bold text-stone-900">
                    {uploadedFile.label}
                  </p>
                  <ReviewWarnings warnings={interpretationWarnings} />
                  <button
                    type="button"
                    onClick={removeUploadedMaterial}
                    className="mt-3 inline-flex min-h-10 items-center text-xs font-bold text-[#985744] transition hover:text-[#7c4435]"
                  >
                    Ta bort underlag
                  </button>
                </div>
              ) : (
                <FileUpload
                  onFileSelected={(file) => {
                    setEntryMode("upload");
                    const currentValues = getValues();
                    const hasManualInput = hasMeaningfulVerificationInput({
                      description: currentValues.description,
                      journalEntries: currentValues.journalEntries,
                      verificationDate: currentValues.verificationDate,
                      initialVerificationDate,
                    });
                    preUploadFormValuesRef.current = hasManualInput
                      ? {
                          description: currentValues.description,
                          verificationDate: currentValues.verificationDate,
                          journalEntries: currentValues.journalEntries.map(
                            (entry) => ({ ...entry })
                          ),
                        }
                      : null;
                    setSelectedFile(file);
                    setUploadedFile({ label: file.name });
                    setUploadError(null);
                    setReviewSuggestions([]);
                    setInterpretationWarnings([]);
                    setSuggestedDateNotice(null);
                    setProtectingManualInput(hasManualInput);
                    setUploadingState(UploadingState.UPLOADING);
                    const formData = new FormData();
                    formData.append("file", file);
                    interpretationFetcher.submit(formData, {
                      action: "/admin/verifications/files/parse",
                      method: "post",
                      encType: "multipart/form-data",
                    });
                  }}
                />
              )}
            </section>

            <div className="verification-desktop-note hidden rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-500 shadow-sm">
              <p className="font-bold text-slate-800">Manuell registrering</p>
              <p className="mt-1">
                Det går lika bra att fylla i uppgifterna direkt utan underlag.
              </p>
            </div>
          </aside>
        </div>

        {showVerificationActions ? (
          <div
            ref={saveSummaryRef}
            className="w-full min-w-0 max-w-full border-t border-stone-300 pt-4"
          >
            {saveBlockReason ? (
              <p
                id="verification-save-block-reason"
                role="status"
                className="mb-3 text-xs font-semibold leading-5 text-[#985744]"
              >
                {saveBlockReason}
              </p>
            ) : null}
            <div className="grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-4 sm:flex sm:items-center sm:justify-between">
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
                  <p className="mt-1 text-sm font-bold text-[#985744]">
                    {isBalanced ? "Balanserar" : "Inte klar"}
                  </p>
                </div>
                <span className="sr-only">
                  {isBalanced ? "Konteringen balanserar" : "Konteringen är inte klar"}
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
                  aria-describedby={saveBlockReason ? "verification-save-block-reason" : undefined}
                  className="inline-flex h-12 min-w-[7.75rem] items-center justify-center gap-2 rounded-xl border border-[#a85f4b] bg-[#a85f4b] px-4 text-sm font-bold text-white shadow-[0_6px_16px_rgba(126,67,51,0.14)] transition hover:-translate-y-px hover:border-[#8f4f3e] hover:bg-[#8f4f3e] focus:outline-none focus:ring-2 focus:ring-[#d7b0a3] focus:ring-offset-2 disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-stone-200 disabled:text-stone-500 disabled:shadow-none disabled:hover:translate-y-0 sm:h-14 sm:w-full sm:rounded-2xl sm:px-6"
                >
                  <span className="sm:hidden">Spara</span>
                  <span className="hidden sm:inline">Spara verifikation</span>
                  <span aria-hidden="true" className="text-base"><ArrowIcon /></span>
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </form>
    </section>
  );
}
