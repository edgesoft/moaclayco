import { ReportType } from "~/types";

export const accounts = [
    { value: 1510, label: "1510 - Kundfordringar", reportType: ReportType.BALANCE },
    { value: 1580, label: "1580 - Fordran på Stripe", reportType: ReportType.BALANCE },
    { value: 1910, label: "1910 - Kassa", reportType: ReportType.BALANCE },
    { value: 1930, label: "1930 - Bank", reportType: ReportType.BALANCE },
    { value: 2012, label: "2012 - Avräkning för skatter och avgifter", reportType:ReportType.LIABILITIES },
    { value: 2013, label: "2013 - Eget uttag", reportType: ReportType.LIABILITIES },
    { value: 2018, label: "2018 - Egen insättning", reportType: ReportType.LIABILITIES },
    { value: 2050, label: "2050 - Skattekontotransaktioner", reportType: ReportType.LIABILITIES },
    { value: 2440, label: "2440 - Leverantörsskulder", reportType: ReportType.LIABILITIES },
    { value: 2611, label: "2611 - Utgående moms på varor och frakt", reportType: ReportType.LIABILITIES },
    { value: 2640, label: "2640 - Ingående moms", reportType: ReportType.LIABILITIES },
    { value: 2650, label: "2650 - Momsskuld", reportType: ReportType.LIABILITIES },
    { value: 3001, label: "3001 - Försäljning av varor", vatAccount: 2611, reportType: ReportType.INCOME}, // Resultaträkning
    { value: 3740, label: "3740 - Öres- och kronutjämning", reportType:  ReportType.INCOME }, // Resultaträkning
    { value: 4000, label: "4000 - Material/Varukostnader", vatAccount: 2640, reportType: ReportType.EXPENSE }, // Resultaträkning
    { value: 5410, label: "5410 - Förbrukningsinventarier", reportType: ReportType.EXPENSE }, // Resultaträkning
    { value: 6570, label: "6570 - Kostnader för betalningsförmedling", reportType: ReportType.EXPENSE }, // Resultaträkning
    { value: 6990, label: "6990 - Övriga externa kostnader", reportType: ReportType.EXPENSE }, // Resultaträkning
    { value: 8313, label: "8313 - Ränteintäkter bank", reportType:  ReportType.INCOME }, // Resultaträkning
  ];