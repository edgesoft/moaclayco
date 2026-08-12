import {
  Link,
  useSearchParams,
  useLoaderData,
  useActionData,
  useNavigation,
  useSubmit,
} from "react-router";
import {
  ActionFunction,
  data as json,
  LoaderFunction,
  redirect,
} from "react-router";
import { Controller, useForm } from "react-hook-form";
import { Verifications } from "~/schemas/verifications"; // Din MongoDB schema
import { formatMonthName } from "~/utils/formatMonthName";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { getDomain } from "~/utils/domain";
import { toLoaderData } from "~/utils/loaderData";
import { auth } from "~/services/auth.server";
import { createVerification, ensureIncomingBalance } from "~/services/verification.server";
import {
  accountingYear,
  getAccountingMonthBounds,
  parseAccountingDate,
} from "~/utils/accountingDates";
import { AccountingDateField } from "~/components/admin/AccountingDateField";
import { buildVatTaxAccountEntries } from "~/utils/vat";

type VatReportVerification = {
  _id: string;
  metadata: Array<{ key: string; value: string }>;
  journalEntries: Array<{ account: number; debit: number; credit: number }>;
};

// Loader-funktion för att hämta verifikationer från MongoDB för en viss månad
export const loader: LoaderFunction = async ({ request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const url = new URL(request.url);
  const domain = getDomain(request)
  if (!domain) throw new Response("Okänd domän", { status: 404 });
  const month = url.searchParams.get("month"); // Få månaden som query param
  if (!month) {
    throw new Response("Ingen månad specificerad", { status: 400 });
  }

  if (!getAccountingMonthBounds(month)) {
    throw new Response("Ogiltig månad", { status: 400 });
  }

  const verification = (await Verifications.findOne({
    domain: domain.domain,
    metadata: { $elemMatch: { key: "vatReport", value: month } },
  }).lean()) as unknown as VatReportVerification | null;
  if (!verification) throw new Response("Momsrapporten hittades inte", { status: 404 });

  return json(toLoaderData({ verification }));
};

const formSchema = z.object({
  submissionDate: z.string().min(1, "Datum är obligatoriskt"),
});

export const action: ActionFunction = async ({ request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const formData = await request.formData();
  const domain = getDomain(request)
  if (!domain) throw new Error("Could not find domain")

  const parsed = formSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return json({ error: parsed.error.issues[0].message }, { status: 400 });

  const url = new URL(request.url);
  const month = url.searchParams.get("month"); // Få månaden som query param
  if (!month || !getAccountingMonthBounds(month)) {
    return json({ error: "Ingen månad specificerad" }, { status: 400 });
  }

  const verification = (await Verifications.findOne({
    metadata: { $elemMatch: { key: "vatReport", value: month } },
    domain: domain.domain,
  }).lean()) as unknown as VatReportVerification | null;
  if (!verification) return json({ error: "Momsrapporten hittades inte" }, { status: 404 });
  const isRegistered = verification.metadata?.some(
    (entry) => entry.key === "vatRegisteredAtAccount" && entry.value === "true"
  );
  if (isRegistered) return json({ error: "Momsrapporten är redan reglerad" }, { status: 409 });

  const vatBalance = verification.journalEntries
    .filter((entry) => entry.account === 2650)
    .reduce((sum, entry) => sum + Number(entry.debit || 0) - Number(entry.credit || 0), 0);
  if (vatBalance === 0) return json({ error: "Momsrapporten saknar saldo på 2650" }, { status: 400 });

  const formattedDate = parseAccountingDate(parsed.data.submissionDate);
  if (!formattedDate) return json({ error: "Ogiltigt datum" }, { status: 400 });
  const paymentYear = accountingYear(formattedDate);
  if (!paymentYear) return json({ error: "Ogiltigt bokföringsår" }, { status: 400 });
  const isRefund = vatBalance > 0;
  const journalEntries = buildVatTaxAccountEntries(vatBalance);

  await ensureIncomingBalance(domain.domain, paymentYear);
  await createVerification({
    domain: domain.domain,
    idempotencyKey: `vat-payment:${month}`,
    description: isRefund
      ? `Moms ${formatMonthName(month)} krediterad på skattekontot`
      : `Moms ${formatMonthName(month)} debiterad på skattekontot`,
    verificationDate: formattedDate,
    journalEntries,
    metadata: [
      { key: "vatPaymentFor", value: month },
      { key: "taxAccountDate", value: formattedDate.toISOString().slice(0, 10) },
    ],
  });
  await Verifications.updateOne(
    { _id: verification._id, domain: domain.domain },
    { $addToSet: { metadata: { key: "vatRegisteredAtAccount", value: "true" } } }
  );

  return redirect("/admin/verifications");
};

type FormData = z.infer<typeof formSchema>;

export default function VATPaymentPage() {
  const { verification } = useLoaderData<{
    verification: VatReportVerification;
  }>();
  const [searchParams] = useSearchParams();
  const month = searchParams.get("month") || "";
  const account = verification.journalEntries.find(
    (entry) => entry.account === 2650
  );
  const vatBalance = Number(account?.debit || 0) - Number(account?.credit || 0);
  const isRefund = vatBalance > 0;
  const submit = useSubmit();
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const {
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { submissionDate: "" },
  });

  const onSubmit = (data: FormData) => {
    submit(data, { method: "post" });
  };

  return (
    <section
      aria-labelledby="vat-payment-title"
      className="-mx-4 overflow-visible border-y border-stone-300 bg-[#fffdf8] sm:mx-0 sm:rounded-[2rem] sm:border"
    >
      <header className="border-b border-stone-200 px-4 py-6 sm:px-8 sm:py-8">
        <Link
          to="/admin/verifications"
          className="inline-flex h-10 items-center text-xs font-bold text-stone-500 transition hover:text-[#985744]"
        >
          <span aria-hidden="true" className="mr-2 text-base">←</span>
          Till bokföringen
        </Link>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-[#985744]">
          Skattekonto · moms {month}
        </p>
        <h2
          className="mt-2 max-w-3xl font-serif text-4xl leading-[1.05] text-stone-950 sm:text-5xl"
          id="vat-payment-title"
        >
          {isRefund ? "Registrera återbetalning" : "Registrera momsdebitering"}
        </h2>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-stone-600 sm:text-base sm:leading-7">
          Registrera händelsen på den dag då beloppet faktiskt syns på
          skattekontot.
        </p>
      </header>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="order-2 px-4 py-7 lg:order-1 lg:border-r lg:border-stone-200 lg:px-8 lg:py-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-stone-400">
              Underlag från momsdeklarationen
            </p>
            <h3 className="mt-3 font-serif text-2xl text-stone-950 sm:text-3xl">
              Moms för {formatMonthName(month)}
            </h3>
            <div className="mt-5 border-y border-stone-200 py-5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-stone-600">
                  {isRefund ? "Återbetalning" : "Debitering"}
                </span>
                <strong className="font-serif text-3xl tabular-nums text-stone-950">
                  {Math.abs(vatBalance).toLocaleString("sv-SE", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} kr
                </strong>
              </div>
            </div>
            <p className="mt-5 max-w-xl text-sm leading-6 text-stone-600">
              Beloppet hämtas från den registrerade momsdeklarationen. En eventuell
              inbetalning till skattekontot är en separat händelse och ska bokföras
              på sitt eget datum.
            </p>
          </div>

          <aside className="order-1 border-b border-stone-200 bg-[#faf5f0] px-4 py-5 lg:order-2 lg:border-b-0 lg:bg-transparent lg:p-6">
            <div className="lg:sticky lg:top-28">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#985744]">
                Datum på skattekontot
              </p>
              <h3 className="mt-2 font-serif text-2xl text-stone-950">
                När bokfördes posten?
              </h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Välj datumet som står på Skatteverkets skattekontoutdrag.
              </p>

              <label htmlFor="submissionDate" className="mt-5 block text-xs font-bold text-stone-700">
                Registreringsdatum
              </label>
              <div className="mt-2">
                <Controller
                  control={control}
                  name="submissionDate"
                  render={({ field }) => (
                    <AccountingDateField
                      id="submissionDate"
                      value={field.value}
                      onChange={field.onChange}
                      label="Välj datum på skattekontot"
                      error={Boolean(errors.submissionDate)}
                    />
                  )}
                />
              </div>
              {errors.submissionDate ? (
                <p className="mt-2 text-sm text-red-700">{errors.submissionDate.message}</p>
              ) : null}

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
                  {isSubmitting ? "Registrerar…" : "Registrera händelsen"}
                  {!isSubmitting ? (
                    <span
                      aria-hidden="true"
                      className="absolute right-3 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/15 text-lg"
                    >
                      →
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
