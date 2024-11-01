import {
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigate,
  useOutletContext,
  useSubmit,
} from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { z, ZodError } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "react-toastify";
import Select from "react-select";
import { accounts } from "~/utils/accounts";
import { VerificationProps } from "~/types";
import { generateNextEntryNumber } from "~/utils/verificationUtil";
import { Verifications } from "~/schemas/verifications";
import { ActionFunction, json } from "@remix-run/node";
import ClientOnly from "~/components/ClientOnly";

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
    .min(1, "Du måste lägga till minst en journalpost")
    .refine(
      (entries) => entries.some((entry) => entry.debit > 0 || entry.credit > 0),
      {
        message: "Varje rad måste ha ett debet eller kreditvärde",
      }
    ),
  file: z
    .object({
      filePath: z.string().url(),
      label: z.string(),
    })
    .optional(), // Markera filen som valfri
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
    file?: {
      filePath: string;
      label: string;
    };
  };
  
  type SuggestionProps = {
    status: string;
    verificationData: VerificationData;
    uuid: string;
  };

const FileUpload = ({
  onSuggestionsReceived,
  onFileSelected,
}: {
  onSuggestionsReceived: (suggestions: SuggestionProps) => void;
  onFileSelected: (file: File) => void; // Definiera en typ för callback-funktionen
}) => {
  const fileInputRef = useRef(null);
  const fetcher = useFetcher<SuggestionProps>();
  const [uuid, setUuid] = useState<String | null>();

  useEffect(() => {
    if (fetcher && fetcher.data) {
      if (!uuid || uuid !== fetcher.data.uuid) {
        setUuid(fetcher.data.uuid);
        onSuggestionsReceived(fetcher.data);
      }
    }
  }, [fetcher, fetcher.data]);

  const handleFileInputClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    fileInputRef.current.click();
  };

  const handleFileChange = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.target.files[0];
    if (file) {
      const formData = new FormData();
      formData.append("file", file);
      onFileSelected(file);
      fetcher.submit(formData, {
        action: "/admin/verifications/files/parse",
        method: "post",
        encType: "multipart/form-data",
      });

      event.target.value = "";
    }
  };

  return (
    <div>
      <button
        onClick={handleFileInputClick}
        className="inline-flex justify-center mb-2 mt-2 px-4 py-2 w-full text-white text-base font-medium bg-blue-600 hover:bg-blue-700 border border-transparent rounded-md focus:outline-none shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto sm:text-sm"
      >
        Välj fil
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
  toast.info(
    <div>
      Kontot är {account}. Vill du fördela moms ({devide})
      <div className="flex space-x-4 mt-2">
        <button
          onClick={() => {
            onConfirm();
            toast.dismiss(); // Stäng toasten efter valet
          }}
          className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
        >
          Ja
        </button>
        <button
          onClick={() => {
            onCancel();
            toast.dismiss(); // Stäng toasten efter valet
          }}
          className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Nej
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

    type JournalEntry = {
        account: number | undefined;
        debit: number | undefined;
        credit: number | undefined;
      };

export const action: ActionFunction = async ({ request, params }) => {
    const formData = await request.formData();
    const description = formData.get("description");
    const verificationDate = formData.get("verificationDate"); 
    const journalEntries = JSON.parse(formData.get("journalEntries") as string);
  
    // Deserialisera filinformationen om den finns
    let file = null;
    const fileData = formData.get("file");
    if (fileData) {
      try {
        file = JSON.parse(fileData as string); // Filinmatningen är JSON, deserialisera den
      } catch (error) {
        file = undefined;
        console.error("Error parsing file data:", error);
      }
    }
  
    const dateForDatabase = new Date(verificationDate);
  
    // Validera med Zod och kolla om resultatet är success
    const result = formSchema.safeParse({
      description,
      file,
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
  
    try {
      const newVerification = new Verifications({
        description,
        verificationNumber: await generateNextEntryNumber(),
        verificationDate: dateForDatabase, // Spara som Date om det behövs
        journalEntries,
        files: file ? [{ name: file.label, path: file.filePath }] : [],
      });
  
      await newVerification.save();
  
      return json({
        success: true,
        message: "Verifikation sparades framgångsrikt",
        verification: newVerification,
      });
    } catch (e) {
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

export default function Verification() {
  const actionData = useActionData<ActionData>();
  const data = useOutletContext<ContextType>();
  if (!data) return null
  const submit = useSubmit();
  const [uploadedFile, setUploadedFile] = useState(null); // Nytt state för att hålla filinfo
  const navigate = useNavigate();
  const previousVerification = useRef<number | null>(null);

  const {
    register,
    handleSubmit,
    control,
    getValues,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      journalEntries: [{ account: 0, debit: undefined, credit: undefined }],
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
      append({ account: undefined, debit: undefined, credit: undefined });
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
            debit: debitOrCredit === "credit" ? undefined : Number(vatAmount),
            credit: debitOrCredit === "debit" ? undefined : Number(vatAmount),
          });

          // Lägg till summeringsrad
          append({
            account: undefined, // Tom rad för summering
            debit:
              debitOrCredit === "debit"
                ? undefined
                : Number(baseAmount) + Number(vatAmount),
            credit:
              debitOrCredit === "credit"
                ? undefined
                : Number(baseAmount) + Number(vatAmount),
          });
        },
        () => {
          append({ account: undefined, debit: undefined, credit: undefined });
        }
      );
      return;
    }

    append({ account: undefined, debit: undefined, credit: undefined });
  };

  function handleSuggestions(data: SuggestionProps): void {
    if (data.status === "success" && data.verificationData) {
      if (data && data.verificationData && data.verificationData.accounts) {
        remove(fields.map((_, index) => index));
        setValue("description", data.verificationData.description || "");
        setValue("verificationDate", data.verificationData.date || "");
        setUploadedFile(data.file);

        Object.entries(data.verificationData.accounts).forEach(
          ([accountNumber, values]) => {
            append({
              account: Number(accountNumber),
              debit: values.debit || undefined,
              credit: values.credit || undefined,
            });
          }
        );
      } else {
        console.error("Account data saknas");
      }
    } else {
      console.log("FAILED");
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
      theme: "dark",
    });
  };

  useEffect(() => {

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
        previousVerification.current = verificationNumber
  
        // Visa toast
        toast.success(`Verifikation ${verificationNumber} sparades`, {
          position: "top-right",
          autoClose: 2000,
          hideProgressBar: true,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: false,
          progress: undefined,
          theme: "dark",
        });
      }
    }
  }, [actionData, previousVerification]);

  return (
    <div
  className="fixed z-10 inset-0 overflow-y-auto"
  aria-labelledby="modal-title"
  role="dialog"
  aria-modal="true"
>
  <div className="flex items-center justify-center min-h-screen text-center sm:block sm:p-0">
    <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"></div>
    <span
      className="hidden sm:inline-block sm:align-middle sm:h-screen"
      aria-hidden="true"
    >
      &#8203;
    </span>
    <div className="inline-block align-bottom w-full max-w-md  bg-white rounded-lg text-left shadow-xl overflow-hidden transform transition-all sm:align-middle sm:max-w-6xl">
      <div className="bg-white px-6 py-5">
        <div className="sm:flex sm:items-start">
          <div className="w-full sm:text-left">
            <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
              Ny verifikation
            </h3>
            <div className="mt-6 space-y-2">
              <form
                onSubmit={handleSubmit((data) => {
                  const sums = data.journalEntries.reduce(
                    (acc, { debit = 0, credit = 0 }) => ({
                      debit: acc.debit + Number(debit),
                      credit: acc.credit + Number(credit),
                    }),
                    { debit: 0, credit: 0 }
                  );

                  if (sums.debit.toFixed(2) !== sums.credit.toFixed(2)) {
                    toast.warn(
                      `Debit: ${sums.debit} och kredit: ${sums.credit} stämmer inte överens`,
                      {
                        position: "top-right",
                        autoClose: 2000,
                        hideProgressBar: true,
                        closeOnClick: true,
                        pauseOnHover: true,
                        draggable: false,
                        theme: "dark",
                      }
                    );
                  } else {
                    const formData = {
                      ...data,
                      file: uploadedFile ? JSON.stringify(uploadedFile) : {},
                      journalEntries: JSON.stringify(data.journalEntries),
                    };
                    submit(formData, { method: "post" });
                    setUploadedFile(null);
                    reset();
                  }
                })}
                className="space-y-2"
              >
                <div className="flex flex-col space-y-4 sm:flex-row sm:space-x-4 sm:space-y-0">
                  {/* Description Column */}
                  <div className="flex-1">
                    <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                      Beskrivning:
                    </label>
                    <input
                      {...register("description")}
                      type="text"
                      className={`input mt-1 block w-full px-3 py-2 border rounded-md shadow-sm sm:text-sm ${
                        errors.description
                          ? "border-red-500 focus:ring-red-500 focus:border-red-500"
                          : "border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                      }`}
                    />
                  </div>
                  {/* Date Column */}
                  <div className="flex-1">
                    <label htmlFor="verificationDate" className="block text-sm font-medium text-gray-700">
                      Datum:
                    </label>
                    <input
                      {...register("verificationDate")}
                      type="date"
                      defaultValue={new Date().toISOString().split("T")[0]}
                      className={`input mt-1 block w-full px-3 py-2 border rounded-md shadow-sm sm:text-sm ${
                        errors.verificationDate
                          ? "border-red-500 focus:ring-red-500 focus:border-red-500"
                          : "border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                      }`}
                    />
                  </div>
                </div>

                {/* Journal Entries Section */}
                <div className="space-y-2">
                  {fields.map((entry, index) => (
                    <div key={entry.id} className="flex flex-col space-y-2 sm:flex-row sm:space-x-2 sm:space-y-0">
                      <div className="flex-1">
                        <Controller
                          control={control}
                          key={`account-select-${index}.controller`}
                          name={`journalEntries.${index}.account`}
                          render={({ field }) => (
                            <ClientOnly fallback={null}>
                              {() => (
                                <Select
                                  instanceId={`account-select-${index}`}
                                  {...field}
                                  options={accounts}
                                  onChange={(option) => field.onChange(option ? option.value : null)}
                                  value={accounts.find((acc) => acc.value === field.value)}
                                  placeholder="Välj konto"
                                />
                              )}
                            </ClientOnly>
                          )}
                        />
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Debet"
                        {...register(`journalEntries.${index}.debit` as const)}
                        className="input h-10 mt-1 block px-3 py-2 border rounded-md shadow-sm sm:text-sm"
                      />
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Kredit"
                        {...register(`journalEntries.${index}.credit` as const)}
                        className="input h-10 mt-1 block px-3 py-2 border rounded-md shadow-sm sm:text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="bg-slate-800 text-white rounded-md px-4 py-2 sm:py-1 mt-1"
                      >
                        Ta bort
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex h-10 space-x-2 ">
                <div>
                  <button
                    type="button"
                    onClick={() => handleAddRow()}
                    className="inline-flex justify-center mb-2 mt-2 px-4 py-2 w-full text-white text-base font-medium bg-blue-600 hover:bg-blue-700 border border-transparent rounded-md focus:outline-none shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto sm:text-sm"
                  >
                    Lägg till rad
                  </button>
                  </div>
                  <div>
                  <button
                    type="submit"
                    className="inline-flex justify-center mb-2 mt-2 px-4 py-2 w-full text-white text-base font-medium bg-blue-600 hover:bg-blue-700 border border-transparent rounded-md focus:outline-none shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto sm:text-sm"
                  >
                    Spara
                  </button>
                  </div>
                  <FileUpload
                  onSuggestionsReceived={handleSuggestions}
                  onFileSelected={(file) => {
                    setTimeout(() => {
                      remove(fields.map((_, index) => index));
                      setValue("description", "");
                      setValue("verificationDate", new Date().toISOString().split("T")[0]);
                    }, 100);
                  }}
                />
                </div>

                
              </form>
            </div>
          </div>
        </div>
      </div>
      <div className="bg-gray-50 px-6 py-3 flex justify-end">
        <button
          type="button"
          className="w-full bg-blue-600 text-white rounded-md px-4 py-2 hover:bg-blue-700 sm:w-auto"
          onClick={() => navigate(-1)}
        >
          Stäng
        </button>
      </div>
    </div>
  </div>
</div>

  );
}
