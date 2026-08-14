import {
  Link,
  useSearchParams,
  useLoaderData,
  useActionData,
  useNavigation,
  useSubmit,
  ActionFunction,
  data as json,
  LoaderFunction,
  redirect,
} from "react-router";
import { Controller, useForm } from "react-hook-form";
import { Verifications } from "~/schemas/verifications"; // Din MongoDB schema
import { formatMonthName } from "~/utils/formatMonthName";
import { toLoaderData } from "~/utils/loaderData";
import { auth } from "~/services/auth.server";
import { buildVatReportEntries } from "~/utils/vat";
import { createVerification, ensureIncomingBalance } from "~/services/verification.server";
import {
  accountingYear,
  getAccountingMonthBounds,
  parseAccountingDate,
} from "~/utils/accountingDates";
import { AccountingDateField } from "~/components/admin/AccountingDateField";
import ArrowIcon from "~/components/ArrowIcon";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";
import { vatPeriodVerificationProjection } from "~/utils/queryProjections.server";

type VatJournalEntry = {
  _id?: string;
  account: number;
  debit: number;
  credit: number;
};

type VatVerification = {
  _id: string;
  verificationNumber: number;
  journalEntries: VatJournalEntry[];
};

// Loader-funktion för att hämta verifikationer från MongoDB för en viss månad
export const loader: LoaderFunction = async ({ request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const url = new URL(request.url);

  const month = url.searchParams.get("month"); // Få månaden som query param
  if (!month) {
    throw new Response("Ingen månad specificerad", { status: 400 });
  }

  const bounds = getAccountingMonthBounds(month);
  if (!bounds) throw new Response("Ogiltig månad", { status: 400 });

  // Hämta alla verifikationer för den angivna månaden
    // This should not include IB
  const verifications = (await Verifications.find({
    verificationDate: {
      $gte: bounds.start,
      $lt: bounds.end,
    },
    "metadata.key": { $nin: ["vatReport", "IB"] },
  })
    .select(vatPeriodVerificationProjection)
    .lean()
    .exec()) as unknown as VatVerification[];

  return json(toLoaderData({
    verifications,
  }));
};

export const action: ActionFunction = async ({ request }) => {
  const user = await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });

  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(
      request,
      MAX_STANDARD_FORM_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ error: "Formuläret är för stort" }, { status: 413 });
    }
    throw error;
  }

  const submissionDate = formData.get("submissionDate");

  if (!submissionDate) {
    return json({ error: "Inget datum valt" }, { status: 400 });
  }

  const url = new URL(request.url);
  const month = url.searchParams.get("month");
  if (!month) {
    return json({ error: "Ingen månad specificerad" }, { status: 400 });
  }

  const bounds = getAccountingMonthBounds(month);
  const formattedDate = parseAccountingDate(submissionDate);
  if (!bounds || !formattedDate) {
    return json({ error: "Ogiltig månad eller rapportdatum" }, { status: 400 });
  }
  if (bounds.year !== user.fiscalYear) {
    return json({ error: `Perioden måste tillhöra bokföringsår ${user.fiscalYear}` }, { status: 400 });
  }
  const submissionYear = accountingYear(formattedDate);
  if (!submissionYear) {
    return json({ error: "Ogiltigt rapportdatum" }, { status: 400 });
  }
  if (submissionYear < bounds.year || submissionYear > bounds.year + 1) {
    return json(
      { error: "Du kan inte specificera momsrapporten så långt i förväg" },
      { status: 400 }
    );
  }
  if (formattedDate.getTime() < bounds.end.getTime()) {
    return json(
      { error: "Momsdeklarationen kan registreras först när perioden är avslutad" },
      { status: 400 }
    );
  }

  const existingReport = await Verifications.findOne({
    metadata: { $elemMatch: { key: "vatReport", value: month } },
  })
    .select("verificationNumber")
    .lean();
  if (existingReport) {
    return json({ error: "Momsdeklarationen är redan registrerad" }, { status: 409 });
  }

  // This should not include IB
  const verifications = (await Verifications.find({
    verificationDate: {
      $gte: bounds.start,
      $lt: bounds.end,
    },
    "metadata.key": { $nin: ["vatReport", "IB"] },
  })
    .select("journalEntries.account journalEntries.debit journalEntries.credit")
    .lean()
    .exec()) as unknown as VatVerification[];

  let totalIncomingVat = 0;
  let totalOutgoingVat = 0;

  verifications.forEach((v) => {
    v.journalEntries.forEach((entry) => {
      if (entry.account === 2640) {
        totalIncomingVat += entry.debit || 0;
        totalIncomingVat -= entry.credit || 0;
      }
      if (entry.account === 2611) {
        totalOutgoingVat += entry.debit || 0;
        totalOutgoingVat -= entry.credit || 0;
      }
    });
  });

  const journalEntries = buildVatReportEntries(totalIncomingVat, totalOutgoingVat);

  const metadata = [
    {
      key: "vatReport",
      value: month,
    },
    {
      key: "vatSubmittedAt",
      value: formattedDate.toISOString().slice(0, 10),
    },
  ];

  await ensureIncomingBalance(bounds.year);
  await createVerification({
    idempotencyKey: `vat-report:${month}`,
    recordType: "vatReport",
    description: `Momsdeklaration för ${formatMonthName(month)}`,
    verificationDate: formattedDate,
    journalEntries: journalEntries,
    metadata,
  });

  return redirect("/admin/verifications");
};

// Funktion för att summera belopp i en lista av journalEntries
const sumAmounts = (verifications: VatVerification[], account: number) => {
  return verifications
    .reduce((total, v) => {
      const amount = v.journalEntries
        .filter((entry) => entry.account === account)
        .reduce((acc, entry) => {
          acc += entry.debit;
          acc -= entry.credit;

          return acc;
        }, 0);
      return total + amount;
    }, 0);
};

type ReportProps = {
  label: string;
  description?: string;
  totalLabel: string;
  account: number;
  verifications: VatVerification[];
};

const Report = ({
  label,
  description,
  totalLabel,
  verifications,
  account,
}: ReportProps): React.ReactElement => {
  const totalAmount = Math.abs(sumAmounts(verifications, account));

  return (
    <section className="border-t border-stone-200 py-5 first:border-t-0 sm:py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-serif text-xl leading-tight text-stone-950 sm:text-2xl">
            {label}
          </h3>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-stone-500">{description}</p>
          ) : null}
        </div>
        {verifications.length ? (
          <strong className="shrink-0 text-sm tabular-nums text-stone-900">
            {totalAmount.toFixed(2)} kr
          </strong>
        ) : null}
      </div>
      {verifications.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-stone-200 bg-white">
        <table className="w-full table-auto divide-y divide-stone-200">
          <thead className="bg-[#f6f1eb]">
            <tr>
              <th
                scope="col"
                className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-stone-500"
              >
                Verifikationsnummer
              </th>
              <th
                scope="col"
                className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.14em] text-stone-500"
              >
                Belopp
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 bg-white">
            {verifications.map((v) => (
              <tr key={v._id}>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-stone-700">
                  <span className="font-bold text-[#985744]">
                    A{v.verificationNumber}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-stone-600">
                  {v.journalEntries
                    .filter((entry) => entry.account === account)
                    .map((entry) => (
                      <span key={entry._id}>
                        {entry.credit
                          ? entry.credit.toFixed(2)
                          : entry.debit.toFixed(2)}{" "}
                        SEK
                      </span>
                    ))}
                </td>
              </tr>
            ))}
            <tr className="bg-[#f6f1eb] font-bold text-stone-900">
              <td className="px-4 py-3">Total {totalLabel.toLowerCase()}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {totalAmount.toFixed(2)} SEK
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      ) : (
        <div className="mt-3 rounded-xl bg-stone-100/70 px-4 py-3 text-sm text-stone-500">
          Ingen {totalLabel.toLowerCase()} under perioden.
        </div>
      )}
    </section>
  );
};

export default function VATReportPage() {
  const { verifications } = useLoaderData<{
    verifications: VatVerification[];
  }>();
  const vatSales = verifications.filter((verification) =>
    verification.journalEntries.some((entry) => entry.account === 3001)
  );
  const outgoingVAT = verifications.filter((verification) =>
    verification.journalEntries.some((entry) => entry.account === 2611)
  );
  const ingoingVAT = verifications.filter((verification) =>
    verification.journalEntries.some((entry) => entry.account === 2640)
  );
  const [searchParams] = useSearchParams();
  const month = searchParams.get("month") || "";
  const submit = useSubmit();
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const { control, handleSubmit } = useForm<{ submissionDate: string }>({
    defaultValues: { submissionDate: "" },
  });

  const onSubmit = (data: Record<string, string>) => {
    submit(data, { method: "post" });
  };

  return (
    <section
      aria-labelledby="vat-report-title"
      className="-mx-4 overflow-visible border-y border-stone-300 bg-[#fffdf8] sm:mx-0 sm:rounded-[2rem] sm:border"
    >
      <header className="border-b border-stone-200 px-4 py-6 sm:px-8 sm:py-8">
        <Link
          to="/admin/verifications"
          className="inline-flex h-10 items-center text-xs font-bold text-stone-500 transition hover:text-[#985744]"
        >
          <span aria-hidden="true" className="mr-2 text-base"><ArrowIcon direction="left" /></span>
          Till bokföringen
        </Link>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-[#985744]">
          Moms · redovisningsperiod {month}
        </p>
        <h2
          className="mt-2 max-w-3xl font-serif text-4xl leading-[1.05] text-stone-950 sm:text-5xl"
          id="vat-report-title"
        >
          Momsdeklaration för {formatMonthName(month)}
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-stone-600 sm:text-base sm:leading-7">
          Kontrollera periodens underlag och ange dagen då deklarationen faktiskt
          lämnades till Skatteverket. Det datumet blir verifikationens datum.
        </p>
      </header>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="order-2 px-4 pb-8 lg:order-1 lg:border-r lg:border-stone-200 lg:px-8 lg:py-7">
            <div className="border-b border-stone-200 py-5 lg:pt-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-stone-400">
                Periodens underlag
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
                En tom period registreras som nollrapport utan konteringsrader.
                Eventuella underlag kan kopplas till verifikationen efteråt.
              </p>
            </div>
            <Report
              totalLabel="Momspliktig försäljning"
              account={3001}
              label="Momspliktig försäljning"
              description="Försäljning som inte hör till ruta 06, 07 eller 08."
              verifications={vatSales}
            />
            <Report
              totalLabel="Utgående moms"
              account={2611}
              label="Utgående moms"
              verifications={outgoingVAT}
            />
            <Report
              totalLabel="Ingående moms"
              account={2640}
              label="Ingående moms"
              verifications={ingoingVAT}
            />
          </div>

          <aside className="order-1 border-b border-stone-200 bg-[#faf5f0] px-4 py-5 lg:order-2 lg:border-b-0 lg:bg-transparent lg:p-6">
            <div className="lg:sticky lg:top-28">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#985744]">
                Registrera inlämning
              </p>
              <h3 className="mt-2 font-serif text-2xl text-stone-950">
                När lämnades den in?
              </h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Deklarationen visas i den månad då du lämnade in den, även om
                redovisningsperioden är en annan.
              </p>

              <label htmlFor="submissionDate" className="mt-5 block text-xs font-bold text-stone-700">
                Inlämningsdatum hos Skatteverket
              </label>
              <div className="mt-2">
                <Controller
                  control={control}
                  name="submissionDate"
                  rules={{ required: true }}
                  render={({ field }) => (
                    <AccountingDateField
                      id="submissionDate"
                      value={field.value}
                      onChange={field.onChange}
                      label="Välj inlämningsdatum"
                    />
                  )}
                />
              </div>

              {actionData?.error ? (
                <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                  {actionData.error}
                </p>
              ) : null}

              <div className="mt-6 grid gap-3 sm:grid-cols-[9.5rem_minmax(17rem,22rem)] sm:justify-end lg:grid-cols-1">
                <Link
                  to="/admin/verifications"
                  className="order-2 inline-flex h-14 w-full items-center justify-center rounded-2xl border border-stone-300 bg-[#fffdf9] px-5 text-sm font-bold text-stone-700 transition hover:border-[#c58a79] hover:bg-white hover:text-[#985744] focus:outline-none focus:ring-2 focus:ring-[#e7c8be] focus:ring-offset-2 sm:order-1 lg:order-2"
                >
                  Avbryt
                </Link>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="relative order-1 inline-flex h-14 w-full items-center justify-center rounded-2xl border border-[#a85f4b] bg-[#a85f4b] px-14 text-sm font-bold text-white shadow-[0_8px_22px_rgba(126,67,51,0.16)] transition hover:-translate-y-px hover:border-[#8f4f3e] hover:bg-[#8f4f3e] focus:outline-none focus:ring-2 focus:ring-[#d7b0a3] focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0 sm:order-2 lg:order-1"
                >
                  {isSubmitting ? "Registrerar…" : "Registrera deklaration"}
                  {!isSubmitting ? (
                    <span
                      aria-hidden="true"
                      className="absolute right-3 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/15 text-lg"
                    >
                      <ArrowIcon />
                    </span>
                  ) : null}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </form>
    </section>
  );
}
