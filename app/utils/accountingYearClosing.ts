export type AccountingYearStatus = "open" | "closed";

export type ClosingVatReport = {
  period: string;
  journalEntries: Array<{
    account: number;
    debit?: number;
    credit?: number;
  }>;
  metadata?: Array<{ key: string; value: string }>;
};

export const accountingYearMonthKeys = (year: number) =>
  Array.from(
    { length: 12 },
    (_, monthIndex) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`
  );

const vatBalance = (report: ClosingVatReport) =>
  report.journalEntries
    .filter((entry) => entry.account === 2650)
    .reduce(
      (total, entry) =>
        total + Number(entry.debit || 0) - Number(entry.credit || 0),
      0
    );

const isVatRegisteredAtAccount = (report: ClosingVatReport) =>
  report.metadata?.some(
    (entry) =>
      entry.key === "vatRegisteredAtAccount" && entry.value === "true"
  ) ?? false;

export const evaluateAccountingYearClosing = ({
  year,
  currentYear,
  status,
  vatReports,
}: {
  year: number;
  currentYear: number;
  status: AccountingYearStatus;
  vatReports: ClosingVatReport[];
}) => {
  const requiredVatMonths = accountingYearMonthKeys(year);
  const reportsByPeriod = new Map(
    vatReports.map((report) => [report.period, report])
  );
  const missingVatMonths = requiredVatMonths.filter(
    (period) => !reportsByPeriod.has(period)
  );
  const payableReports = vatReports.filter(
    (report) => Math.abs(vatBalance(report)) >= 0.005
  );
  const unsettledVatMonths = payableReports
    .filter((report) => !isVatRegisteredAtAccount(report))
    .map((report) => report.period)
    .sort();
  const yearHasPassed = year < currentYear;
  const canClose =
    status === "open" &&
    yearHasPassed &&
    missingVatMonths.length === 0 &&
    unsettledVatMonths.length === 0;

  return {
    status,
    year,
    yearHasPassed,
    canClose,
    requiredVatReportCount: requiredVatMonths.length,
    registeredVatReportCount:
      requiredVatMonths.length - missingVatMonths.length,
    requiredVatPaymentCount: payableReports.length,
    registeredVatPaymentCount:
      payableReports.length - unsettledVatMonths.length,
    missingVatMonths,
    unsettledVatMonths,
  };
};
