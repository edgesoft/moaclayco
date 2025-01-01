import { useNavigate } from "@remix-run/react";
import React, { useState } from "react";
import { classNames } from "~/utils/classnames";

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
};

type VerificationProps = {
  journalEntries: [
    {
      debit: number;
      credit: number;
      account: number;
    }
  ];
  verificationNumber: number;
  verificationDate: string;
  description: string;
  files: [
    {
      name: string;
      path: string;
    }
  ];
};

type ListVerificationProps = {
  verification: VerificationProps
};

export function ListItemVerification({
  verification,
}: ListVerificationProps) {
  const navigate = useNavigate();
  

  // Summera debit och kredit per verifikation
  const debitSum = verification.journalEntries.reduce(
    (sum, entry) => sum + entry.debit,
    0
  );
  const creditSum = verification.journalEntries.reduce(
    (sum, entry) => sum + entry.credit,
    0
  );
  return (
    <React.Fragment key={verification.verificationNumber}>
      <tr className="">
        <td className="px-2 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
          <span
            className={classNames(
              `bg-green-600 text-white inline-flex px-2 text-xs font-semibold leading-5 rounded-full`
            )}
          >
            A{verification.verificationNumber}
          </span>
        </td>
        <td className="px-2 py-4 whitespace-nowrap text-sm text-gray-500">
          {formatDate(verification.verificationDate)}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          <button
            onClick={() => {
              navigate(
                `/admin/verifications/${verification.verificationNumber}/files`
              );
            }}
            className="bg-slate-800 text-white px-2 py-1 rounded-lg font-semibold text-xs"
          >
            Koppla fil
          </button>
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">
          {debitSum.toFixed(2)}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">
          {creditSum.toFixed(2)}
        </td>
      </tr>
      {/* Rad utan divider */}
      <tr className="border-b border-gray-200 ">
        <td colSpan={5} className="border-0 text-xs text-gray-500">
          <div className="mb-2 pl-1">
            <span
              dangerouslySetInnerHTML={{
                __html: verification.description.replace(/\r\n/g, "<br />"),
              }}
            />
            <ul className="">
              {verification.files.map((file, index) => (
                <li key={index} className="py-2 flex justify-between">
                  <a
                    href={file.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500"
                  >
                    <span>{file.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </td>
      </tr>
      {verification.journalEntries.map((entry, index) => {
        if (entry.credit === 0 && entry.debit === 0) return null;
        return (
          <tr key={index} className="bg-gray-50 border-b border-gray-200">
            <td colSpan={2}></td>
            <td className="px-6 py-2 text-sm text-gray-500">{entry.account}</td>
            <td className="px-6 py-2 text-right text-sm text-gray-500">
              {entry.debit !== 0 ? entry.debit.toFixed(2) : "-"}
            </td>
            <td className="px-6 py-2 text-right text-sm text-gray-500">
              {entry.credit > 0 ? entry.credit.toFixed(2) : "-"}
            </td>
          </tr>
        );
      })}
      
      <tr className="bg-gray-100">
        <td colSpan={3} className="px-6 py-2 text-right font-bold"></td>
        <td className="px-6 py-2 text-right font-bold">
          {debitSum.toFixed(2)}
        </td>
        <td className="px-6 py-2 text-right font-bold">
          {creditSum.toFixed(2)}
        </td>
      </tr>
    </React.Fragment>
  )
}
