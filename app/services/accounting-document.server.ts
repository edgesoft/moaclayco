import { zodTextFormat } from "openai/helpers/zod";
import type { Responses } from "openai/resources/responses/responses";
import { z } from "zod";
import { getOpenAIClient } from "~/services/openapi.server";
import { normalizeJournalEntries } from "~/utils/verificationValidation";
import {
  fallbackVerificationFileLabel,
  sanitizeVerificationFileLabel,
} from "~/utils/verificationFiles";

const accountLineSchema = z.object({
  account: z.string().regex(/^\d{4}$/),
  debit: z.number().min(0),
  credit: z.number().min(0),
});

const accountingEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  total: z.number(),
  sourceReference: z.string(),
  sourceAccount: z.enum([
    "business_bank",
    "private_bank",
    "tax_account",
    "customer_receivable",
    "cash",
    "unknown",
  ]),
  accounts: z.array(accountLineSchema).min(2).max(12),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});

export const accountingDocumentSchema = z.object({
  documentType: z.enum([
    "sales_invoice",
    "supplier_invoice",
    "receipt",
    "bank_statement",
    "tax_account_statement",
    "other",
  ]),
  entries: z.array(accountingEntrySchema).min(1).max(200),
  warnings: z.array(z.string()),
});

export type AccountingDocumentAnalysis = z.infer<
  typeof accountingDocumentSchema
>;
export type AccountingEntry = AccountingDocumentAnalysis["entries"][number];

export type VerificationSuggestion = {
  date: string;
  description: string;
  accounts: Record<string, { debit: number; credit: number }>;
  confidence: number;
  warnings: string[];
  sourceReference: string;
  sourceAccount: AccountingEntry["sourceAccount"];
};

const documentLabelByType: Record<AccountingDocumentAnalysis["documentType"], string> = {
  sales_invoice: "Kundfaktura",
  supplier_invoice: "Leverantörsfaktura",
  receipt: "Kvitto",
  bank_statement: "Kontoutdrag",
  tax_account_statement: "Skattekontoutdrag",
  other: "Bokföringsunderlag",
};

export const toAccountingDocumentLabel = (
  analysis: AccountingDocumentAnalysis,
  originalFileName: string
) => {
  if (analysis.entries.length === 1) {
    return sanitizeVerificationFileLabel(analysis.entries[0].description);
  }

  const dates = analysis.entries.map((entry) => entry.date).sort();
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const period = firstDate
    ? firstDate === lastDate
      ? firstDate
      : `${firstDate}–${lastDate}`
    : "";
  const label = sanitizeVerificationFileLabel(
    `${documentLabelByType[analysis.documentType]} ${period}`
  );

  return label || fallbackVerificationFileLabel(originalFileName);
};

const ACCOUNTING_INSTRUCTIONS = `
Du tolkar bokföringsunderlag för Moa Clay Co, en svensk enskild firma.
Läs och tolka hela dokumentet, inklusive alla sidor, tabeller, sidhuvuden och
fotnoter. Skapa en separat entry för varje ekonomiskt självständig transaktion.

Grundregler:
- Alla belopp är SEK om dokumentet inte uttryckligen anger något annat.
- total ska bevara källans tecken för kontoutdrag: insättningar och krediteringar
  är positiva, medan uttag, debiteringar och avgifter är negativa. Fakturor och
  kvitton använder positiv total om dokumentet inte är en kreditnota eller retur.
- Datum ska vara YYYY-MM-DD. Härled saknat år från dokumentets period, inte från
  dagens datum. Lägg en varning om året fortfarande är osäkert.
- Varje entry måste balansera exakt: summa debit ska vara lika med summa credit.
- Debit och credit ska vara positiva tal eller noll. Samma kontorad får inte ha
  både debit och credit.
- Använd fyrsiffriga BAS-konton. Använd aldrig konto 2050; verksamheten är en
  enskild firma.
- Gissa inte om ett bankkonto är företagskonto eller privatkonto. Markera
  sourceAccount som unknown och lägg en tydlig varning när dokumentet inte ger
  tillräckligt stöd.
- Ingående och utgående saldo i ett kontoutdrag är kontrollsummor, inte egna
  transaktioner.
- Returnera alla poster i kontoutdraget. Hoppa inte över ränta, avgifter,
  insättningar eller överföringar.
- En rad i ett kontoutdrag är en egen affärshändelse. Slå aldrig ihop en
  inbetalning till skattekontot med en senare moms- eller skattedebitering, även
  om beloppen råkar vara lika eller ligger nära varandra i tid.

Vanliga konteringsregler för denna enskilda firma:
- Egen insättning från privat konto till verksamheten: debit 1930, credit 2018.
- Eget uttag från verksamhetens bank: debit 2013, credit 1930.
- Insättning till skattekontot från privat konto: debit 2012, credit 2018.
- Insättning till skattekontot från verksamhetens bank: debit 2012, credit 1930.
- Debiterad preliminärskatt på skattekontot: debit 2013, credit 2012.
- Betald moms från skattekontot: debit 2650, credit 2012.
- Skattefri intäktsränta på skattekontot: debit 2012, credit 8314.
- En skattekontorad med texten "Moms <period>" ska bara flytta beloppet mellan
  2650 och 2012. Lägg aldrig till 1930 eller 2018 på samma entry. En separat
  rad "Inbetalning bokförd" blir en separat entry med sitt eget faktiska datum.
- Leverantörsfaktura som är betald: debit relevant kostnadskonto och 2640 för
  ingående moms, credit 1930 för totalen. Om den är obetald används 2440.
- Inköp av lera, råmaterial och varor för produktion bokförs på 4000 om
  dokumentet inte ger stöd för ett mer specifikt kostnadskonto.
- Frakt på samma leverantörsfaktura som ett material- eller varuinköp ska ingå
  i 4000 i detta bokföringsflöde; skapa inte en separat 57xx-rad för frakten.
- Försäljningsfaktura: credit relevant försäljningskonto och 2611 för utgående
  moms, debit 1510 om obetald eller 1930 om dokumentet visar betalning.

Använd dokumentets faktiska innehåll som källa. Om kontovalet inte är säkert,
välj det mest rimliga kontot, sänk confidence och förklara osäkerheten i warnings.
Beskrivningen ska vara kort, tydlig och innehålla relevant faktura-, kvitto- eller
transaktionsreferens.
`;

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

const isRealDate = (date: string) => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
};

const assertTaxAccountPattern = (
  entry: AccountingEntry,
  entryIndex: number
) => {
  const description = entry.description.trim().toLocaleLowerCase("sv-SE");
  const amounts = new Map(
    entry.accounts.map((line) => [Number(line.account), line])
  );
  const hasExactAccounts = (...expected: number[]) =>
    amounts.size === expected.length && expected.every((account) => amounts.has(account));
  const fail = (message: string): never => {
    throw new Error(`Entry ${entryIndex + 1} ${message}`);
  };

  if (description.includes("intäktsränta")) {
    if (
      !hasExactAccounts(2012, 8314) ||
      !amounts.get(2012)?.debit ||
      !amounts.get(8314)?.credit
    ) {
      fail("has an invalid tax-account interest posting");
    }
  }

  if (description.includes("debiterad preliminärskatt")) {
    if (
      !hasExactAccounts(2012, 2013) ||
      !amounts.get(2013)?.debit ||
      !amounts.get(2012)?.credit
    ) {
      fail("has an invalid preliminary-tax posting");
    }
  }

  if (description.startsWith("moms ")) {
    if (
      !hasExactAccounts(2012, 2650) ||
      !amounts.get(2650)?.debit ||
      !amounts.get(2012)?.credit
    ) {
      fail("has an invalid VAT tax-account posting");
    }
  }

  if (description.includes("inbetalning bokförd")) {
    const sourceAccount = amounts.has(1930) ? 1930 : amounts.has(2018) ? 2018 : null;
    if (
      !sourceAccount ||
      !hasExactAccounts(2012, sourceAccount) ||
      !amounts.get(2012)?.debit ||
      !amounts.get(sourceAccount)?.credit
    ) {
      fail("has an invalid tax-account deposit posting");
    }
  }

  if (amounts.has(2650) && (amounts.has(1930) || amounts.has(2018))) {
    fail("combines a VAT charge with its funding transaction");
  }
};

export const validateAccountingAnalysis = (
  analysis: AccountingDocumentAnalysis
) => {
  analysis.entries.forEach((entry, entryIndex) => {
    if (!isRealDate(entry.date)) {
      throw new Error(`Entry ${entryIndex + 1} has an invalid date`);
    }

    const accountNumbers = new Set<string>();
    entry.accounts.forEach((line) => {
      if (accountNumbers.has(line.account)) {
        throw new Error(
          `Entry ${entryIndex + 1} contains duplicate account ${line.account}`
        );
      }
      accountNumbers.add(line.account);

      if ((line.debit > 0 && line.credit > 0) || (line.debit === 0 && line.credit === 0)) {
        throw new Error(
          `Entry ${entryIndex + 1}, account ${line.account} has invalid debit/credit values`
        );
      }
    });

    let normalizedEntries;
    try {
      normalizedEntries = normalizeJournalEntries(entry.accounts);
    } catch (error) {
      if (error instanceof Error && error.message.includes("balanserar inte")) {
        throw new Error(`Entry ${entryIndex + 1} is not balanced`, { cause: error });
      }
      throw error;
    }
    const debitTotal = roundCurrency(
      normalizedEntries.reduce((sum, line) => sum + line.debit, 0)
    );

    if (entry.accounts.some((line) => line.account === "2050")) {
      throw new Error(`Entry ${entryIndex + 1} uses forbidden account 2050`);
    }

    if (analysis.documentType === "tax_account_statement") {
      assertTaxAccountPattern(entry, entryIndex);
    }

    const roundedTotal = roundCurrency(Math.abs(entry.total));
    if (Math.abs(entry.total) !== roundedTotal || roundedTotal !== debitTotal) {
      throw new Error(
        `Entry ${entryIndex + 1} total does not match its journal entry`
      );
    }
  });

  return analysis;
};

export const toVerificationSuggestion = (
  entry: AccountingEntry
): VerificationSuggestion => ({
  date: entry.date,
  description: entry.description,
  accounts: Object.fromEntries(
    entry.accounts.map((line) => [
      line.account,
      {
        debit: roundCurrency(line.debit),
        credit: roundCurrency(line.credit),
      },
    ])
  ),
  confidence: entry.confidence,
  warnings: entry.warnings,
  sourceReference: entry.sourceReference,
  sourceAccount: entry.sourceAccount,
});

const createDocumentInput = ({
  buffer,
  mimeType,
  fileName,
}: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Responses.ResponseInputFile | Responses.ResponseInputImage => {
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

  if (mimeType === "application/pdf") {
    return {
      type: "input_file",
      filename: fileName,
      file_data: dataUrl,
      detail: "high",
    };
  }

  return {
    type: "input_image",
    image_url: dataUrl,
    detail: "high",
  };
};

export const interpretAccountingDocument = async ({
  buffer,
  mimeType,
  fileName,
  model = process.env.OPENAI_ACCOUNTING_MODEL ?? "gpt-5.6-terra",
}: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  model?: string;
}) => {
  const openai = getOpenAIClient();
  const documentInput = createDocumentInput({ buffer, mimeType, fileName });
  const inferenceOptions = model.startsWith("gpt-5")
    ? { reasoning: { effort: "medium" as const } }
    : { temperature: 0 };

  const response = await openai.responses.parse({
    model,
    instructions: ACCOUNTING_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          documentInput,
          {
            type: "input_text",
            text: "Tolka hela dokumentet och returnera samtliga bokföringsposter.",
          },
        ],
      },
    ],
    ...inferenceOptions,
    max_output_tokens: 12_000,
    store: false,
    text: {
      format: zodTextFormat(accountingDocumentSchema, "accounting_document"),
    },
  });

  if (!response.output_parsed) {
    throw new Error("The accounting model returned no structured result");
  }

  return validateAccountingAnalysis(response.output_parsed);
};
