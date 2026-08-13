import { Verifications } from "~/schemas/verifications";
import {
  buildIncomingBalanceEntries,
  type BalanceVerification,
} from "~/utils/accounts";
import { getAccountingYearBounds } from "~/utils/accountingDates";
import type { ClientSession } from "mongoose";

export const getIBJournalEntries = async (
  domain: string,
  year: number,
  session?: ClientSession
) => {
  const bounds = getAccountingYearBounds(year);
  if (!bounds) throw new Error("Ogiltigt bokföringsår för ingående balans");

  const query = Verifications.find({
    domain,
    verificationDate: {
      $gte: bounds.start,
      $lt: bounds.end,
    },
  })
    .select("journalEntries")
    .lean();
  if (session) query.session(session);
  const previousVerifications = await query.exec();

  // Årets IB måste ingå: den är startsaldot som årets rörelser byggs ovanpå.
  return buildIncomingBalanceEntries(
    previousVerifications as unknown as BalanceVerification[]
  );
};
