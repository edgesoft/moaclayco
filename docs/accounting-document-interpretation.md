# Accounting document interpretation

## Flow

1. Authenticate the user and validate the file type and 20 MB size limit.
2. Send the complete PDF or image directly to the configured OpenAI model with
   high visual detail.
3. Parse the response into the Zod accounting schema.
4. Reject invalid dates, duplicate accounts, invalid debit/credit lines,
   unbalanced entries, or a total that does not match the journal entry.
5. Upload the original file to S3 only after interpretation succeeds.
6. Return one form-ready suggestion for a single-entry document, or all entries
   with review status for a multi-entry statement.

No intermediate OCR text is stored or logged. API failures are logged only with
error name, HTTP status, and request ID. OpenAI response storage is disabled for
the request.

## Model configuration

`OPENAI_ACCOUNTING_MODEL` controls the model. It defaults to `gpt-5.6-terra`,
which balances document-interpretation quality and cost while supporting image
input, the Responses API, and structured outputs.

Non-GPT-5 models run with temperature zero. GPT-5-family models use medium
reasoning effort instead because those models do not share the same sampling
controls.

## Regression fixtures

The repository contains synthetic data only:

- A paid supplier invoice verifies material cost, input VAT, business-bank
  payment, and the Moa Clay Co policy for freight on material purchases.
- A two-page tax-account statement verifies that every page is read, source
  signs are retained, balance rows are ignored, and deposits, preliminary tax,
  VAT, and interest use the expected sole-proprietorship accounts.

Bank statements use a document-type-specific account context. The model matches
Moa Clay Co's known SEB business account in local or IBAN form to BAS 1930 and
the owner's known private SEB account to BAS 2018. Server validation then rejects
a bank-statement result when the selected source account, amount direction, and
journal line disagree. These rules are explicitly excluded from invoice and
receipt interpretation.

The output allowance is sized for long multi-page statements with up to 200
entries; short invoices and receipts still return only their actual structured
content.

Invoice and receipt output is constrained to the accounts configured in the
Moa app. Domestic Moa sales use 3001, hosting/domain/e-mail costs use the app's
broader 6990 category, and a payment instruction that explicitly says it is not
VAT evidence must never create input VAT on 2640. Receipt VAT follows the
printed VAT breakdown, including mixed rates and discounts; bank transaction
details alone are not treated as VAT-supporting receipts.

Consumable production components such as clay, earring posts, and jewelry parts
use 4000, while 5410 is reserved for durable tools, furniture, and equipment. A
paid invoice or receipt with only a masked, unidentified card is conservatively
posted against 2018 with review status; 1930 requires evidence of the business
account or a known business card. The known-account context also recognizes the
owner's older SEB account ending in 2115 as private.

The API regression is intentionally opt-in because it uses real API credits and
requires `OPENAI_API_KEY`. Unit tests always run in CI and never call OpenAI.
