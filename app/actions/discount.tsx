import {
  ActionFunction, json,
  redirect
} from "@remix-run/node";
import { Discounts as DiscountEntity } from "../schemas/discounts";
import { z } from "zod";
import { getDomain } from "~/utils/domain";
import { auth } from "~/services/auth.server";
import { parseStockholmDateTime } from "~/utils/accountingDates";

const objectFromFormData = (formData: FormData) => {
  const obj: { [key: string]: string | File } = {};
  for (let [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      obj[key] = value;
    } else {
      obj[key] = value as File;
    }
  }
  return obj;
};

const expireAtSchema = z.preprocess((input) => {
  if (input === "") {
    return "EMPTY";
  }
  return input;
}, z.union([z.literal("EMPTY").transform(() => ""), z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, "Formatet måste vara ÅÅÅÅ-MM-DD TT:mm")]));

export const formSchema = z.object({
  code: z.string().trim().min(1, "Ange en rabattkod."),
  percentage: z.preprocess((val) => {
    if (typeof val === "string") {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? val : parsed;
    }
    return val;
  }, z.number({ invalid_type_error: "Ange rabatten i procent." }).min(1, "Rabatten måste vara minst 1 %.").max(100, "Rabatten kan inte vara mer än 100 %.")),
  balance: z.preprocess((val) => {
    if (typeof val === "string") {
      const parsed = parseInt(val, 10);
      return isNaN(parsed) ? val : parsed;
    }
    return val;
  }, z.number({ invalid_type_error: "Ange hur många gånger koden får användas." }).int("Antalet måste vara ett heltal.").min(0, "Antalet kan inte vara mindre än 0.")),
  expireAt: expireAtSchema,
});

let action: ActionFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  let formData = await request.formData();
  let action = formData.get("action");
  const domain = getDomain(request)

  switch (action) {
    case "save":
      const formObject = objectFromFormData(formData);
      const validation = formSchema.safeParse(formObject);
      if (!validation.success) {
        const errors = Object.fromEntries(
          Object.entries(validation.error.flatten().fieldErrors).map(([key, messages]) => [
            key,
            messages?.[0],
          ])
        );
        return json({ errors }, { status: 400 });
      }
      const result = validation.data;
      const expireAt = result.expireAt
        ? parseStockholmDateTime(result.expireAt)
        : null;
      if (result.expireAt && !expireAt) {
        return json(
          { errors: { expireAt: "Sluttiden är inte giltig i svensk tid" } },
          { status: 400 }
        );
      }
      const discountData = { ...result, expireAt };
      const obj: any = await DiscountEntity.findOne({ domain: domain?.domain, code: result.code }).lean();

      if (params.id) {
        if (obj) {
          if (obj._id.toString() !== params.id) {
            return json(
              { error: `Koden ${result.code} finns redan` },
              { status: 400 }
            );
          }
        }

        await DiscountEntity.updateOne(
          { _id: params.id, domain: domain?.domain },
          {
            ...discountData,
            domain: domain?.domain
          }
        );
      } else {
        if (obj) {
          return json(
            { error: `Koden ${result.code} finns redan` },
            { status: 400 }
          );
          
        }

        await DiscountEntity.create({...discountData, domain: domain?.domain});
      }

      break;
    case "delete":
      await DiscountEntity.deleteOne({ _id: params.id, domain: domain?.domain });
      break;
    default:
      throw new Error(`Ogiltig åtgärd: ${action}`);
  }

  return redirect("/admin/discounts");
};

export const DiscountAction = action;
