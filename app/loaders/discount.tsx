import { LoaderFunction } from "@remix-run/node";
import { Discounts as DiscountEntity } from "../schemas/discounts";
import { auth } from "~/services/auth.server";
import { getDomain } from "~/utils/domain";

let loader: LoaderFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const domain = getDomain(request);
  return await DiscountEntity.findOne({
    _id: params.id,
    domain: domain?.domain,
  });
};

export const DiscountLoader = loader;
