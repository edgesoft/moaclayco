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

export function ListVerification({
  monthKey,
  groupedVerifications,
  vatReportVerification,
  isExpanded = false,
}: GroupVerificationProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(isExpanded);

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
    <div key={monthKey} className={classNames(!expanded ? `bg-gray-100`: `bg-white`,"mb-4 border border-gray-200 rounded-md")}>
      <div className="flex justify-between items-center mb-4 cursor-pointer p-2">
        <h2
          onClick={() => {
            setExpanded(!expanded);
          }}
          className="text-xl font-semibold flex items-center justify-between cursor-pointer"
        >
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

        {!vatReportVerification && isPastMonth(monthKey) && (
          <button
            onClick={() => handleCreateVATReport(monthKey)}
            className="bg-slate-800 text-white px-3 py-1 rounded-lg text-sm"
          >
            Skapa momsrapport ({formatMonthName(monthKey)})
          </button>
        )}

        {vatReportVerification && registerVat && isPastMonth(monthKey) && (
          <button
            onClick={() =>
              navigate(
                `/admin/verifications/vat-report-payed?month=${monthKey}`
              )
            }
            className="bg-slate-800 text-white px-3 py-1 rounded-lg text-sm"
          >
            Registrera/Skattemyndigheten ({formatMonthName(monthKey)})
          </button>
        )}
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
