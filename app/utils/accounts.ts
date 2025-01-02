import { Verifications } from "~/schemas/verifications";
import { ReportType, VerificationProps } from "~/types";

export const accounts = [
    { value: 1510, label: "1510 - Kundfordringar", reportType: ReportType.BALANCE, isIncomingBalance: true  },
    { value: 1580, label: "1580 - Fordran på Stripe", reportType: ReportType.BALANCE, isIncomingBalance: true  },
    { value: 1910, label: "1910 - Kassa", reportType: ReportType.BALANCE, isIncomingBalance: true  },
    { value: 1930, label: "1930 - Bank", reportType: ReportType.BALANCE, isIncomingBalance: true },
    { value: 2012, label: "2012 - Avräkning för skatter och avgifter", reportType:ReportType.LIABILITIES, isIncomingBalance: true  },
    { value: 2013, label: "2013 - Eget uttag", reportType: ReportType.LIABILITIES },
    { value: 2018, label: "2018 - Egen insättning", reportType: ReportType.LIABILITIES },
    { value: 2050, label: "2050 - Skattekontotransaktioner", reportType: ReportType.NONE },
    { value: 2440, label: "2440 - Leverantörsskulder", reportType: ReportType.LIABILITIES, isIncomingBalance: true  },
    { value: 2611, label: "2611 - Utgående moms på varor och frakt", reportType: ReportType.LIABILITIES, isIncomingBalance: true  },
    { value: 2640, label: "2640 - Ingående moms", reportType: ReportType.LIABILITIES, isIncomingBalance: true  },
    { value: 2650, label: "2650 - Momsskuld", reportType: ReportType.LIABILITIES, isIncomingBalance: true  },
    { value: 2999, label: "2999 - Överföringskonto för UB/IB", reportType: ReportType.NONE },
    { value: 3001, label: "3001 - Försäljning av varor", vatAccount: 2611, reportType: ReportType.INCOME}, 
    { value: 3740, label: "3740 - Öres- och kronutjämning", reportType:  ReportType.INCOME }, 
    { value: 4000, label: "4000 - Material/Varukostnader", vatAccount: 2640, reportType: ReportType.EXPENSE },
    { value: 5410, label: "5410 - Förbrukningsinventarier", reportType: ReportType.EXPENSE },
    { value: 6570, label: "6570 - Kostnader för betalningsförmedling", reportType: ReportType.EXPENSE },
    { value: 6990, label: "6990 - Övriga externa kostnader", reportType: ReportType.EXPENSE }, 
    { value: 8313, label: "8313 - Ränteintäkter bank", reportType:  ReportType.INCOME },
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


  export const getIBJournalEntries = async (domain: string, year: number) => {
    const previousVerifications = await Verifications.find({
      domain: domain,
      verificationDate: {
        $gte: new Date(year, 0, 1), // Från årets början
        $lte: new Date(year, 11, 31), // Till årets slut
      },
    }).exec();
  
    const filteredAccounts = accounts.filter((a) => a.isIncomingBalance).map((a) => a.value)
      // remove IB and UB from previousVerifications
    return  filteredAccounts.map((account) => {
      const sum = sumAccounts(previousVerifications.filter((p) => {
        // TODO: Is this really right?? Shouldn't IB be included?
        if (p.metadata && p.metadata.key === "IB") {
          return false
        }
  
        return true
      }), [account]); // Summera saldon för kontot
      if (sum > 0 || sum < 0) {
        return [
          {
            account, // Det aktuella kontot
            debit: sum > 0 ? parseFloat(sum) : 0,
            credit: sum < 0 ? Math.abs(parseFloat(sum)) : 0,
          },
          {
            account: 2999, // Lägg till 2999 som motkonto
            debit: sum < 0 ? Math.abs(parseFloat(sum)) : 0,
            credit: sum > 0 ? parseFloat(sum) : 0,
          },
        ];
      }
      return []
    }).flat();
  }