import {
  ActionFunction, data as json,
  redirect
} from "react-router";
import { Discounts as DiscountEntity } from "../schemas/discounts";
import { getDomain } from "~/utils/domain";
import { auth } from "~/services/auth.server";
import { parseStockholmDateTime } from "~/utils/accountingDates";
import { formSchema } from "~/schemas/discount-form";
import {
  MAX_STANDARD_FORM_REQUEST_SIZE,
  parseFormDataWithinLimit,
  RequestBodyTooLargeError,
} from "~/utils/requestBody.server";

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

let action: ActionFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  let formData: FormData;
  try {
    formData = await parseFormDataWithinLimit(
      request,
      MAX_STANDARD_FORM_REQUEST_SIZE
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json(
        { errors: { form: "Formuläret är för stort" } },
        { status: 413 }
      );
    }
    throw error;
  }
  let action = formData.get("action");
  const domain = getDomain(request)

  switch (action) {
    case "save": {
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
    }
    case "delete": {
      await DiscountEntity.deleteOne({ _id: params.id, domain: domain?.domain });
      break;
    }
    default:
      throw new Error(`Ogiltig åtgärd: ${action}`);
  }

  return redirect("/admin/discounts");
};

export const DiscountAction = action;
