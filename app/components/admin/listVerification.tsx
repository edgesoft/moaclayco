import { Link } from "react-router";
import { useEffect, useState } from "react";
import { VerificationProps } from "~/types";
import { formatMonthName } from "~/utils/formatMonthName";
import {
  ListItemVerification,
  MobileVerificationCard,
} from "./listItemVerification";

type GroupVerificationProps = {
  monthKey: string;
  groupedVerifications: Record<string, VerificationProps[]>;
  vatReportVerification: VerificationProps | undefined;
  currentYearMonth: string;
  isExpanded: boolean;
};

const findMinMax = (verifications: VerificationProps[]) =>
  verifications.reduce(
    (range, verification) => ({
      min: Math.min(range.min, verification.verificationNumber),
      max: Math.max(range.max, verification.verificationNumber),
    }),
    { min: Infinity, max: -Infinity }
  );

export function ListVerification({
  monthKey,
  groupedVerifications,
  vatReportVerification,
  currentYearMonth,
  isExpanded = false,
}: GroupVerificationProps) {
  const [expanded, setExpanded] = useState(isExpanded);
  const verifications = groupedVerifications[monthKey] || [];
  const minMax = findMinMax(verifications);

  useEffect(() => {
    if (isExpanded) setExpanded(true);
  }, [isExpanded]);

  const shouldRegisterVat = () => {
    if (!vatReportVerification) return false;
    const hasVatAccount = vatReportVerification.journalEntries?.some(
      (entry) => entry.account === 2650
    );
    const isRegistered = vatReportVerification.metadata?.some(
      (meta) =>
        meta.key === "vatRegisteredAtAccount" && String(meta.value) === "true"
    );
    return hasVatAccount && !isRegistered;
  };

  const isPastMonth = monthKey < currentYearMonth;

  const rangeLabel =
    verifications.length === 0
      ? "Inga bokföringshändelser"
      : minMax.min === minMax.max
      ? `A${minMax.min}`
      : `A${minMax.min}–A${minMax.max}`;
  const registerVat = shouldRegisterVat();
  const vatDone = Boolean(vatReportVerification) && !registerVat;
  const isZeroVatReport = Boolean(vatReportVerification) &&
    !vatReportVerification?.journalEntries?.some(
      (entry) => Number(entry.debit || 0) !== 0 || Number(entry.credit || 0) !== 0
    );

  return (
    <article className="accounting-month overflow-hidden">
      <div className="accounting-month-header flex flex-col lg:flex-row lg:items-center lg:justify-between">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="accounting-month-trigger flex min-h-[68px] flex-1 items-center justify-between gap-4 px-4 py-3.5 text-left transition hover:bg-stone-50 sm:px-5"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className={`accounting-month-toggle ${expanded ? "accounting-month-toggle--open" : ""}`}
              >
                {expanded ? "−" : "+"}
              </span>
              <h2 className="truncate text-lg text-stone-950 sm:text-xl">
                {formatMonthName(monthKey)}
              </h2>
            </div>
            <p className="ml-9 mt-1 text-xs text-stone-400 sm:text-sm">
              {verifications.length} {verifications.length === 1 ? "verifikation" : "verifikationer"}
              <span aria-hidden="true"> · </span>
              {rangeLabel}
            </p>
          </div>

          {vatDone ? (
            <span className="accounting-vat-done">
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="10" cy="10" r="7" />
                <path d="m6.8 10.1 2.1 2.1 4.5-4.6" />
              </svg>
              Moms klar
            </span>
          ) : null}
        </button>

        {isPastMonth && (!vatReportVerification || registerVat) ? (
          <div className="border-t border-stone-200 px-4 py-2 lg:border-l lg:border-t-0 lg:px-5 lg:py-3">
            {!vatReportVerification ? (
              <Link
                to={`/admin/verifications/vat-report?month=${monthKey}`}
                prefetch="intent"
                className="accounting-inline-action"
              >
                Registrera momsdeklaration <span aria-hidden="true">→</span>
              </Link>
            ) : registerVat ? (
              <Link
                to={`/admin/verifications/vat-report-payed?month=${monthKey}`}
                prefetch="intent"
                className="accounting-inline-action"
              >
                Registrera momsbetalning <span aria-hidden="true">→</span>
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {expanded && verifications.length === 0 ? (
        <p className="border-t border-stone-200 px-5 py-6 text-sm leading-6 text-stone-500">
          {!vatReportVerification ? (
            <>
              Inga verifikationer är bokförda i månaden. Momsdeklarationen kan
              ändå registreras som en nollrapport.
            </>
          ) : registerVat ? (
            <>
              Momsdeklarationen är registrerad. Momsbetalningen återstår och kan
              registreras ovan.
            </>
          ) : (
            <>
              Momsdeklarationen är redan registrerad
              {isZeroVatReport ? " som nollrapport" : ""}. Det finns inga andra
              bokföringshändelser i månaden.
            </>
          )}
        </p>
      ) : expanded ? (
        <div>
          <div className="divide-y divide-stone-100 md:hidden">
            {verifications.map((verification) => (
              <MobileVerificationCard
                key={verification.verificationNumber}
                verification={verification}
              />
            ))}
          </div>

          <div className="hidden md:block">
            <table className="w-full table-fixed">
              <thead className="bg-stone-50/80">
                <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="w-[11%] px-5 py-3">Nr</th>
                  <th className="w-[14%] px-3 py-3">Datum</th>
                  <th className="px-3 py-3">Beskrivning</th>
                  <th className="w-[15%] px-3 py-3">Bilagor</th>
                  <th className="w-[18%] px-3 py-3 text-right">Debet</th>
                  <th className="w-12 px-3 py-3"><span className="sr-only">Visa</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {verifications.map((verification) => (
                  <ListItemVerification
                    key={verification.verificationNumber}
                    verification={verification}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </article>
  );
}
