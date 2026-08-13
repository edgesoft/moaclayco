export const collectionCardProjection =
  "headline shortDescription longDescription image shortUrl";

export const collectionDetailProjection =
  "headline shortDescription longDescription image shortUrl";

export const collectionItemProjection =
  "headline price productInfos images instagram collectionRef amount longDescription additionalItems.name additionalItems.price";

export const landingItemProjection =
  "headline price images collectionRef amount productInfos longDescription";

export const verificationListProjection =
  "-_id recordType description verificationNumber verificationDate metadata.key metadata.value files.name files.path journalEntries.account journalEntries.debit journalEntries.credit";

export const vatReportListProjection =
  "-_id metadata.key metadata.value journalEntries.account journalEntries.debit journalEntries.credit";
