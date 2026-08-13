import { LoaderFunction } from "react-router";
import { Discounts as DiscountEntity } from "../schemas/discounts";
import { auth } from "~/services/auth.server";
import { getDomain } from "~/utils/domain";
import { toLoaderData } from "~/utils/loaderData";
import { discountProjection } from "~/utils/queryProjections.server";

let loader: LoaderFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const domain = getDomain(request);
  return toLoaderData(
    await DiscountEntity.findOne({
      _id: params.id,
      domain: domain?.domain,
    })
      .select(discountProjection)
      .lean()
      .exec()
  );
};

export const DiscountLoader = loader;
