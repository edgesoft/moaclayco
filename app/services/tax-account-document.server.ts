import { zodTextFormat } from "openai/helpers/zod";
import type { Responses } from "openai/resources/responses/responses";
import { z } from "zod";
import { getOpenAIClient } from "~/services/openapi.server";
import { assignTaxAccountRowIds } from "~/utils/taxAccountReconciliation";

const taxAccountTransactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  amount: z.number(),
  balanceAfter: z.number().nullable(),
  sourceReference: z.string(),
});

export const taxAccountStatementSchema = z.object({
  documentType: z.literal("tax_account_statement"),
  accountHolder: z.string(),
  organizationNumber: z.string(),
  accountNumber: z.string(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  openingBalance: z.number(),
  closingBalance: z.number(),
  transactions: z.array(taxAccountTransactionSchema).min(1).max(250),
  warnings: z.array(z.string()),
});

export type TaxAccountStatementAnalysis = z.infer<
  typeof taxAccountStatementSchema
>;

const TAX_ACCOUNT_INSTRUCTIONS = `
Du läser ett svenskt kontoutdrag från Skatteverkets skattekonto för en enskild
firma. Läs hela PDF-filen, alla sidor och varje tabellrad.

Returnera dokumentets kontohavare, organisationsnummer, skattekontonummer,
period, ingående saldo, utgående saldo och samtliga verkliga transaktioner i
källans ordning.

Regler:
- Datum ska vara YYYY-MM-DD.
- amount ska bevara källans tecken: insättningar och ränta är positiva;
  skatter, moms och utbetalningar är negativa.
- balanceAfter är saldot som står på samma transaktionsrad. Använd null endast
  om raden verkligen saknar saldo.
- Ingående saldo och utgående saldo är kontrollsummor, inte transaktioner.
- En rad "Inbetalning bokförd" och en senare rad "Moms ..." är två separata
  transaktioner. Slå aldrig ihop rader.
- Behåll även identiska transaktioner samma datum som separata rader.
- description ska ligga nära Skatteverkets radtext och inte innehålla en
  föreslagen bokföringskontering.
- sourceReference ska innehålla källans referens eller annan särskiljande text.
  Om ingen separat referens finns, använd den ursprungliga radtexten.
- Gissa aldrig från vilket bankkonto en inbetalning kom. Det valet görs senare.
- Alla belopp är SEK.
`;

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
const cents = (value: number) => Math.round(Number(value) * 100);

const isRealDate = (value: string) => {
  const date = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const validateTaxAccountStatement = (
  statement: TaxAccountStatementAnalysis
) => {
  if (
    !isRealDate(statement.periodStart) ||
    !isRealDate(statement.periodEnd) ||
    statement.periodStart > statement.periodEnd
  ) {
    throw new Error("Skattekontoutdraget har en ogiltig period");
  }

  let runningBalance = cents(statement.openingBalance);
  statement.transactions.forEach((transaction, index) => {
    if (!isRealDate(transaction.date)) {
      throw new Error(`Skattekontorad ${index + 1} har ett ogiltigt datum`);
    }
    if (transaction.date < statement.periodStart || transaction.date > statement.periodEnd) {
      throw new Error(`Skattekontorad ${index + 1} ligger utanför utdragets period`);
    }
    if (!Number.isFinite(transaction.amount) || transaction.amount === 0) {
      throw new Error(`Skattekontorad ${index + 1} har ett ogiltigt belopp`);
    }
    runningBalance += cents(transaction.amount);
    if (
      transaction.balanceAfter !== null &&
      runningBalance !== cents(transaction.balanceAfter)
    ) {
      throw new Error(`Saldot på skattekontorad ${index + 1} stämmer inte`);
    }
  });

  if (runningBalance !== cents(statement.closingBalance)) {
    throw new Error("Skattekontoutdragets ingående saldo, transaktioner och slutsaldo stämmer inte");
  }
  return statement;
};

export const interpretTaxAccountStatement = async ({
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
    instructions: TAX_ACCOUNT_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          documentInput,
          {
            type: "input_text",
            text: "Läs skattekontoutdraget och returnera hela saldokedjan och alla transaktionsrader.",
          },
        ],
      },
    ],
    ...inferenceOptions,
    max_output_tokens: 12_000,
    store: false,
    text: {
      format: zodTextFormat(taxAccountStatementSchema, "tax_account_statement"),
    },
  });

  if (!response.output_parsed) {
    throw new Error("Bokföringsmodellen returnerade inget strukturerat skattekontoutdrag");
  }

  const statement = validateTaxAccountStatement(response.output_parsed);
  return {
    ...statement,
    transactions: assignTaxAccountRowIds(statement.transactions),
  };
};
