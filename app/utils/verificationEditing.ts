export type VerificationEditPolicy = {
  editable: boolean;
  reason: string | null;
  reportedPeriods: string[];
};

export const evaluateVerificationEditPolicy = ({
  recordType,
  metadataKeys,
  yearStatus,
  sameAccountingYear,
  reportedPeriods,
}: {
  recordType?: string;
  metadataKeys: string[];
  yearStatus: "open" | "closed";
  sameAccountingYear: boolean;
  reportedPeriods: string[];
}): VerificationEditPolicy => {
  const isSystemRecord =
    recordType === "incomingBalance" ||
    recordType === "vatReport" ||
    metadataKeys.includes("IB") ||
    metadataKeys.includes("vatReport") ||
    metadataKeys.includes("vatPaymentFor");
  if (isSystemRecord) {
    return {
      editable: false,
      reason:
        "Ingående balans, momsrapporter och registrerade momshändelser ändras inte direkt. Skapa en ny rättelseverifikation i stället.",
      reportedPeriods: [],
    };
  }
  if (yearStatus === "closed") {
    return {
      editable: false,
      reason:
        "Bokföringsåret är avslutat. Skapa en spårbar rättelse i ett öppet bokföringsår.",
      reportedPeriods: [],
    };
  }
  if (!sameAccountingYear) {
    return {
      editable: false,
      reason:
        "Bokföringsdatumet måste ligga kvar i samma bokföringsår. Skapa en ny verifikation om rättelsen hör till ett annat år.",
      reportedPeriods: [],
    };
  }
  const uniqueReportedPeriods = Array.from(new Set(reportedPeriods)).sort();
  if (uniqueReportedPeriods.length) {
    return {
      editable: false,
      reason: `Momsrapporten är redan inskickad för ${uniqueReportedPeriods.join(", ")}. Skapa en ny verifikation som rättar felet i stället.`,
      reportedPeriods: uniqueReportedPeriods,
    };
  }
  return { editable: true, reason: null, reportedPeriods: [] };
};
