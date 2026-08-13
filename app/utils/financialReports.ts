import { ReportType } from "~/types";
import type { AccountDefinition } from "~/utils/accounts";

export const financialAccountAmount = (
  rawAmount: number,
  account: AccountDefinition
) =>
  account.reportType === ReportType.INCOME ||
  account.reportType === ReportType.LIABILITIES
    ? -rawAmount
    : rawAmount;

export const financialAccountsTotal = (
  amountByAccount: Record<number, number>,
  reportAccounts: AccountDefinition[]
) =>
  reportAccounts.reduce(
    (total, account) =>
      total +
      financialAccountAmount(amountByAccount[account.value] || 0, account),
    0
  );

export const isAccountingBalance = (difference: number) =>
  Math.abs(difference) < 0.005;

export const taxAccountStatus = (rawAmount: number) => {
  if (rawAmount > 0.005) {
    return {
      kind: "surplus" as const,
      label: "Pengar tillgodo på skattekontot",
      amount: rawAmount,
    };
  }

  if (rawAmount < -0.005) {
    return {
      kind: "deficit" as const,
      label: "Underskott på skattekontot",
      amount: Math.abs(rawAmount),
    };
  }

  return {
    kind: "settled" as const,
    label: "Skattekontot är i balans",
    amount: 0,
  };
};
