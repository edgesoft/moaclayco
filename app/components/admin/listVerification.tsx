import { VerificationProps } from "~/types";
import { ListItemVerification } from "./listItemVerification";
import { formatMonthName } from "~/utils/formatMonthName";
import { Outlet, useNavigate } from "@remix-run/react";
import { useState } from "react";
import { classNames } from "~/utils/classnames";

type GroupVerificationProps = {
  monthKey: string;
  groupedVerifications: {
    [key: string]: VerificationProps[];
  };
  vatReportVerification: VerificationProps | undefined;
  isExpanded: Boolean;
};

function findMinMax(array) {
  return array.reduce(
    (acc, obj) => {
      acc.min = Math.min(acc.min, obj.verificationNumber);
      acc.max = Math.max(acc.max, obj.verificationNumber);
      return acc;
    },
    { min: Infinity, max: -Infinity }
  );
}

export function ListVerification({
  monthKey,
  groupedVerifications,
  vatReportVerification,
  isExpanded = false,
}: GroupVerificationProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(isExpanded);

  const minMax = findMinMax(groupedVerifications[monthKey]);

  const shouldRegisterVat = (verification: VerificationProps | undefined) => {
    if (!verification) {
      return false;
    }
    const account = verification.journalEntries.find(
      (entry) => entry.account === 2650
    );

    if (!account) {
      return false;
    }

    const regged = verification.metadata.some(
      (meta) =>
        meta.key === "vatRegisteredAtAccount" && Boolean(meta.value) === true
    );

    return !regged;
  };

  const isPastMonth = (yearMonthKey: string) => {
    const [year, month] = yearMonthKey.split("-");
    const currentDate = new Date();
    const currentYearMonth = `${currentDate.getFullYear()}-${String(
      currentDate.getMonth() + 1
    ).padStart(2, "0")}`;
    return yearMonthKey < currentYearMonth;
  };

  const registerVat = shouldRegisterVat(vatReportVerification);

  const handleCreateVATReport = (monthKey: string) => {
    navigate(`/admin/verifications/vat-report?month=${monthKey}`);
  };

  return (
    <div
      key={monthKey}
      className={classNames(
        !expanded ? `bg-gray-100` : `bg-white`,
        "mb-4 border border-gray-200 rounded-md"
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setExpanded(!expanded);
      }}
    >
      <div className="flex justify-between items-center mb-4 cursor-pointer p-2">
        <h2 className="text-xl font-semibold flex items-center justify-between cursor-pointer">
          {formatMonthName(monthKey)}
          <svg
            className={`w-5 h-5 transform transition-transform duration-300 ${
              expanded ? "rotate-180" : "rotate-90"
            }`}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </h2>

        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600 mr-2 flex items-center">
            <span className="bg-gray-300 text-gray-500 inline-flex px-2 border-b border-gray-500 text-xs font-semibold leading-5 rounded-full">
              A{minMax.min}
            </span>
            {minMax.min < minMax.max && (
              <div className="flex items-center">
                <svg
                  className="w-4 h-4 transform transition-transform duration-300 rotate-360 text-gray-300"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 5l7 7-7 7"
                  />
                </svg>
                <span className="bg-gray-300 text-gray-500 inline-flex px-2 text-xs font-semibold leading-5 border-b border-gray-500 rounded-full">
                  A{minMax.max}
                </span>
              </div>
            )}
          </div>

          {!vatReportVerification && isPastMonth(monthKey) && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleCreateVATReport(monthKey);
              }}
              className="bg-slate-800 text-white px-3 py-1 rounded-lg text-sm"
            >
              Skapa momsrapport ({formatMonthName(monthKey)})
            </button>
          )}

          {vatReportVerification && registerVat && isPastMonth(monthKey) && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigate(
                  `/admin/verifications/vat-report-payed?month=${monthKey}`
                );
              }}
              className="bg-slate-800 text-white px-3 py-1 rounded-lg text-sm"
            >
              Registrera/Skattemyndigheten ({formatMonthName(monthKey)})
            </button>
          )}
        </div>
      </div>

      {expanded ? (
        <div className="w-full overflow-x-auto">
          <table className="min-w-full w-full divide-y divide-gray-200">
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
              {groupedVerifications[monthKey].map((verification, index) => (
                <ListItemVerification key={index} verification={verification} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
