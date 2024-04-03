import { LoaderFunction } from "@remix-run/node";
import { Discounts as DiscountEntity } from "../schemas/discounts";
import { auth } from "~/services/auth.server";

let loader: LoaderFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });

  return await DiscountEntity.findOne({ _id: params.id });
};

export const DiscountLoader = loader;
