import { Verifications } from "~/schemas/verifications";

export async function generateNextEntryNumber(domain: string) {
    try {
      const lastEntry = await Verifications.findOne({domain}).sort({ verificationNumber: -1 });
  
      if (lastEntry) {
        const newNumber = lastEntry.verificationNumber + 1;
        return newNumber;
      } else {
        return 1
      }
    } catch (error) {
      console.error('Fel vid generering av löpnummer:', error);
      throw error;
    }
  }