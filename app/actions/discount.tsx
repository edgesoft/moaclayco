import {
  ActionFunction, json,
  redirect
} from "@remix-run/node";
import { Discounts as DiscountEntity } from "../schemas/discounts";
import { z } from "zod";
import { getDomain } from "~/utils/domain";

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
  code: z.string().min(1, "Code måste vara minst 1 tecken"),
  percentage: z.preprocess((val) => {
    if (typeof val === "string") {
      const parsed = parseFloat(val);
      return isNaN(parsed) ? val : parsed;
    }
    return val;
  }, z.number().min(1, "Discount måste vara minst 1%").max(100, "Discount kan inte vara mer än 100%")),
  balance: z.preprocess((val) => {
    if (typeof val === "string") {
      const parsed = parseInt(val, 10);
      return isNaN(parsed) ? val : parsed;
    }
    return val;
  }, z.number().min(1, "Balance måste vara minst 1")),
  expireAt: expireAtSchema,
});

let action: ActionFunction = async ({ request, params }) => {
  let formData = await request.formData();
  let action = formData.get("action");
  const domain = getDomain(request)

  switch (action) {
    case "save":
      const formObject = objectFromFormData(formData);
      const result = formSchema.parse(formObject); // Validerar och omvandlar datatyp där det behövs
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
          { _id: params.id },
          {
            ...result,
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

        await DiscountEntity.create({...result, domain: domain?.domain});
      }

      break;
    case "delete":
      await DiscountEntity.deleteOne({ _id: params.id });
      break;
    default:
      throw new Error(`Ogiltig åtgärd: ${action}`);
  }

  return redirect("/admin/discounts");
};

export const DiscountAction = action;
