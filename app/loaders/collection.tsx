import { data as json, redirect } from "react-router";
import type { LoaderFunction } from "react-router";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";
import { auth } from "~/services/auth.server";
import { getDomain } from "~/utils/domain";
import { toLoaderData } from "~/utils/loaderData";

export const CollectionLoader: LoaderFunction = async ({ params, request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const domain = getDomain(request);
  if (!domain) return redirect("/");

  if (!params.collection) {
    return json({ collection: null, itemCount: 0 });
  }

  const collection = await Collections.findOne({
    domain: domain.domain,
    shortUrl: params.collection,
  }).lean();
  if (!collection) return redirect("/");

  return json({
    collection: toLoaderData(collection),
    itemCount: await Items.countDocuments({
      collectionRef: params.collection,
      domain: domain.domain,
    }),
  });
};
