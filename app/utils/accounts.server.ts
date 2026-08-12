import { Verifications } from "~/schemas/verifications";
import {
  buildIncomingBalanceEntries,
  type BalanceVerification,
} from "~/utils/accounts";
import { getAccountingYearBounds } from "~/utils/accountingDates";

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
