import { Link } from "react-router";
import { Fragment, useState } from "react";
import { VerificationProps } from "~/types";
import { accounts } from "~/utils/accounts";
import { formatMonthName } from "~/utils/formatMonthName";
import ArrowIcon from "~/components/ArrowIcon";
import PlusMinusIcon from "~/components/PlusMinusIcon";

const formatDate = (dateString: string) =>
  new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Europe/Stockholm",
  }).format(new Date(dateString));

const money = new Intl.NumberFormat("sv-SE", {
  style: "currency",
  currency: "SEK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const accountLabel = (accountNumber: number) =>
  accounts.find((account) => account.value === accountNumber)?.label ||
  String(accountNumber);

const accountName = (accountNumber: number) =>
  accountLabel(accountNumber).replace(
    new RegExp(`^${accountNumber}\\s*[-–]\\s*`),
    ""
  );

const displayFileName = (name: string) => {
  const fileName = decodeURIComponent(name.split("/").pop() || name)
    .replace(/^\d{10,}-/, "")
    .replace(/\s*_\s*/g, " – ")
    .trim();
  return fileName || "Bilaga";
};

const fileType = (name: string) => {
  const extension = name.split(".").pop();
  return extension && extension !== name ? extension.toLocaleUpperCase("sv-SE") : "FIL";
};

const metadataValue = (verification: VerificationProps, key: string) =>
  verification.metadata?.find((entry) => entry.key === key)?.value;

const orderIdForVerification = (verification: VerificationProps) => {
  const metadataOrderId = metadataValue(verification, "orderId")?.trim();
  if (metadataOrderId) return metadataOrderId;

  return (
    verification.description.match(/^order id:\s*([^\r\n]+)/i)?.[1]?.trim() ||
    null
  );
};

const displayDescription = (verification: VerificationProps) => {
  const description = verification.description.trim();
  if (!/^order id:/i.test(description)) return verification.description;

  const orderId = orderIdForVerification(verification);
  if (!orderId) return "Orderbetalning";
  const orderNumber = orderId.slice(-8).toLocaleUpperCase("sv-SE");
  return orderNumber ? `Order #${orderNumber}` : "Orderbetalning";
};

const vatPeriod = (verification: VerificationProps) =>
  metadataValue(verification, "vatReport");

const isSystemVerification = (verification: VerificationProps) =>
  verification.recordType === "incomingBalance" ||
  verification.recordType === "vatReport" ||
  Boolean(metadataValue(verification, "IB")) ||
  Boolean(metadataValue(verification, "vatPaymentFor"));

const primaryDateLabel = (verification: VerificationProps) =>
  formatDate(verification.verificationDate);

const getSums = (verification: VerificationProps) => {
  const debit = verification.journalEntries.reduce(
    (sum, entry) => sum + Number(entry.debit || 0),
    0
  );
  const credit = verification.journalEntries.reduce(
    (sum, entry) => sum + Number(entry.credit || 0),
    0
  );
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 };
};

function VerificationDetails({ verification }: { verification: VerificationProps }) {
  const { debit, credit, balanced } = getSums(verification);
  const entries = verification.journalEntries.filter(
    (entry) => Number(entry.debit || 0) !== 0 || Number(entry.credit || 0) !== 0
  );
  const files = verification.files || [];
  const reportPeriod = vatPeriod(verification);
  const submittedAt = metadataValue(verification, "vatSubmittedAt");
  const submittedAtLabel = formatDate(submittedAt || verification.verificationDate);

  return (
    <div className="space-y-4">
      {!isSystemVerification(verification) ? (
        <div className="flex justify-end">
          <Link
            to={`/admin/verifications/${verification.verificationNumber}/edit`}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-[#d8c3bb] bg-[#fffaf7] px-3.5 text-xs font-bold text-[#985744] transition hover:border-[#b8735e] hover:bg-[#fbf1ed]"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="mr-2 h-4 w-4"
            >
              <path d="m4 20 4.2-1 10.9-10.9a2.1 2.1 0 0 0-3-3L5.2 16Z" />
              <path d="m14.8 6.4 2.8 2.8M4 20l1.2-4" />
            </svg>
            Redigera
          </Link>
        </div>
      ) : null}

      {reportPeriod ? (
        <div className="rounded-xl border border-[#dcc9c1] bg-[#fbf5f1] px-4 py-3 text-sm leading-6 text-stone-700">
          <strong className="text-stone-950">Redovisningsperiod:</strong>{" "}
          {formatMonthName(reportPeriod)}
          <span aria-hidden="true"> · </span>
          <strong className="text-stone-950">Inlämnad:</strong> {submittedAtLabel}
          {entries.length === 0 ? (
            <p className="mt-1 text-stone-500">
              Nollrapport utan bokföringsrader. Kvittensen sparas som underlag.
            </p>
          ) : null}
        </div>
      ) : null}

      {entries.length ? (
        <section aria-label="Kontering">
          <div className="mb-2 flex items-center justify-between gap-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#985744]">
              Kontering
            </p>
            <p className="text-[11px] text-stone-400">
              {entries.length} {entries.length === 1 ? "rad" : "rader"}
            </p>
          </div>

          <div className="border-y border-stone-200 sm:hidden">
            <div className="divide-y divide-stone-200">
              {entries.map((entry) => {
                const isDebit = Number(entry.debit || 0) !== 0;
                const amount = isDebit ? entry.debit : entry.credit;

                return (
                  <div
                    key={entry._id ?? `${entry.account}-${entry.debit}-${entry.credit}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5 py-3.5"
                  >
                    <div className="min-w-0">
                      <span className="block text-[10px] font-bold tracking-[0.08em] text-[#a86552]">
                        {entry.account}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-stone-700">
                        {accountName(entry.account)}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-stone-400">
                        {isDebit ? "Debet" : "Kredit"}
                      </span>
                      <span className="mt-0.5 block text-sm font-semibold tabular-nums text-stone-900">
                        {money.format(amount)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-4 border-t border-stone-300 py-3.5">
              <span className={`pb-0.5 text-xs font-bold ${balanced ? "text-stone-600" : "text-red-700"}`}>
                {balanced ? "Summa" : "Differens"}
              </span>
              <span className="text-right">
                <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-stone-400">
                  Debet
                </span>
                <span className="mt-0.5 block text-xs font-bold tabular-nums text-stone-900">
                  {money.format(debit)}
                </span>
              </span>
              <span className="text-right">
                <span className="block text-[9px] font-bold uppercase tracking-[0.1em] text-stone-400">
                  Kredit
                </span>
                <span className="mt-0.5 block text-xs font-bold tabular-nums text-stone-900">
                  {money.format(credit)}
                </span>
              </span>
            </div>
          </div>

          <div className="hidden border-y border-stone-200 sm:block">
            <div className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] gap-5 border-b border-stone-200 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-stone-400">
              <span>Konto</span>
              <span className="text-right">Debet</span>
              <span className="text-right">Kredit</span>
            </div>
            <div className="divide-y divide-stone-100">
              {entries.map((entry) => (
                <div
                  key={entry._id ?? `${entry.account}-${entry.debit}-${entry.credit}`}
                  className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] items-baseline gap-5 py-3.5 text-sm text-stone-700"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-xs font-bold tracking-[0.04em] text-[#a86552]">
                      {entry.account}
                    </span>
                    <span className="min-w-0 truncate">{accountName(entry.account)}</span>
                  </span>
                  <span className="text-right tabular-nums">
                    {Number(entry.debit || 0) !== 0 ? (
                      money.format(entry.debit)
                    ) : (
                      <span className="sr-only">0 kr</span>
                    )}
                  </span>
                  <span className="text-right tabular-nums">
                    {Number(entry.credit || 0) !== 0 ? (
                      money.format(entry.credit)
                    ) : (
                      <span className="sr-only">0 kr</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_7rem_7rem] gap-5 border-t border-stone-300 py-3.5 text-sm font-bold text-stone-900">
              <span className={balanced ? "text-stone-600" : "text-red-700"}>
                {balanced ? "Summa" : "Differens"}
              </span>
              <span className="text-right tabular-nums">{money.format(debit)}</span>
              <span className="text-right tabular-nums">{money.format(credit)}</span>
            </div>
          </div>
        </section>
      ) : null}

      <section
        aria-label="Bilagor"
        className="border-t border-stone-200 pt-4"
      >
        <header className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#985744]">
              Underlag
            </p>
            <p className="mt-0.5 text-xs text-stone-500">
              {files.length
                ? `${files.length} ${files.length === 1 ? "bilaga" : "bilagor"} kopplad${files.length === 1 ? "" : "e"}`
                : "Ingen bilaga kopplad"}
            </p>
          </div>
          <Link
            to={`/admin/verifications/${verification.verificationNumber}/files`}
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-stone-300 bg-white px-3.5 text-xs font-bold text-stone-700 transition hover:border-[#c58a79] hover:text-[#985744]"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="mr-2 h-4 w-4">
              <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06-1.41 1.41-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V20h-2v-.5a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06-1.41-1.41.06-.06A1.7 1.7 0 0 0 9.46 15a1.7 1.7 0 0 0-1.56-1.03H7.4v-2h.5a1.7 1.7 0 0 0 1.56-1.03 1.7 1.7 0 0 0-.34-1.87l-.06-.06L10.47 7.6l.06.06A1.7 1.7 0 0 0 12.4 8a1.7 1.7 0 0 0 1.03-1.56V6h2v.44A1.7 1.7 0 0 0 16.46 8a1.7 1.7 0 0 0 1.87-.34l.06-.06 1.41 1.41-.06.06a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.56 1.03h.44v2h-.44A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
            {files.length ? "Hantera" : "Lägg till"}
          </Link>
        </header>

        {files.length ? (
          <ul className="mt-3 divide-y divide-stone-100 border-y border-stone-200">
            {files.map((file) => (
              <li key={file.path}>
                <a
                  href={file.path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 py-3.5 transition hover:bg-[#fdf8f5]"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#e4cec6] bg-[#fbf1ed] text-[#985744]">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
                      <path d="M7 3.5h7l4 4V20H7z" />
                      <path d="M14 3.5V8h4M9.5 12h6M9.5 15.5h6" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-semibold leading-5 text-stone-800 group-hover:text-[#985744] sm:truncate">
                      {displayFileName(file.name)}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-stone-400">
                      {fileType(file.name)} · öppnas i ny flik
                    </span>
                  </span>
                  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-stone-400 transition group-hover:bg-[#f3e4de] group-hover:text-[#985744]">
                    <ArrowIcon direction="up-right" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 max-w-xl text-xs leading-5 text-stone-500">
            Koppla kvitto, faktura eller Skatteverkets kvittens som underlag.
          </p>
        )}
      </section>
    </div>
  );
}

export function ListItemVerification({
  verification,
}: {
  verification: VerificationProps;
}) {
  const [expanded, setExpanded] = useState(false);
  const { debit, balanced } = getSums(verification);
  const fileCount = verification.files?.length || 0;
  const isZeroVatReport = Boolean(vatPeriod(verification)) && debit === 0;
  const orderId = orderIdForVerification(verification);
  const description = displayDescription(verification);

  return (
    <Fragment>
      <tr className={`transition hover:bg-slate-50 ${expanded ? "bg-stone-50" : "bg-white"}`}>
        <td className="px-5 py-4 align-middle">
          <span className="accounting-entry-number">
            A{verification.verificationNumber}
          </span>
        </td>
        <td className="px-3 py-4 text-sm text-slate-500">
          {primaryDateLabel(verification)}
        </td>
        <td className="px-3 py-4">
          {orderId ? (
            <Link
              to={`/admin/orders/${encodeURIComponent(orderId)}`}
              state={{ returnTo: "/admin/verifications" }}
              aria-label={`Öppna ${description}`}
              className="group inline-flex h-10 max-w-full items-center gap-2 text-sm font-semibold text-slate-900 transition hover:text-[#985744] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c98d7b] focus-visible:ring-offset-2"
            >
              <span className="truncate">{description}</span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#dcc9c1] text-[#985744] transition group-hover:border-[#b86e59] group-hover:bg-[#fbf1ed]">
                <ArrowIcon direction="up-right" className="h-3.5 w-3.5" />
              </span>
            </Link>
          ) : (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="flex h-10 w-full items-center truncate text-left text-sm font-semibold text-slate-900 transition hover:text-[#985744]"
            >
              {description}
            </button>
          )}
        </td>
        <td className="px-3 py-4 text-sm text-slate-500">
          {fileCount ? `${fileCount} ${fileCount === 1 ? "bilaga" : "bilagor"}` : "—"}
        </td>
        <td
          className={`px-3 py-4 text-right tabular-nums ${
            isZeroVatReport
              ? "text-xs font-medium text-stone-500"
              : "text-sm font-bold text-slate-900"
          }`}
        >
          {isZeroVatReport ? "Nollrapport" : money.format(debit)}
        </td>
        <td className="py-4 pl-2 pr-6 text-right xl:pr-8">
          <button
            type="button"
            aria-label={`${expanded ? "Dölj" : "Visa"} verifikation A${verification.verificationNumber}`}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className={`accounting-month-toggle bg-transparent p-0 ${expanded ? "accounting-month-toggle--open" : ""}`}
          >
            <PlusMinusIcon operation={expanded ? "minus" : "plus"} />
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="bg-stone-50">
          <td colSpan={6} className="px-5 pb-5 pt-1">
            {!balanced ? (
              <p className="mb-3 text-xs font-bold text-red-700">Obalanserad verifikation</p>
            ) : null}
            <VerificationDetails verification={verification} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

export function MobileVerificationCard({
  verification,
}: {
  verification: VerificationProps;
}) {
  const [expanded, setExpanded] = useState(false);
  const { debit, balanced } = getSums(verification);
  const fileCount = verification.files?.length || 0;
  const entryCount = verification.journalEntries.filter(
    (entry) => Number(entry.debit || 0) !== 0 || Number(entry.credit || 0) !== 0
  ).length;
  const isZeroVatReport = Boolean(vatPeriod(verification)) && debit === 0;
  const orderId = orderIdForVerification(verification);
  const description = displayDescription(verification);
  const mobileDescription = orderId
    ? description.replace(/^Order\s+/i, "")
    : description;

  const amountAndToggle = (
    <>
      <p
        className={`tabular-nums ${
          isZeroVatReport
            ? "text-[11px] font-medium tracking-[0.02em] text-stone-500"
            : "text-sm font-semibold text-stone-950"
        }`}
      >
        {isZeroVatReport ? "Nollrapport" : money.format(debit)}
      </p>
      <span
        className={`accounting-month-toggle ${expanded ? "accounting-month-toggle--open" : ""}`}
        aria-hidden="true"
      >
        <PlusMinusIcon operation={expanded ? "minus" : "plus"} />
      </span>
    </>
  );

  const summaryContent = (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
      <span className="accounting-entry-number">
        A{verification.verificationNumber}
      </span>

      <div className="min-w-0">
        {orderId ? (
          <Link
            to={`/admin/orders/${encodeURIComponent(orderId)}`}
            state={{ returnTo: "/admin/verifications" }}
            aria-label={`Öppna ${description}`}
            className="group inline-flex max-w-full items-center gap-1.5 font-semibold text-stone-950 transition hover:text-[#985744] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c98d7b] focus-visible:ring-offset-2"
          >
            <span className="truncate">{mobileDescription}</span>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#dcc9c1] text-[#985744] transition group-hover:border-[#b86e59] group-hover:bg-[#fbf1ed]">
              <ArrowIcon direction="up-right" className="h-3 w-3" />
            </span>
          </Link>
        ) : (
          <p className="truncate text-sm font-semibold text-stone-950">
            {description}
          </p>
        )}
        <p className="mt-1 truncate text-[11px] font-medium text-stone-400">
          {primaryDateLabel(verification)}
          <span aria-hidden="true"> · </span>
          {entryCount === 0
            ? "ingen kontering"
            : `${entryCount} ${entryCount === 1 ? "rad" : "rader"}`}
          <span aria-hidden="true"> · </span>
          {fileCount ? `${fileCount} ${fileCount === 1 ? "bilaga" : "bilagor"}` : "ingen bilaga"}
          {!balanced ? (
            <>
              <span aria-hidden="true"> · </span>
              <span className="text-red-700">obalanserad</span>
            </>
          ) : null}
        </p>
      </div>

      {orderId ? (
        <button
          type="button"
          aria-label={`${expanded ? "Dölj" : "Visa"} verifikation A${verification.verificationNumber}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="flex shrink-0 items-center gap-3 text-right"
        >
          {amountAndToggle}
        </button>
      ) : (
        <div className="flex shrink-0 items-center gap-3 text-right">
          {amountAndToggle}
        </div>
      )}
    </div>
  );

  return (
    <div className={expanded ? "bg-stone-50" : "bg-white"}>
      {orderId ? (
        <div className="accounting-mobile-entry-trigger w-full px-4 py-3.5 text-left">
          {summaryContent}
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="accounting-mobile-entry-trigger w-full px-4 py-3.5 text-left"
        >
          {summaryContent}
        </button>
      )}

      {expanded ? (
        <div className="border-t border-slate-200 px-4 pb-5 pt-4">
          <VerificationDetails verification={verification} />
        </div>
      ) : null}
    </div>
  );
}
