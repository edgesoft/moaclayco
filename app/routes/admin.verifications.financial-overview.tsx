import { data as json, LoaderFunction } from "react-router";
import {
  Form,
  Link,
  ShouldRevalidateFunction,
  useLoaderData,
  useSearchParams,
} from "react-router";
import { useState } from "react";
import { Verifications } from "~/schemas/verifications";
import { auth } from "~/services/auth.server";
import { ReportType } from "~/types";
import { accounts } from "~/utils/accounts";
import { getDomain } from "~/utils/domain";
import { AccountingDateField } from "~/components/admin/AccountingDateField";
import {
  getAccountingDateBounds,
  parseAccountingDate,
} from "~/utils/accountingDates";

const normalizeDateParameter = (value: string | null, fallback: string) => {
  if (!value) return fallback;

  const normalized = value.includes("-")
    ? value
    : `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return fallback;

  return parseAccountingDate(normalized) ? normalized : fallback;
};

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const domain = getDomain(request);
  const user = await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });
  if (!domain) throw new Response("Okänd domän", { status: 404 });
  const report = url.searchParams.get("report") === "balance" ? "balance" : "income";

  const fromValue = normalizeDateParameter(
    url.searchParams.get("from"),
    `${user.fiscalYear}-01-01`
  );
  const toValue = normalizeDateParameter(
    url.searchParams.get("to"),
    `${user.fiscalYear}-12-31`
  );
  const fiscalStartValue = `${user.fiscalYear}-01-01`;
  const fiscalEndValue = `${user.fiscalYear}-12-31`;
  const validPeriod =
    fromValue >= fiscalStartValue &&
    fromValue <= fiscalEndValue &&
    toValue >= fiscalStartValue &&
    toValue <= fiscalEndValue &&
    fromValue <= toValue;
  const safeFromValue = validPeriod ? fromValue : fiscalStartValue;
  const safeToValue = validPeriod ? toValue : fiscalEndValue;
  const periodBounds = getAccountingDateBounds(
    report === "balance" ? fiscalStartValue : safeFromValue,
    safeToValue
  );
  if (!periodBounds) throw new Response("Ogiltig rapportperiod", { status: 400 });

  const accountTotals = await Verifications.aggregate<{
    account: number;
    amount: number;
  }>([
    {
      $match: {
        verificationDate: {
          $gte: periodBounds.start,
          $lt: periodBounds.end,
        },
        domain: domain.domain,
      },
    },
    { $project: { journalEntries: 1 } },
    { $unwind: "$journalEntries" },
    {
      $group: {
        _id: "$journalEntries.account",
        amount: {
          $sum: {
            $subtract: [
              { $ifNull: ["$journalEntries.debit", 0] },
              { $ifNull: ["$journalEntries.credit", 0] },
            ],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        account: "$_id",
        amount: { $round: ["$amount", 2] },
      },
    },
  ]).exec();

  return json({ accountTotals, from: safeFromValue, to: safeToValue });
};

export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}) => {
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;

  const periodChanged = ["from", "to"].some(
    (parameter) =>
      currentUrl.searchParams.get(parameter) !==
      nextUrl.searchParams.get(parameter)
  );

  return periodChanged ? defaultShouldRevalidate : false;
};

const money = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const dateForInput = (value: string) => value.slice(0, 10);

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Stockholm",
  }).format(new Date(`${dateForInput(value)}T12:00:00.000Z`));

const reportAccounts = (type: ReportType) =>
  accounts.filter((account) => account.reportType === type);

const accountAmount = (
  amountByAccount: Record<number, number>,
  account: (typeof accounts)[number]
) => {
  const rawAmount = amountByAccount[account.value] || 0;
  return account.reportType === ReportType.INCOME ||
    account.reportType === ReportType.LIABILITIES
    ? -rawAmount
    : rawAmount;
};

const totalFor = (
  amountByAccount: Record<number, number>,
  reportType: ReportType
) =>
  reportAccounts(reportType).reduce(
    (total, account) => total + accountAmount(amountByAccount, account),
    0
  );

function SummaryCard({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`accounting-report-summary-item p-4 sm:p-5 ${
        emphasis ? "accounting-report-summary-item--emphasis" : ""
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 sm:text-xs">
        {label}
      </p>
      <p
        className={`mt-2 text-lg font-bold tabular-nums sm:text-2xl ${
          emphasis
            ? value >= 0
              ? "text-emerald-900"
              : "text-red-900"
            : "text-slate-950"
        }`}
      >
        {money.format(value)}
      </p>
    </div>
  );
}

function ReportSection({
  title,
  description,
  reportType,
  amountByAccount,
  showZeroAccounts,
  adjustment,
}: {
  title: string;
  description: string;
  reportType: ReportType;
  amountByAccount: Record<number, number>;
  showZeroAccounts: boolean;
  adjustment?: { label: string; value: number };
}) {
  const rows = reportAccounts(reportType)
    .map((account) => ({
      ...account,
      amount: accountAmount(amountByAccount, account),
    }))
    .filter((account) => showZeroAccounts || Math.abs(account.amount) >= 0.005);
  const total =
    rows.reduce((sum, account) => sum + account.amount, 0) +
    (adjustment?.value ?? 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-950">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
          </div>
          <p className="shrink-0 text-sm font-bold tabular-nums text-slate-950 sm:text-base">
            {money.format(total)}
          </p>
        </div>
      </div>

      {rows.length || adjustment ? (
        <div className="divide-y divide-slate-100">
          {rows.map((account) => {
            const separatorIndex = account.label.indexOf(" - ");
            const number =
              separatorIndex >= 0
                ? account.label.slice(0, separatorIndex)
                : account.value;
            const name =
              separatorIndex >= 0
                ? account.label.slice(separatorIndex + 3)
                : account.label;

            return (
              <div
                key={account.value}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 sm:px-6"
              >
                <span className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">
                  {number}
                </span>
                <span className="min-w-0 truncate text-sm font-medium text-slate-700">
                  {name}
                </span>
                <span className="text-sm font-semibold tabular-nums text-slate-900">
                  {money.format(account.amount)}
                </span>
              </div>
            );
          })}
          {adjustment ? (
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 sm:px-6">
              <span className="rounded-lg bg-[#f3e4de] px-2 py-1 text-[11px] font-bold text-[#985744]">ÅR</span>
              <span className="text-sm font-medium text-slate-700">{adjustment.label}</span>
              <span className="text-sm font-semibold tabular-nums text-slate-900">{money.format(adjustment.value)}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-slate-500">
          Inga belopp att visa för perioden.
        </p>
      )}

      <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-4 sm:px-6">
        <span className="text-sm font-bold text-slate-900">Summa {title.toLocaleLowerCase("sv-SE")}</span>
        <span className="text-sm font-bold tabular-nums text-slate-950 sm:text-base">
          {money.format(total)}
        </span>
      </div>
    </section>
  );
}

export default function FinancialOverview() {
  const { accountTotals, from, to } = useLoaderData<{
    accountTotals: Array<{ account: number; amount: number }>;
    from: string;
    to: string;
  }>();
  const [searchParams] = useSearchParams();
  const [showZeroAccounts, setShowZeroAccounts] = useState(false);
  const selectedReport = searchParams.get("report") || "income";
  const isIncomeReport = selectedReport === "income";
  const amountByAccount = Object.fromEntries(
    accountTotals.map(({ account, amount }) => [account, amount])
  ) as Record<number, number>;

  const income = totalFor(amountByAccount, ReportType.INCOME);
  const expenses = totalFor(amountByAccount, ReportType.EXPENSE);
  const assets = totalFor(amountByAccount, ReportType.BALANCE);
  const liabilities = totalFor(amountByAccount, ReportType.LIABILITIES);
  const result = income - expenses;
  const equityAndLiabilities = liabilities + result;
  const balance = assets - equityAndLiabilities;
  const currentFrom = dateForInput(from);
  const currentTo = dateForInput(to);
  const periodYear = Number(currentFrom.slice(0, 4));
  const presets = [
    { label: "Helår", from: `${periodYear}-01-01`, to: `${periodYear}-12-31` },
    { label: "K1", from: `${periodYear}-01-01`, to: `${periodYear}-03-31` },
    { label: "K2", from: `${periodYear}-04-01`, to: `${periodYear}-06-30` },
    { label: "K3", from: `${periodYear}-07-01`, to: `${periodYear}-09-30` },
    { label: "K4", from: `${periodYear}-10-01`, to: `${periodYear}-12-31` },
  ];
  const knownAccounts = new Set(accounts.map((account) => account.value));
  const unknownAccountTotals = accountTotals.filter(
    ({ account, amount }) => !knownAccounts.has(account) && Math.abs(amount) >= 0.005
  );

  const periodHref = (periodFrom: string, periodTo: string) => {
    const query = new URLSearchParams({
      report: selectedReport,
      from: periodFrom,
      to: periodTo,
    });
    return `/admin/verifications/financial-overview?${query.toString()}`;
  };

  return (
    <div className="space-y-5 pb-16">
      <section className="border-y border-stone-300 py-6 sm:py-8">
        <div>
          <div>
            <p className="accounting-kicker text-xs font-bold uppercase tracking-[0.14em]">
              Rapport
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
              {isIncomeReport ? "Resultaträkning" : "Balansräkning"}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              {isIncomeReport
                ? "Se periodens intäkter, kostnader och beräknade resultat."
                : "Se företagets tillgångar, skulder och eget kapital per valt datum."}
            </p>
          </div>

          <div className="accounting-period-picker mt-7">
            <div className="accounting-period-heading">
              <p>{isIncomeReport ? "Period" : "Balansdag"}</p>
              <strong>{isIncomeReport ? `${dateLabel(from)}–${dateLabel(to)}` : dateLabel(to)}</strong>
            </div>

            <nav className="accounting-period-presets" aria-label="Välj rapportperiod">
              {presets.map((preset) => {
                const active =
                  currentFrom === preset.from && currentTo === preset.to;
                return (
                  <Link
                    key={preset.label}
                    to={periodHref(preset.from, preset.to)}
                    prefetch="intent"
                    className={`accounting-period-preset ${
                      active ? "accounting-period-preset--active" : ""
                    }`}
                  >
                    {preset.label}
                  </Link>
                );
              })}
            </nav>

            <details className="accounting-custom-period">
              <summary>Annan period</summary>
              <Form method="get" className="accounting-custom-period-form">
                <input type="hidden" name="report" value={selectedReport} />
                {isIncomeReport ? (
                  <label>
                    <span>Från</span>
                    <AccountingDateField
                      id="report-from"
                      name="from"
                      defaultValue={currentFrom}
                      label="Periodens startdatum"
                    />
                  </label>
                ) : (
                  <input type="hidden" name="from" value={`${periodYear}-01-01`} />
                )}
                <label>
                  <span>Till</span>
                  <AccountingDateField
                    id="report-to"
                    name="to"
                    defaultValue={currentTo}
                    label="Periodens slutdatum"
                  />
                </label>
                <button type="submit">
                  Visa perioden <span aria-hidden="true">→</span>
                </button>
              </Form>
            </details>
          </div>
        </div>
      </section>

      <section className="accounting-report-summary grid grid-cols-1 sm:grid-cols-3" aria-label="Rapportsammanfattning">
        {isIncomeReport ? (
          <>
            <SummaryCard label="Intäkter" value={income} />
            <SummaryCard label="Kostnader" value={expenses} />
            <SummaryCard label="Periodens resultat" value={result} emphasis />
          </>
        ) : (
          <>
            <SummaryCard label="Tillgångar" value={assets} />
            <SummaryCard label="Skulder/eget kapital" value={equityAndLiabilities} />
            <SummaryCard label="Balans" value={balance} emphasis />
          </>
        )}
      </section>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-500">
          {isIncomeReport ? `Period ${dateForInput(from)}–${dateForInput(to)}` : `Balans per ${dateForInput(to)}`}
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-600">
          <input
            type="checkbox"
            checked={showZeroAccounts}
            onChange={(event) => setShowZeroAccounts(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
          />
          Visa nollkonton
        </label>
      </div>

      {unknownAccountTotals.length ? (
        <section className="border-y border-[#d7b0a3] bg-[#fbf3ef] px-4 py-4 text-sm text-[#7d493a] sm:px-6">
          <p className="font-bold">Konton som behöver klassificeras</p>
          <p className="mt-1 text-xs leading-5">
            {unknownAccountTotals.map(({ account, amount }) => `${account}: ${money.format(amount)}`).join(" · ")}
          </p>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {isIncomeReport ? (
          <>
            <ReportSection
              title="Intäkter"
              description="Försäljning och övriga intäkter under perioden."
              reportType={ReportType.INCOME}
              amountByAccount={amountByAccount}
              showZeroAccounts={showZeroAccounts}
            />
            <ReportSection
              title="Kostnader"
              description="Inköp och övriga kostnader under perioden."
              reportType={ReportType.EXPENSE}
              amountByAccount={amountByAccount}
              showZeroAccounts={showZeroAccounts}
            />
          </>
        ) : (
          <>
            <ReportSection
              title="Tillgångar"
              description="Det företaget äger eller har rätt till."
              reportType={ReportType.BALANCE}
              amountByAccount={amountByAccount}
              showZeroAccounts={showZeroAccounts}
            />
            <ReportSection
              title="Skulder"
              description="Skulder, eget kapital och avräkningskonton."
              reportType={ReportType.LIABILITIES}
              amountByAccount={amountByAccount}
              showZeroAccounts={showZeroAccounts}
              adjustment={{ label: "Beräknat resultat", value: result }}
            />
          </>
        )}
      </div>
    </div>
  );
}
