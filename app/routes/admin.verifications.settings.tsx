import {
  type ActionFunction,
  data as json,
  Form,
  type LoaderFunction,
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSearchParams,
} from "react-router";
import { useState } from "react";
import { z } from "zod";
import { Users } from "~/schemas/user";
import { auth } from "~/services/auth.server";
import { commitSession, sessionStorage } from "~/services/session.server";
import {
  AccountingYearClosingError,
  closeAccountingYear,
  ensureIncomingBalance,
  getAccountingYearClosingReadiness,
} from "~/services/verification.server";
import type { User } from "~/types";
import ArrowIcon from "~/components/ArrowIcon";
import { getDomain } from "~/utils/domain";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";

const selectYearSchema = z.object({
  fiscalYear: z.coerce.number().int().min(2000).max(2200),
});

const closeYearSchema = z.object({
  closingYear: z.coerce.number().int().min(2000).max(2200),
  confirmClose: z.literal("yes", {
    error: "Bekräfta att året ska låsas",
  }),
});

export const loader: LoaderFunction = async ({ request }) => {
  const user = await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });
  const domain = getDomain(request);
  if (!domain) throw new Response("Okänd domän", { status: 404 });

  const closing = await getAccountingYearClosingReadiness(
    domain.domain,
    user.fiscalYear
  );
  return json({ year: user.fiscalYear, closing });
};

export const action: ActionFunction = async ({ request }) => {
  const user: User = await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });
  const domain = getDomain(request);
  if (!domain) throw new Response("Okänd domän", { status: 404 });

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

  if (formData.get("intent") === "close-year") {
    const parsed = closeYearSchema.safeParse({
      closingYear: formData.get("closingYear"),
      confirmClose: formData.get("confirmClose"),
    });
    if (!parsed.success) {
      return json({ error: parsed.error.issues[0]?.message }, { status: 400 });
    }
    if (parsed.data.closingYear !== user.fiscalYear) {
      return json(
        { error: "Ladda om sidan innan du avslutar bokföringsåret" },
        { status: 409 }
      );
    }

    try {
      await closeAccountingYear({
        domain: domain.domain,
        year: parsed.data.closingYear,
      });
    } catch (error) {
      if (error instanceof AccountingYearClosingError) {
        return json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
    return redirect(
      `/admin/verifications/settings?closed=${parsed.data.closingYear}`
    );
  }

  const parsed = selectYearSchema.safeParse({
    fiscalYear: formData.get("fiscalYear"),
  });
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const fiscalYear = parsed.data.fiscalYear;
  await ensureIncomingBalance(domain.domain, fiscalYear);
  await Users.updateOne({ _id: user._id }, { fiscalYear });
  user.fiscalYear = fiscalYear;

  const session = await sessionStorage.getSession(request.headers.get("cookie"));
  session.set("user", user);
  const headers = new Headers({ "Set-Cookie": await commitSession(session) });
  return redirect("/admin/verifications", { headers });
};

type ClosingData = {
  status: "open" | "closed";
  yearHasPassed: boolean;
  canClose: boolean;
  requiredVatReportCount: number;
  registeredVatReportCount: number;
  requiredVatPaymentCount: number;
  registeredVatPaymentCount: number;
  missingVatMonths: string[];
  unsettledVatMonths: string[];
  closedAt: string | null;
  incomingBalance: {
    verificationNumber: number;
    state: string;
    calculatedAt: string | null;
  } | null;
};

const formatDateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("sv-SE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Stockholm",
      }).format(new Date(value))
    : null;

export default function Settings() {
  const navigate = useNavigate();
  const { year, closing } = useLoaderData<{
    year: number;
    closing: ClosingData;
  }>();
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const [selectedYear, setSelectedYear] = useState(year);
  const [confirmedClose, setConfirmedClose] = useState(false);
  const relevantYears = [year - 2, year - 1, year, year + 1];
  const isClosing =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "close-year";
  const closedYear = searchParams.get("closed");
  const checks = [
    {
      complete: closing.yearHasPassed,
      label: "Bokföringsåret har passerat",
      detail: closing.yearHasPassed
        ? `${year} är redo att stämmas av.`
        : `Året kan avslutas tidigast efter den 31 december ${year}.`,
    },
    {
      complete:
        closing.registeredVatReportCount === closing.requiredVatReportCount,
      label: "Alla momsperioder är registrerade",
      detail: `${closing.registeredVatReportCount} av ${closing.requiredVatReportCount} momsrapporter`,
    },
    {
      complete:
        closing.registeredVatPaymentCount === closing.requiredVatPaymentCount,
      label: "Moms är registrerad på skattekontot",
      detail:
        closing.requiredVatPaymentCount === 0
          ? "Inga momsbelopp att reglera"
          : `${closing.registeredVatPaymentCount} av ${closing.requiredVatPaymentCount} momshändelser`,
    },
  ];

  return (
    <section className="pb-16" aria-labelledby="fiscal-year-title">
      <button
        type="button"
        onClick={() => navigate("/admin/verifications")}
        className="mb-3 inline-flex h-10 items-center rounded-lg px-1 text-xs font-bold text-slate-500 hover:text-slate-900"
      >
        <span aria-hidden="true" className="mr-2"><ArrowIcon direction="left" /></span>
        Till verifikationer
      </button>

      <div className="max-w-3xl border-y border-stone-300 py-7 sm:py-9">
        <p className="accounting-kicker text-xs font-bold uppercase tracking-[0.14em]">
          Inställning
        </p>
        <h2
          id="fiscal-year-title"
          className="mt-3 text-3xl tracking-tight text-stone-950 sm:text-4xl"
        >
          Välj bokföringsår
        </h2>
        <p className="mt-2 text-sm leading-6 text-stone-500">
          Listan och rapporterna visar verifikationer från det valda året. När
          du går framåt skapas eller uppdateras nästa års preliminära IB.
        </p>

        <Form method="post" className="mt-7">
          <input type="hidden" name="intent" value="select-year" />
          <fieldset>
            <legend className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-stone-500">
              Bokföringsår
            </legend>
            <div className="grid grid-cols-4 border-b border-stone-300">
              {relevantYears.map((relevantYear) => (
                <label key={relevantYear} className="group cursor-pointer">
                  <input
                    type="radio"
                    name="fiscalYear"
                    value={relevantYear}
                    checked={relevantYear === selectedYear}
                    onChange={() => setSelectedYear(relevantYear)}
                    className="peer sr-only"
                  />
                  <span className="-mb-px flex h-14 items-center justify-center border-b-2 border-transparent bg-transparent text-base font-medium text-stone-400 transition hover:text-stone-900 peer-checked:border-[#b86e59] peer-checked:text-[#985744] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#b86e59]">
                    {relevantYear}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="accounting-form-actions mt-7 grid gap-3 sm:grid-cols-[9.5rem_15rem] sm:justify-end">
            <button
              type="button"
              onClick={() => navigate("/admin/verifications")}
              className="accounting-cancel-action"
            >
              Avbryt
            </button>
            <button type="submit" className="accounting-submit-action">
              Använd {selectedYear} <span aria-hidden="true"><ArrowIcon /></span>
            </button>
          </div>
        </Form>
      </div>

      <div className="mt-10 max-w-3xl border-y border-stone-300 py-7 sm:py-9">
        <p className="accounting-kicker text-xs font-bold uppercase tracking-[0.14em]">
          UB {year} · IB {year + 1}
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl tracking-tight text-stone-950 sm:text-4xl">
              {closing.status === "closed"
                ? `Bokföringsår ${year} är avslutat`
                : `Avsluta bokföringsår ${year}`}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
              {closing.status === "closed"
                ? `Utgående balans är fryst och har förts över som slutligt IB för ${year + 1}.`
                : `Du kan arbeta i ${year + 1} redan nu. Fram till årsavslutet är IB preliminärt och räknas om automatiskt när du lägger till något i ${year}.`}
            </p>
          </div>
          {closing.incomingBalance ? (
            <p className="shrink-0 text-xs leading-5 text-stone-500 sm:text-right">
              A{closing.incomingBalance.verificationNumber}
              <br />
              {closing.incomingBalance.state === "final" ? "Slutligt IB" : "Preliminärt IB"}
            </p>
          ) : null}
        </div>

        {closedYear === String(year) ? (
          <p className="mt-6 border-l-2 border-[#b86e59] bg-[#fbf3ef] px-4 py-3 text-sm leading-6 text-stone-700">
            Årsavslutet är klart. Vanliga bokningar i {year} är nu låsta.
          </p>
        ) : null}

        {closing.status === "closed" ? (
          <dl className="mt-7 grid gap-4 border-t border-stone-200 pt-5 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-stone-400">
                Avslutat
              </dt>
              <dd className="mt-1 text-sm text-stone-700">
                {formatDateTime(closing.closedAt) || "Klart"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-stone-400">
                Senast beräknat
              </dt>
              <dd className="mt-1 text-sm text-stone-700">
                {formatDateTime(closing.incomingBalance?.calculatedAt || null) || "Vid årsavslutet"}
              </dd>
            </div>
          </dl>
        ) : (
          <>
            <ol className="mt-7 border-t border-stone-200">
              {checks.map((check, index) => (
                <li
                  key={check.label}
                  className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-b border-stone-200 py-4"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${
                      check.complete
                        ? "border-[#9b7d64] bg-[#f1e6dc] text-[#795942]"
                        : "border-stone-300 text-stone-400"
                    }`}
                  >
                    {check.complete ? "✓" : index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-stone-800">{check.label}</p>
                    <p className="mt-1 text-xs leading-5 text-stone-500">{check.detail}</p>
                  </div>
                </li>
              ))}
            </ol>

            {closing.missingVatMonths.length ? (
              <p className="mt-4 text-xs leading-5 text-stone-500">
                Saknade momsperioder: {closing.missingVatMonths.join(", ")}.
              </p>
            ) : null}
            {closing.unsettledVatMonths.length ? (
              <p className="mt-2 text-xs leading-5 text-stone-500">
                Moms återstår på skattekontot för: {closing.unsettledVatMonths.join(", ")}.
              </p>
            ) : null}

            {actionData?.error ? (
              <p role="alert" className="mt-5 border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
                {actionData.error}
              </p>
            ) : null}

            <Form method="post" className="mt-7">
              <input type="hidden" name="intent" value="close-year" />
              <input type="hidden" name="closingYear" value={year} />
              <label className="group grid cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)] gap-3 text-sm leading-6 text-stone-600">
                <input
                  type="checkbox"
                  name="confirmClose"
                  value="yes"
                  checked={confirmedClose}
                  onChange={(event) => setConfirmedClose(event.target.checked)}
                  className="peer sr-only"
                  disabled={!closing.canClose}
                />
                <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-[0.3rem] border border-stone-400 bg-[#fffdf9] text-transparent transition peer-checked:border-[#b86e59] peer-checked:bg-[#b86e59] peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#b86e59] peer-disabled:bg-stone-100">
                  ✓
                </span>
                <span>
                  Jag förstår att vanliga bokningar i {year} låses. En senare
                  rättelse måste registreras spårbart i ett öppet år.
                </span>
              </label>

              <div className="accounting-form-actions mt-6 flex justify-end">
                <button
                  type="submit"
                  disabled={!closing.canClose || !confirmedClose || isClosing}
                  className="accounting-submit-action disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
                >
                  {isClosing ? "Slutför årsavslut…" : `Slutför årsavslut ${year}`}
                  {!isClosing ? <span aria-hidden="true"><ArrowIcon /></span> : null}
                </button>
              </div>
            </Form>
          </>
        )}
      </div>
    </section>
  );
}
