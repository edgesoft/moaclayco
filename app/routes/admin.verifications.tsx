import { useState, useEffect, useRef } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { z, ZodError } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import Select from "react-select";
import {
  ActionFunction,
  json,
  LoaderFunction,
  redirect,
} from "@remix-run/node";
import {
  Outlet,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigate,
  useSubmit,
} from "@remix-run/react";
import { Verifications } from "~/schemas/verifications";
import { generateNextEntryNumber } from "~/utils/verificationUtil";
import { toast } from "react-toastify";
import React from "react";
import { classNames } from "~/utils/classnames";
import stripeClient from "~/stripeClient";
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

const accounts = [
  { value: 1580, label: "1580 - Fordran på Stripe" },
  {value: 1510, label: "1510 - Kundfordringar"},
  { value: 1930, label: "1930 - Bank" },
  { value: 2013, label: "2013 - Eget uttag" },
  { value: 2018, label: "2018 - Egen insättning" },
  { value: 2611, label: "2611 - Utgående moms på varor och frakt" },
  { value: 2640, label: "2640 - Ingående moms" },
  { value: 3001, label: "3001 - Försäljning av varor", vatAccount: 2611 }, // Moms krävs
  { value: 3740, label: "3740 - Öres- och kronutjämning" },
  { value: 4000, label: "4000 - Material/Varukostnader", vatAccount: 2640 }, // Moms krävs
  { value: 6570, label: "6570 - Kostnader för betalningsförmedling" },
];

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();

  // Kör båda asynkrona anropen parallellt med Promise.all()
  const [verifications, payouts] = await Promise.all([
    Verifications.find({
      verificationDate: {
        $gte: new Date(`${year}-01-01`),
        $lt: new Date(`${year + 1}-01-01`),
      },
    }).sort({ verificationDate: -1 }),
  ]);

  return json({ verifications, year });
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
      file = undefined
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
      files: file ? [{name: file.label, path: file.filePath}] : []
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

const groupByMonth = (verifications) => {
  const grouped = {};

  verifications.forEach((verification) => {
    const date = new Date(verification.verificationDate);
    const monthKey = `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, "0")}`;

    if (!grouped[monthKey]) {
      grouped[monthKey] = [];
    }
    grouped[monthKey].push(verification);
  });

  return grouped;
};

// Helper function to format the date
const formatDate = (dateString) => {
  const date = new Date(dateString);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
};

// Helper function to format month name (e.g. "January 2024")
const formatMonthName = (yearMonthKey) => {
  const [year, month] = yearMonthKey.split("-");
  const monthNames = [
    "Januari",
    "Februari",
    "Mars",
    "April",
    "Maj",
    "Juni",
    "Juli",
    "Augusti",
    "September",
    "Oktober",
    "November",
    "December",
  ];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
};


type SuggestionProps = {
  status: string,
  verificationData: {},
  uuid: string
}


const FileUpload = ({
  onSuggestionsReceived,
  onFileSelected
}: {
  onSuggestionsReceived: (suggestions: SuggestionProps) => void;
  onFileSelected: (file: File) => void // Definiera en typ för callback-funktionen
}) => {
  const fileInputRef = useRef(null);
  const fetcher = useFetcher<SuggestionProps>();
  const [uuid, setUuid] = useState<String|null>()

  useEffect(() => {
    if(fetcher && fetcher.data ) {

      if (!uuid || uuid !== fetcher.data.uuid) {
        setUuid(fetcher.data.uuid)
        onSuggestionsReceived(fetcher.data); 
      }

     
    }

  }, [fetcher, fetcher.data])

  const handleFileInputClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    fileInputRef.current.click();
  };

  const handleFileChange = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const file = event.target.files[0];
    if (file) {
      const formData = new FormData();
      formData.append("file", file);
      onFileSelected(file)
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
}

export default function VerificationsPage() {
  const { verifications, year } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const [uploadedFile, setUploadedFile] = useState(null); // Nytt state för att hålla filinfo


  const groupedVerifications = groupByMonth(verifications);

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

    // Kombinera errors från både formuläret och actionData
    const combinedErrors = { ...errors, ...actionData?.errors };

    // Hantera fel genom att leta efter första felet
    const firstError = findFirstError(combinedErrors);
    if (firstError) {
      showToast(firstError); // Visa det första felet som hittas
      return;
    }

    if (actionData && actionData.success) {
      toast.success(
        `Verfikation ${actionData.verification.verificationNumber} sparades`,
        {
          position: "top-right",
          autoClose: 2000,
          hideProgressBar: true,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: false,
          progress: undefined,
          theme: "dark",
        }
      );
    }
  }, [actionData, errors]);

  const yearOptions = Array.from({ length: 10 }, (_, i) => {
    const currentYear = new Date().getFullYear();
    return { value: currentYear - i, label: `${currentYear - i}` };
  });

  const handleYearChange = (selectedOption: any) => {
    const selectedYear = selectedOption.value;
    submit(null, {
      action: `/admin/verifications?year=${selectedYear}`,
      replace: true,
    });
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

  const { fields, append, remove } = useFieldArray({
    control,
    name: "journalEntries",
  });

  const truncateText = (text, maxLength) => {
    return text.length > maxLength
      ? `${text.substring(0, maxLength)}...`
      : text;
  };

  const hasVatReport = (verifications, monthKey) => {
    return verifications.some((verification) =>
      verification.metadata.some(
        (meta) => meta.key === "vatReport" && meta.value === monthKey
      )
    );
  };

  const isPastMonth = (yearMonthKey) => {
    const [year, month] = yearMonthKey.split("-");
    const currentDate = new Date();
    const currentYearMonth = `${currentDate.getFullYear()}-${String(
      currentDate.getMonth() + 1
    ).padStart(2, "0")}`;
    return yearMonthKey < currentYearMonth;
  };

  const navigate = useNavigate();

  const handleCreateVATReport = (monthKey) => {
    navigate(`/admin/verifications/vat-report?month=${monthKey}`);
  };

  function handleSuggestions(data: SuggestionProps): void {

    console.log("data", data)
      if (data.status === "success" && data.verificationData ) {
        if (data && data.verificationData && data.verificationData.accounts) {
          remove(fields.map((_, index) => index));
          setValue("description", data.verificationData.description || "");
          setValue("verificationDate", data.verificationData.date || "");
          setUploadedFile(data.file); 

          Object.entries(data.verificationData.accounts).forEach(([accountNumber, values]) => {
            append({ account: Number(accountNumber) , debit: values.debit || undefined, credit: values.credit || undefined });
          });
        } else {
          console.error("Account data saknas");
        }
   
    
      } else {
        console.log("FAILED")
      }


  }

  return (
    <div className="mt-20 p-2">
      <div className="w-64 mb-4">
        {/*
        <label htmlFor="year" className="mr-2">
          Välj bokföringsår:
        </label>
        <Select
          options={yearOptions}
          defaultValue={yearOptions.find((option) => option.value === year)}
          onChange={handleYearChange}
          isSearchable={true}
        />
       */}
      </div>
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
                progress: undefined,
                theme: "dark",
              }
            );
          } else {
            const formData = {
              ...data,
              file: uploadedFile ? JSON.stringify(uploadedFile): {},
              journalEntries: JSON.stringify(data.journalEntries),
            };
            submit(formData, { method: "post" });
            setUploadedFile(null)
            reset();
          }
        })}
      >
        <div className="flex space-x-4">
         
          {/* Kolumn 1: Beskrivning */}
          <div className="w-2/3">
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700"
            >
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

          {/* Kolumn 2: Datum */}
          <div className="w-1/3">
            <label
              htmlFor="verificationDate"
              className="block text-sm font-medium text-gray-700"
            >
              Datum:
            </label>
            <input
              {...register("verificationDate")}
              type="date"
              defaultValue={new Date().toISOString().split("T")[0]} // Sätt till dagens datum
              className={`input mt-1 block w-full px-3 py-2 border rounded-md shadow-sm sm:text-sm ${
                errors.verificationDate
                  ? "border-red-500 focus:ring-red-500 focus:border-red-500"
                  : "border-gray-300 focus:ring-blue-500 focus:border-blue-500"
              }`}
            />
          </div>
        </div>
        <div>
          {fields.map((entry, index) => (
            <div key={entry.id} className="flex space-x-4 mt-2">
              <div className="w-1/3">
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
                          onChange={(option) =>
                            field.onChange(option ? option.value : null)
                          }
                          value={accounts.find(
                            (acc) => acc.value === field.value
                          )}
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
                className="input h-10  mt-1 blocks px-3 py-2 border rounded-md shadow-sm sm:text-sm"
              />
              <input
                type="number"
                step="0.01"
                placeholder="Kredit"
                {...register(`journalEntries.${index}.credit` as const)}
                className="input h-10  mt-1 blocks px-3 py-2 border rounded-md shadow-sm  sm:text-sm"
              />
              <button
                type="button"
                onClick={() => remove(index)}
                className="inline-flex justify-center mb-2 mt-2 px-4 py-2 w-full text-white text-base font-medium bg-slate-800 hover:bg-slate-900 border border-transparent rounded-md focus:outline-none shadow-sm focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 sm:w-auto sm:text-sm"
              >
                Ta bort
              </button>
            </div>
          ))}
          <div className="w-full flex space-x-4">
          <button
            type="button"
            onClick={() => {
              handleAddRow();
            }}
            className="inline-flex justify-center mb-2 mt-2 px-4 py-2 w-full text-white text-base font-medium bg-blue-600 hover:bg-blue-700 border border-transparent rounded-md focus:outline-none shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto sm:text-sm"
          >
            Lägg till rad
          </button>
          <button
            type="submit"
            className="ml-4 inline-flex justify-center mb-2 mt-2 px-4 py-2 w-full text-white text-base font-medium bg-blue-600 hover:bg-blue-700 border border-transparent rounded-md focus:outline-none shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 sm:w-auto sm:text-sm"
          >
            Spara
          </button>
          <FileUpload onSuggestionsReceived={handleSuggestions} onFileSelected={(file) => {
            setTimeout(() => {
              remove(fields.map((_, index) => index));
              setValue("description", "")
              setValue("verificationDate",  new Date().toISOString().split("T")[0])
             
            }, 100)
          }}/>
          </div>
        </div>
      </form>

      <div className="mb-20 mt-20 mx-auto">
        {Object.keys(groupedVerifications).map((monthKey) => {
          const monthHasVatReport = hasVatReport(verifications, monthKey);
          // Summera debet och kredit för varje månad
          const monthDebetSum = groupedVerifications[monthKey].reduce(
            (sum, ver) =>
              sum +
              ver.journalEntries.reduce((acc, entry) => acc + entry.debit, 0),
            0
          );
          const monthCreditSum = groupedVerifications[monthKey].reduce(
            (sum, ver) =>
              sum +
              ver.journalEntries.reduce((acc, entry) => acc + entry.credit, 0),
            0
          );

          return (
            <div key={monthKey} className="mb-8">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">
                  {formatMonthName(monthKey)}
                </h2>
                <Outlet />
                {!monthHasVatReport && isPastMonth(monthKey) && (
                  <button
                    onClick={() => handleCreateVATReport(monthKey)}
                    className="bg-slate-800 text-white px-3 py-1 rounded-lg text-sm"
                  >
                    Skapa momsrapport ({formatMonthName(monthKey)})
                  </button>
                )}
              </div>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Verifikationsnummer
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Datum
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Konto
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Debit
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Kredit
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {groupedVerifications[monthKey].map((verification) => {
                    // Summera debit och kredit per verifikation
                    const debitSum = verification.journalEntries.reduce(
                      (sum, entry) => sum + entry.debit,
                      0
                    );
                    const creditSum = verification.journalEntries.reduce(
                      (sum, entry) => sum + entry.credit,
                      0
                    );

                    return (
                      <React.Fragment key={verification.verificationNumber}>
                        <tr className="">
                          <td className="px-2 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            <span
                              className={classNames(
                                `bg-green-600 text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full`
                              )}
                            >
                              {" "}
                              A{verification.verificationNumber}
                            </span>
                          </td>
                          <td className="px-2 py-4 whitespace-nowrap text-sm text-gray-500">
                            {formatDate(verification.verificationDate)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            <button
                              onClick={() => {
                                navigate(
                                  `/admin/verifications/${verification.verificationNumber}/files`
                                );
                              }}
                              className="bg-slate-800 text-white px-2 py-1 rounded-lg font-semibold text-xs"
                            >
                              Koppla fil
                            </button>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">
                            {debitSum.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">
                            {creditSum.toFixed(2)}
                          </td>
                        </tr>
                        {/* Rad utan divider */}
                        <tr className="border-b border-gray-200 ">
                          <td
                            colSpan={5}
                            className="border-0 text-xs text-gray-500"
                          >
                            <div className="mb-2">
                              <span
                                dangerouslySetInnerHTML={{
                                  __html: verification.description.replace(
                                    /\r\n/g,
                                    "<br />"
                                  ),
                                }}
                              />
                              <ul className="">
                                {verification.files.map((file, index) => (
                                  <li
                                    key={index}
                                    className="py-2 flex justify-between"
                                  >
                                    <a
                                      href={file.path}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-500"
                                    >
                                      <span>{file.name}</span>
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </td>
                        </tr>

                        {/* Lista alla journalEntries för denna verifikation */}
                        {verification.journalEntries.map((entry, index) => {
                          if (entry.credit === 0 && entry.debit === 0)
                            return null;
                          return (
                            <tr
                              key={index}
                              className="bg-gray-50 border-b border-gray-200"
                            >
                              <td colSpan={2}></td>
                              <td className="px-6 py-2 text-sm text-gray-500">
                                {entry.account}
                              </td>
                              <td className="px-6 py-2 text-right text-sm text-gray-500">
                                {entry.debit > 0 ? entry.debit.toFixed(2) : "-"}
                              </td>
                              <td className="px-6 py-2 text-right text-sm text-gray-500">
                                {entry.credit > 0
                                  ? entry.credit.toFixed(2)
                                  : "-"}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                  {/* Summering för månaden */}
                  <tr className="bg-gray-100">
                    <td
                      colSpan={3}
                      className="px-6 py-2 text-right font-bold"
                    ></td>
                    <td className="px-6 py-2 text-right font-bold">
                      {monthDebetSum.toFixed(2)}
                    </td>
                    <td className="px-6 py-2 text-right font-bold">
                      {monthCreditSum.toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
