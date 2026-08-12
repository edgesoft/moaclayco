import { Verifications } from "~/schemas/verifications";
import { ReportType, VerificationProps } from "~/types";
import { getAccountingYearBounds } from "~/utils/accountingDates";

export const accounts = [
    { value: 1510, label: "1510 - Kundfordringar", reportType: ReportType.BALANCE, isIncomingBalance: true  },
    { value: 1580, label: "1580 - Fordran på Stripe", reportType: ReportType.BALANCE, isIncomingBalance: true  },
    { value: 1910, label: "1910 - Kassa", reportType: ReportType.BALANCE, isIncomingBalance: true  },
    { value: 1930, label: "1930 - Bank", reportType: ReportType.BALANCE, isIncomingBalance: true },
    { value: 2010, label: "2010 - Eget kapital", reportType: ReportType.LIABILITIES, isIncomingBalance: true },
    { value: 2012, label: "2012 - Avräkning för skatter och avgifter", reportType:ReportType.LIABILITIES, isIncomingBalance: true  },
    { value: 2013, label: "2013 - Eget uttag", reportType: ReportType.LIABILITIES, isIncomingBalance: true },
    { value: 2018, label: "2018 - Egen insättning", reportType: ReportType.LIABILITIES, isIncomingBalance: true },
    { value: 2440, label: "2440 - Leverantörsskulder", reportType: ReportType.LIABILITIES, isIncomingBalance: true  },
    { value: 2611, label: "2611 - Utgående moms på varor och frakt", reportType: ReportType.LIABILITIES, isIncomingBalance: true  },
    { value: 2640, label: "2640 - Ingående moms", reportType: ReportType.BALANCE, isIncomingBalance: true  },
    { value: 2650, label: "2650 - Momsskuld", reportType: ReportType.LIABILITIES, isIncomingBalance: true  },
    { value: 2999, label: "2999 - Balanserat resultat från IB", reportType: ReportType.LIABILITIES },
    { value: 3001, label: "3001 - Försäljning av varor", vatAccount: 2611, reportType: ReportType.INCOME}, 
    { value: 3740, label: "3740 - Öres- och kronutjämning", reportType:  ReportType.INCOME }, 
    { value: 4000, label: "4000 - Material/Varukostnader", vatAccount: 2640, reportType: ReportType.EXPENSE },
    { value: 5410, label: "5410 - Förbrukningsinventarier", reportType: ReportType.EXPENSE },
    { value: 6570, label: "6570 - Kostnader för betalningsförmedling", reportType: ReportType.EXPENSE },
    { value: 6990, label: "6990 - Övriga externa kostnader", reportType: ReportType.EXPENSE }, 
    { value: 8313, label: "8313 - Ränteintäkter bank", reportType:  ReportType.INCOME },
    { value: 8314, label: "8314 - Skattefria ränteintäkter", reportType: ReportType.INCOME },
  ];

  export const sumAccounts = (verifications: VerificationProps[], accounts: any[]) => {
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


export const incomingBalanceAccounts = accounts
  .filter((account) => account.isIncomingBalance)
  .map((account) => account.value);

type BalanceVerification = {
  journalEntries: Array<{ account: number; debit?: number; credit?: number }>;
};

export const buildIncomingBalanceEntries = (
  verifications: BalanceVerification[]
) => {
  const balances = new Map<number, number>(
    incomingBalanceAccounts.map((account) => [account, 0])
  );

  for (const verification of verifications) {
    for (const entry of verification.journalEntries ?? []) {
      // 2050 förekommer i äldre data. I enskild firma hör skattekontot till 2012.
      const account = entry.account === 2050 ? 2012 : entry.account;
      if (!balances.has(account)) continue;
      const changeInCents =
        Math.round(Number(entry.debit || 0) * 100) -
        Math.round(Number(entry.credit || 0) * 100);
      balances.set(account, (balances.get(account) ?? 0) + changeInCents);
    }
  }

  const entries = Array.from(balances.entries())
    .filter(([, balanceInCents]) => balanceInCents !== 0)
    .map(([account, balanceInCents]) => ({
      account,
      debit: balanceInCents > 0 ? balanceInCents / 100 : 0,
      credit: balanceInCents < 0 ? Math.abs(balanceInCents) / 100 : 0,
    }));

  const netBalanceInCents = Array.from(balances.values()).reduce(
    (total, balance) => total + balance,
    0
  );
  if (netBalanceInCents !== 0) {
    entries.push({
      account: 2999,
      debit: netBalanceInCents < 0 ? Math.abs(netBalanceInCents) / 100 : 0,
      credit: netBalanceInCents > 0 ? netBalanceInCents / 100 : 0,
    });
  }

  return entries;
};

export const getIBJournalEntries = async (domain: string, year: number) => {
  const bounds = getAccountingYearBounds(year);
  if (!bounds) throw new Error("Ogiltigt bokföringsår för ingående balans");
  const previousVerifications = await Verifications.find({
    domain,
    verificationDate: {
      $gte: bounds.start,
      $lt: bounds.end,
    },
  })
    .select("journalEntries")
    .lean();

  // Årets IB måste ingå: den är startsaldot som årets rörelser byggs ovanpå.
  return buildIncomingBalanceEntries(
    previousVerifications as unknown as BalanceVerification[]
  );
};
