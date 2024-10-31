import {
  useNavigate,
  useSearchParams,
  useLoaderData,
  useSubmit,
} from "@remix-run/react";
import {
  ActionFunction,
  json,
  LoaderFunction,
  redirect,
} from "@remix-run/node";
import { Controller, useForm } from "react-hook-form";
import { Verifications } from "~/schemas/verifications"; // Din MongoDB schema
import { classNames } from "~/utils/classnames";
import { generateNextEntryNumber } from "~/utils/verificationUtil";
import { formatMonthName } from "~/utils/formatMonthName";
import ClientOnly from "~/components/ClientOnly";
import Select from "react-select";
import { z, ZodError } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

// Loader-funktion för att hämta verifikationer från MongoDB för en viss månad
export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const month = url.searchParams.get("month"); // Få månaden som query param
  if (!month) {
    return json({ error: "Ingen månad specificerad" }, { status: 400 });
  }

  const [year, monthNumber] = month.split("-"); // Dela upp månad och år
  // Skapa start- och slutdatum för månaden
  const startOfMonth = new Date(Number(year), Number(monthNumber) - 1, 1); // Första dagen i månaden
  const endOfMonth = new Date(Number(year), Number(monthNumber), 0); // Sista dagen i månaden
  endOfMonth.setHours(23, 59, 59, 999); // Sätt tiden till slutet av dagen

  const verification = await Verifications.findOne({
    "metadata.key": "vatReport",
    "metadata.value": month,
  });

  return json({ verification });
};

const accounts = [
  { value: 1930, label: "1930 - Bank" },
  { value: 2018, label: "2018 - Egen insättning" },
];

export const action: ActionFunction = async ({ request, params }) => {
  const formData = await request.formData();
  const submissionDate = formData.get("submissionDate");
  const amount = formData.get("amount");
  const accountNumber = formData.get("account");
  
  if (!submissionDate) {
    return json({ error: "Inget datum valt" }, { status: 400 });
  }

  const url = new URL(request.url);
  const month = url.searchParams.get("month"); // Få månaden som query param
  if (!month) {
    return json({ error: "Ingen månad specificerad" }, { status: 400 });
  }

  const verification = await Verifications.findOne({
    "metadata.key": "vatReport",
    "metadata.value": month,
  });

  const account = verification.journalEntries.find(
    (entry) => entry.account === 2650
  );

  // Format submissionDate som en Date i MongoDB
  const formattedDate = new Date(submissionDate);

  await Verifications.findByIdAndUpdate(verification._id, {
    $push: { metadata: {
      key: "vatRegisteredAtAccount",
      value: "true"
    } },
  });

  const newVerification = new Verifications({
    description: `Inbetalning moms Skattemyndigheten`,
    verificationNumber: await generateNextEntryNumber(),
    verificationDate: formattedDate,
    journalEntries: [
      {
        account: 2650,
        debit: account.credit,
        credit: 0,
      },
      {
        account: 2050,
        debit: 0,
        credit: account.credit,
      },
      {
        account: 2012,
        debit: amount,
        credit: 0,
      },
      
      {
        account: accountNumber,
        debit: 0,
        credit: amount,
      }
      
    ],
  });

  console.log(newVerification);

  await newVerification.save();

  return redirect("/admin/verifications");
};

const formSchema = z.object({
  amount: z.preprocess(
    (v) => (v === "" || v === null ? 0 : parseFloat(v as string)),
    z.number().min(0, "Belopp är obligatorsikt")
  ),
  submissionDate: z.string().min(1, "Datum är obligatoriskt"),
  account: z.number().min(1, "Konto är obligatorsikt"),
});

type FormData = z.infer<typeof formSchema>;

// VATReportModal-komponenten
export default function VATReportModal() {
  const navigate = useNavigate();
  const { verification } = useLoaderData(); // Data från loader
  const [searchParams] = useSearchParams();
  const month = searchParams.get("month") || "";
  const account = verification.journalEntries.find(
    (entry) => entry.account === 2650
  );
  const submit = useSubmit();
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
      amount: Number(account.credit)
    }
  });


  // Funktion som körs när användaren klickar på "Skapa verifikation"
  const onSubmit = (data) => {
    console.log("Skapar verifikation med följande data:", data);
    // Skicka data till servern eller utför någon åtgärd här

    submit(data, { method: "post" });
  };

  return (
    <div
      className="fixed z-10 inset-0 overflow-y-auto"
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex items-end justify-center text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"></div>
        <span
          className="hidden sm:inline-block sm:align-middle sm:h-screen"
          aria-hidden="true"
        >
          &#8203;
        </span>
        <div className="inline-block align-bottom text-left bg-white rounded-lg shadow-xl overflow-hidden transform transition-all sm:align-middle sm:my-8 sm:w-full sm:max-w-6xl">
          <div className="bg-white px-6 py-5 sm:p-6 sm:pb-4">
            <div className="sm:flex sm:items-start ">
              <div className="text-center sm:ml-4 sm:text-left w-full">
                <h3
                  className="text-xl leading-6 font-bold text-gray-900"
                  id="modal-title"
                >
                  Registrera hos Skattemyndigheten (moms{" "}
                  {formatMonthName(month)})
                </h3>

                <div className="mt-6">
                  <div className="mb-6">
                    <form
                      onSubmit={handleSubmit(onSubmit)}
                      className="space-y-4 mt-4 w-full"
                    >
                      <div className="flex space-x-4 w-full">
                        <div className="flex flex-col w-1/2">
                          <span>Summa inbetalt för moms</span>
                          <input
                            type="number"
                             step="0.01"
                            id="amount"
                            {...register(`amount` as const)}
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                          />
                        </div>

                        <div className="flex flex-col w-1/2">
                          <span>Datum</span>
                          <input
                            type="date"
                            id="submissionDate"
                            {...register("submissionDate", { required: true })}
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                          />
                        </div>
                        <div className="flex flex-col w-1/2">
                          <span>Konto</span>
                          <Controller
                            control={control}
                            key={`account`}
                            name={`account`}
                            render={({ field }) => (
                              <ClientOnly fallback={null}>
                                {() => (
                                  <Select
                                    instanceId={`account-select-1`}
                                    {...field}
                                    options={accounts}
                                    onChange={(option) =>
                                      field.onChange(
                                        option ? option.value : null
                                      )
                                    }
                                    value={accounts.find(
                                      (acc) => acc.value === field.value
                                    )}
                                    placeholder="Välj konto"
                                    className="mt-1 block w-full pb-1 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                  />
                                )}
                              </ClientOnly>
                            )}
                          />
                        </div>
                      </div>

                      {/* Skapa verifikation-knapp på egen rad */}
                      <div className="w-full flex justify-end">
                        <button
                          type="submit"
                          className="inline-flex items-center justify-center px-4 py-2 text-white text-base font-medium bg-blue-600 hover:bg-blue-700 border border-transparent rounded-md focus:outline-none shadow-sm focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                        >
                          Skapa verifikation
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-6 py-3 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
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
