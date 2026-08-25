export const collectionCardProjection =
  "headline shortDescription longDescription image shortUrl";

export const collectionDetailProjection =
  "headline shortDescription longDescription image shortUrl";

export const collectionEditorProjection =
  "headline shortDescription longDescription image instagram twitter shortUrl";

export const collectionItemProjection =
  "headline price productInfos images instagram collectionRef amount longDescription additionalItems.name additionalItems.price";

export const itemEditorProjection = collectionItemProjection;

export const landingItemProjection =
  "headline price images collectionRef amount productInfos longDescription";

export const discountProjection = "code expireAt percentage balance";

export const checkoutOrderProjection =
  "discount freightCost items kind paymentIntent.client_secret specialOrder totalSum";

export const orderConfirmationProjection =
  "customer discount freightCost items paymentIntent.id status totalSum";

export const orderDetailProjection =
  "createdAt customer discount freightCost items kind manualOrderAt paymentIntent shippingEmailAt specialOrder status totalSum webhookAt";

export const verificationListProjection =
  "-_id recordType description verificationNumber verificationDate metadata.key metadata.value files.name files.path journalEntries.account journalEntries.debit journalEntries.credit";

export const vatReportListProjection =
  "-_id metadata.key metadata.value journalEntries.account journalEntries.debit journalEntries.credit";

export const vatPeriodVerificationProjection =
  "verificationNumber journalEntries.account journalEntries.debit journalEntries.credit";

export const vatPaymentVerificationProjection =
  "metadata.key metadata.value journalEntries.account journalEntries.debit journalEntries.credit";
