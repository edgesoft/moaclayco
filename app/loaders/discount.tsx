import { LoaderFunction } from "react-router";
import { Discounts as DiscountEntity } from "../schemas/discounts";
import { auth } from "~/services/auth.server";
import { toLoaderData } from "~/utils/loaderData";
import { discountProjection } from "~/utils/queryProjections.server";

let loader: LoaderFunction = async ({ request, params }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  return toLoaderData(
    await DiscountEntity.findOne({
      _id: params.id,
    })
      .select(discountProjection)
      .lean()
      .exec()
  );
};

export const DiscountLoader = loader;
