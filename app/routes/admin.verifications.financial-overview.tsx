import { json, LoaderFunction } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { Verifications } from "~/schemas/verifications"; // Din MongoDB schema
import { auth } from "~/services/auth.server";
import { ReportType } from "~/types";
import { accounts } from "~/utils/accounts";
import { getDomain } from "~/utils/domain";

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const domain = getDomain(request);
  const user = await auth.isAuthenticated(request, {
    failureRedirect: "/login",
  });

  const fromParam = url.searchParams.get("from"); // Få startdatum som query param
  const toParam = url.searchParams.get("to"); // Få slutdatum som query param

  // Om `from` och `to` inte finns, sätt standardvärden för hela året
  const from = fromParam
    ? new Date(
        parseInt(fromParam.slice(0, 4)),
        parseInt(fromParam.slice(4, 6)) - 1,
        parseInt(fromParam.slice(6, 8))
      ) // Format YYYYMMDD
    : new Date(user.fiscalYear, 0, 1); // 1 januari innevarande år
  const to = toParam
    ? new Date(
        parseInt(toParam.slice(0, 4)),
        parseInt(toParam.slice(4, 6)) - 1,
        parseInt(toParam.slice(6, 8)),
        23,
        59,
        59,
        999
      ) // Format YYYYMMDD
    : new Date(user.fiscalYear, 11, 31, 23, 59, 59, 999); // 31 december innevarande år

  // Hämta alla verifikationer inom den angivna perioden
  const verifications = await Verifications.find({
    verificationDate: {
      $gte: from,
      $lte: to,
    },
    domain: domain?.domain,
  });

  console.log(from, to);

  return json({ verifications, from, to });
};

const filterAccounts = (type: ReportType) =>
  accounts.filter((account) => account.reportType === type);

const sumAccounts = (verifications, accounts) => {
  return accounts
    .reduce((total, account) => {
      const accountTotal = verifications.reduce((acc, v) => {
        const entries = v.journalEntries.filter(
          (entry) => entry.account === account
        );
        const accountSum = entries.reduce(
          (sum, entry) => sum + (entry.debit || 0) - (entry.credit || 0),
          0
        );
        return acc + accountSum;
      }, 0);
      return total + accountTotal;
    }, 0)
    .toFixed(2);
};

const FinancialReportSection = ({ title, accounts, verifications }) => (
  <div className="mb-8">
    <h4 className="font-semibold text-lg text-gray-700">{title}</h4>
    <table className="w-full table-auto divide-y divide-gray-300">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
            Kontonamn
          </th>
          <th className="px-4 py-3 text-right text-sm font-medium text-gray-500 uppercase tracking-wider">
            Belopp
          </th>
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-gray-200">
        {accounts.map((account) => (
          <tr key={account.value}>
            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
              {account.label}
            </td>
            <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-500">
              {sumAccounts(verifications, [account.value])} SEK
            </td>
          </tr>
        ))}
        <tr className="font-bold bg-gray-100">
          <td className="px-4 py-3">Total {title.toLowerCase()}</td>
          <td className="px-4 py-3 text-right">
            {sumAccounts(
              verifications,
              accounts.map((a) => a.value)
            )}{" "}
            SEK
          </td>
        </tr>
      </tbody>
    </table>
  </div>
);


function formatDateRange(startDate, endDate) {
  const start = new Date(startDate).toISOString().slice(0, 10);

  // Kontrollera om slutdatum är det sista datumet för det året
  const endDateObj = new Date(endDate);
  const isEndOfYear = endDateObj.getMonth() === 11 && endDateObj.getDate() === 31;
  const end = isEndOfYear
    ? `${endDateObj.getFullYear()}-12-31`
    : endDateObj.toISOString().slice(0, 10);

  return `${start} - ${end}`;
}

export default function FinancialReportModal() {
  const navigate = useNavigate();
  const { verifications, from, to } = useLoaderData(); // Data från loader

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
                  Balans- och Resultaträkning för {formatDateRange(from, to)}
                </h3>

                <div className="mt-6">
                  {/* Balansräkning */}
                  <FinancialReportSection
                    title="Tillgångar"
                    accounts={filterAccounts(ReportType.BALANCE)}
                    verifications={verifications}
                  />
                  <FinancialReportSection
                    title="Skulder"
                    accounts={filterAccounts(ReportType.LIABILITIES)}
                    verifications={verifications}
                  />

                  {/* Resultaträkning */}
                  <FinancialReportSection
                    title="Intäkter"
                    accounts={filterAccounts(ReportType.INCOME)}
                    verifications={verifications}
                  />
                  <FinancialReportSection
                    title="Kostnader"
                    accounts={filterAccounts(ReportType.EXPENSE)}
                    verifications={verifications}
                  />
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
