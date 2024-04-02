import {
  ActionFunction,
  LoaderFunction,
  json,
  redirect,
} from "@remix-run/node";
import { Discounts as DiscountEntity } from "../schemas/discounts";
import {
  Outlet,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from "@remix-run/react";
import React, { useEffect } from "react";
import { auth } from "~/services/auth.server";
import { classNames } from "~/utils/classnames";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "react-toastify";
import { formatDateToUTC } from "~/utils/formatDateToUTC";
import { DiscountType } from "~/types";
import { IndexProps } from "~/root";

const objectFromFormData = (formData) => {
  const obj = {};
  for (let [key, value] of formData.entries()) {
    obj[key] = value;
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

  switch (action) {
    case "save":
      const formObject = objectFromFormData(formData);
      const result = formSchema.parse(formObject); // Validerar och omvandlar datatyp där det behövs
      const obj = await DiscountEntity.findOne({ code: result.code }).lean();

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
          }
        );
      } else {
        if (obj) {
          return json(
            { error: `Koden ${result.code} finns redan` },
            { status: 400 }
          );
        }

        await DiscountEntity.create(result);
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
