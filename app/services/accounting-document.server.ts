import { zodTextFormat } from "openai/helpers/zod";
import type { Responses } from "openai/resources/responses/responses";
import { z } from "zod";
import { getOpenAIClient } from "~/services/openapi.server";
import { accounts as configuredAccountingAccounts } from "~/utils/accounts";
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

const configuredAccountingAccountNumbers = new Set(
  configuredAccountingAccounts.map((account) => account.value)
);
const configuredAccountingAccountPrompt = configuredAccountingAccounts
  .map((account) => account.label)
  .join("; ");

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
- Använd endast konton som finns i Moa-appens kontoplan:
  ${configuredAccountingAccountPrompt}.
  Hitta inte på närliggande BAS-konton som 3041, 3051 eller 6540. Välj det
  närmast riktiga kontot i listan och lägg en varning om kategorin är osäker.
- Gissa inte om ett bankkonto är företagskonto eller privatkonto. För
  bank_statement får du använda de uttryckliga identifierarna och bevisreglerna
  i det separata bankutdragsavsnittet nedan. Markera annars sourceAccount som
  unknown och lägg en tydlig varning när dokumentet inte ger tillräckligt stöd.
- Ingående och utgående saldo i ett kontoutdrag är kontrollsummor, inte egna
  transaktioner.
- Returnera alla poster i kontoutdraget. Hoppa inte över ränta, avgifter,
  insättningar eller överföringar.
- En rad i ett kontoutdrag är en egen affärshändelse. Slå aldrig ihop en
  inbetalning till skattekontot med en senare moms- eller skattedebitering, även
  om beloppen råkar vara lika eller ligger nära varandra i tid.

Dokumentstruktur, bilagor och vidarefakturering:
- Sidantal är aldrig samma sak som antal bokföringsposter. Avgör först vilka
  sidor som hör till samma huvudunderlag och vilka som bara är bilagor.
- En fil kan innehålla en huvudfaktura tillsammans med en bakomliggande
  leverantörsfaktura, ett kvitto eller en specifikation som visar kostnaden som
  vidarefaktureras. Bilagan är då bevis för huvudfakturans innehåll och ska inte
  bli en egen entry.
- När huvudfakturan hänvisar till "bilaga", "enligt bilaga", "underlag" eller
  liknande och bilagan visar samma netto, moms och totalsumma i ett tidigare led
  av fakturakedjan, returnera bara huvudfakturan som entry. Använd bilagan för
  att förstå beskrivning och belopp, men skapa ingen separat bokföringspost för
  den.
- Följ säljare- och kundkedjan: en faktura från A till B som bifogas en faktura
  från B till C är normalt ett vidarefaktureringsunderlag, inte två oberoende
  transaktioner för samma bokföring.
- Returnera flera entries endast när dokumentet faktiskt innehåller flera
  självständiga affärshändelser som ska bokföras var för sig, exempelvis raderna
  i ett bank- eller skattekontoutdrag.

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
  ingående moms. Credit 1930 bara när underlaget identifierar betalning från
  företagskontot. Om betalningen är genomförd men betalningskontot inte kan
  identifieras, använd credit 2018, sourceAccount unknown och en tydlig varning
  om att privat utlägg behöver verifieras. Om fakturan är obetald används 2440.
- Om ett dokument uttryckligen säger att det inte är ett underlag för moms får
  2640 aldrig användas, även om dokumentet visar en rad kallad moms eller tax.
  Bokför hela bruttobeloppet på relevant kostnadskonto och lägg en varning om
  att giltigt momsunderlag behöver hämtas separat.
- Inköp av lera, öronstickare, smyckesdelar, råmaterial och andra komponenter
  som förbrukas eller byggs in i produkter bokförs på 4000. Använd inte 5410 för
  sådana förbrukade material. 5410 används för varaktiga verktyg, möbler och
  inventarier som används i verksamheten men inte byggs in i det som säljs.
- Frakt på samma leverantörsfaktura som ett material- eller varuinköp ska ingå
  i 4000 i detta bokföringsflöde; skapa inte en separat 57xx-rad för frakten.
- Webbhotell, domännamn, e-postabonnemang och liknande digitala tjänster bokförs
  på 6990 i Moa-appens förenklade kontoplan; använd inte 6540.
- Försäljningsfaktura från Moa Clay Co: använd alltid 3001 för den momspliktiga
  försäljningen och 2611 för utgående moms. Använd inte 3041 eller 3051. Debit
  1510 om fakturan är obetald eller 1930 om dokumentet visar betalning.
- För kvitton ska dokumentets tryckta totalsumma och faktiska momsuppdelning
  följas. Räkna inte om hela köpet som 25 procent om kvittot visar flera
  momssatser, rabatter eller en annan momsberäkning.
- Om delbelopp, moms och att-betala-belopp på en faktura eller ett kvitto
  avviker med högst 1 krona ska skillnaden bokföras på 3740 som avrundning.
  Lägg alltid en tydlig varning om avvikelsen; underkänn inte hela dokumentet.
- När ett kvitto bara visar ett maskerat kort och inte identifierar vilket konto
  som belastats, använd sourceAccount unknown och credit 2018 som försiktig
  hantering av privat utlägg. Använd credit 1930 endast när företagskontot eller
  ett känt företagskort uttryckligen kan identifieras. Lägg alltid en varning om
  att betalningskontot behöver verifieras.
- En banktransaktionsdetalj är inte ett kvitto och ger inte i sig rätt att boka
  ingående moms. Klassificera den som bank_statement och använd inte 2640 utan
  ett separat kvitto eller en separat faktura.
- Om kvittorader är överstrukna, markerade eller färgmarkerade utan en tydlig
  förklaring ska hela den tryckta kvittosumman användas. Sänk confidence och
  varna om att markeringarnas betydelse behöver granskas; exkludera inte rader
  tyst.

Kontoidentifiering för vanliga bankutdrag (gäller endast bank_statement):
- En bankutskrift med rubriken "Detaljer om transaktionen" är också en
  bank_statement, även när dokumentet bara innehåller en transaktion.
- sourceAccount beskriver kontot som utdraget eller transaktionsdetaljen gäller,
  inte mottagarens eller motpartens konto.
- Moa Clay Co:s företagskonto hos SEB är 5722 32 953 76, normaliserat
  57223295376. Samma konto kan visas som IBAN SE84 5000 0000 0572 2329 5376,
  normaliserat SE8450000000057223295376. När något av dessa identifierare syns
  är sourceAccount business_bank och kontoraden för det berörda bankkontot är
  BAS 1930.
- Moa Gustafssons privata SEB-konto är 5130 00 238 99, normaliserat
  51300023899. När det identifieras som kontot som utdraget eller
  transaktionsdetaljen gäller är sourceAccount private_bank och motkontot för
  ägarens privata betalning är BAS 2018.
- Ett äldre privat SEB-konto för Moa Gustafsson är 5709 00 121 15, normaliserat
  57090012115. När detta konto syns i en transaktionsdetalj är sourceAccount
  private_bank och betalningen bokförs mot BAS 2018.
- Ett utdrag med rubriken "Moaclayco" och företagskontots nummer gäller
  företagskontot för samtliga transaktionsrader. Ett personnamn, Stripe-poster
  eller annan verksamhetsaktivitet är bara stödbevis; det exakta kontonumret
  väger tyngst.
- I en transaktionsdetalj anger "Från konto" vilket konto en utgående betalning
  gäller. Vid en inkommande transaktion kan "Till konto" eller motsvarande IBAN
  identifiera kontot som transaktionen gäller. Läs alltid beloppets tecken och
  fältrubrikerna tillsammans.
- En positiv transaktion på företagskontot ska debitera 1930; en negativ ska
  kreditera 1930. En negativ betalning från privatkontot för verksamhetens
  räkning ska kreditera 2018.
- Betalning från privatkontot till Skatteverket med meddelandet "Inbetalning till
  200006116446" bokförs debit 2012 och credit 2018. sourceAccount är
  private_bank eftersom transaktionsdetaljen gäller privatkontot.
- Överföring från företagskontot 57223295376 till privatkontot 51300023899 är
  eget uttag: debit 2013 och credit 1930. sourceAccount är business_bank.
- Använd inte dessa kända konton eller bankutdragsregler för sales_invoice,
  supplier_invoice eller receipt. De dokumenttyperna ska även fortsättningsvis
  tolkas enbart från sitt eget innehåll och de vanliga konteringsreglerna ovan.

Använd dokumentets faktiska innehåll som källa. Om kontovalet inte är säkert,
välj det mest rimliga kontot, sänk confidence och förklara osäkerheten i warnings.
Beskrivningen ska vara kort, tydlig och innehålla relevant faktura-, kvitto- eller
transaktionsreferens.
`;

const roundCurrency = (value: number) => Math.round(value * 100) / 100;
const toCurrencyCents = (value: number) => Math.round(value * 100);

const repairMinorDocumentRounding = (
  analysis: AccountingDocumentAnalysis
) => {
  if (
    analysis.documentType === "bank_statement" ||
    analysis.documentType === "tax_account_statement"
  ) {
    return;
  }

  analysis.entries.forEach((entry) => {
    const debitCents = entry.accounts.reduce(
      (sum, line) => sum + toCurrencyCents(line.debit),
      0
    );
    const creditCents = entry.accounts.reduce(
      (sum, line) => sum + toCurrencyCents(line.credit),
      0
    );
    const imbalanceCents = debitCents - creditCents;

    if (
      imbalanceCents === 0 ||
      Math.abs(imbalanceCents) > 100 ||
      entry.accounts.length >= 12 ||
      entry.accounts.some((line) => line.account === "3740")
    ) {
      return;
    }

    const roundingAmount = Math.abs(imbalanceCents) / 100;
    entry.accounts.push({
      account: "3740",
      debit: imbalanceCents < 0 ? roundingAmount : 0,
      credit: imbalanceCents > 0 ? roundingAmount : 0,
    });
    entry.warnings = Array.from(
      new Set([
        ...entry.warnings,
        `Underlagets delbelopp avviker med ${roundingAmount.toLocaleString(
          "sv-SE",
          { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        )} kr. En avrundningsrad på konto 3740 har lagts till; kontrollera underlaget.`,
      ])
    );
    entry.confidence = Math.min(entry.confidence, 0.8);
  });
};

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

const assertBankStatementAccountPattern = (
  entry: AccountingEntry,
  entryIndex: number
) => {
  const bankAccountBySource = {
    business_bank: "1930",
    private_bank: "2018",
  } as const;
  const expectedAccount =
    entry.sourceAccount === "business_bank" ||
    entry.sourceAccount === "private_bank"
      ? bankAccountBySource[entry.sourceAccount]
      : null;
  const fail = (message: string): never => {
    throw new Error(`Entry ${entryIndex + 1} ${message}`);
  };

  if (entry.sourceAccount !== "unknown" && !expectedAccount) {
    fail(`has invalid source account ${entry.sourceAccount} for a bank statement`);
  }

  if (!expectedAccount) return;

  const statementLine = entry.accounts.find(
    (line) => line.account === expectedAccount
  );
  if (!statementLine) {
    throw new Error(
      `Entry ${entryIndex + 1} identifies ${entry.sourceAccount} but does not use account ${expectedAccount}`
    );
  }

  if (entry.total > 0 && statementLine.debit <= 0) {
    fail(`has a positive amount that does not debit account ${expectedAccount}`);
  }
  if (entry.total < 0 && statementLine.credit <= 0) {
    fail(`has a negative amount that does not credit account ${expectedAccount}`);
  }
};

export const validateAccountingAnalysis = (
  analysis: AccountingDocumentAnalysis
) => {
  repairMinorDocumentRounding(analysis);

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

      if (!configuredAccountingAccountNumbers.has(Number(line.account))) {
        throw new Error(
          `Entry ${entryIndex + 1} uses account ${line.account}, which is not configured in the app`
        );
      }

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

    if (analysis.documentType === "bank_statement") {
      assertBankStatementAccountPattern(entry, entryIndex);
    }

    if (
      analysis.documentType === "sales_invoice" &&
      !entry.accounts.some((line) => line.account === "3001")
    ) {
      throw new Error(
        `Entry ${entryIndex + 1} does not use the configured sales account 3001`
      );
    }

    const roundedTotal = roundCurrency(Math.abs(entry.total));
    const hasRoundingAccount = entry.accounts.some(
      (line) => line.account === "3740"
    );
    const hasPermittedRoundingDifference =
      hasRoundingAccount && Math.abs(roundedTotal - debitTotal) <= 1;
    if (
      Math.abs(entry.total) !== roundedTotal ||
      (roundedTotal !== debitTotal && !hasPermittedRoundingDifference)
    ) {
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
    max_output_tokens: 32_000,
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
