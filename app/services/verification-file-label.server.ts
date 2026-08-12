import { zodTextFormat } from "openai/helpers/zod";
import type { Responses } from "openai/resources/responses/responses";
import { z } from "zod";
import { getOpenAIClient } from "~/services/openapi.server";
import { sanitizeVerificationFileLabel } from "~/utils/verificationFiles";

export const verificationFileLabelSchema = z.object({
  label: z.string().min(3).max(120),
  documentType: z.enum([
    "receipt",
    "supplier_invoice",
    "sales_invoice",
    "tax_account_statement",
    "vat_return",
    "bank_statement",
    "payment_confirmation",
    "other",
  ]),
  summary: z.string().min(1).max(220),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()).max(3),
});

export type VerificationFileLabelSuggestion = z.infer<
  typeof verificationFileLabelSchema
>;

const FILE_LABEL_INSTRUCTIONS = `
Du namnger bilagor i en svensk bokföringsapp. Läs hela dokumentet och identifiera
vad det faktiskt är. Skriv på svenska.

Regler för label:
- 3–120 tecken, utan filändelse, tidsstämpel eller tekniskt filnamn.
- Beskriv dokumenttypen och den viktigaste avsändaren, leverantören eller perioden.
- Ta med faktura-, kvitto- eller referensnummer endast om det hjälper användaren.
- För Skatteverkets dokument: skilj på skattekontoutdrag, momsdeklaration,
  kvittens och betalningsbekräftelse.
- För kontoutdrag: ta med bank och redovisningsperiod om de syns.
- Hitta inte på uppgifter. Använd en enkel generell label och varning om innehållet
  är otydligt.

summary ska i en kort mening beskriva varför dokumentet hör hemma i bokföringen.
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

export const suggestVerificationFileLabel = async ({
  buffer,
  mimeType,
  fileName,
  model = process.env.OPENAI_FILE_LABEL_MODEL ??
    process.env.OPENAI_ACCOUNTING_MODEL ??
    "gpt-5.6-terra",
}: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  model?: string;
}) => {
  const openai = getOpenAIClient();
  const documentInput = createDocumentInput({ buffer, mimeType, fileName });
  const inferenceOptions = model.startsWith("gpt-5")
    ? { reasoning: { effort: "low" as const } }
    : { temperature: 0 };

  const response = await openai.responses.parse({
    model,
    instructions: FILE_LABEL_INSTRUCTIONS,
    input: [
      {
        role: "user",
        content: [
          documentInput,
          {
            type: "input_text",
            text: "Identifiera dokumentet och föreslå ett tydligt namn för bilagan.",
          },
        ],
      },
    ],
    ...inferenceOptions,
    max_output_tokens: 900,
    store: false,
    text: {
      format: zodTextFormat(
        verificationFileLabelSchema,
        "verification_file_label"
      ),
    },
  });

  if (!response.output_parsed) {
    throw new Error("The file-label model returned no structured result");
  }

  return {
    ...response.output_parsed,
    label: sanitizeVerificationFileLabel(response.output_parsed.label),
  };
};
