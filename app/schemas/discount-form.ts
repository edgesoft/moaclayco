import { z } from "zod";

const expireAtSchema = z.preprocess(
  (input) => (input === "" ? "EMPTY" : input),
  z.union([
    z.literal("EMPTY").transform(() => ""),
    z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
        "Formatet måste vara ÅÅÅÅ-MM-DD TT:mm"
      ),
  ])
);

export const formSchema = z.object({
  code: z.string().trim().min(1, "Ange en rabattkod."),
  percentage: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? value : parsed;
  }, z.number({ invalid_type_error: "Ange rabatten i procent." }).min(1, "Rabatten måste vara minst 1 %.").max(100, "Rabatten kan inte vara mer än 100 %.")),
  balance: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? value : parsed;
  }, z.number({ invalid_type_error: "Ange hur många gånger koden får användas." }).int("Antalet måste vara ett heltal.").min(0, "Antalet kan inte vara mindre än 0.")),
  expireAt: expireAtSchema,
});
