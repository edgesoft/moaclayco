import { z } from "zod";

const expireAtSchema = z.string().refine(
  (value) => value === "" || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value),
  "Formatet måste vara ÅÅÅÅ-MM-DD TT:mm"
);

export const formSchema = z.object({
  code: z.string().trim().min(1, "Ange en rabattkod."),
  percentage: z
    .number({ error: "Ange rabatten i procent." })
    .min(1, "Rabatten måste vara minst 1 %.")
    .max(100, "Rabatten kan inte vara mer än 100 %."),
  balance: z
    .number({ error: "Ange hur många gånger koden får användas." })
    .int("Antalet måste vara ett heltal.")
    .min(0, "Antalet kan inte vara mindre än 0."),
  expireAt: expireAtSchema,
});
