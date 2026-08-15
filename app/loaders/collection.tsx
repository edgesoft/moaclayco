import { data as json, redirect } from "react-router";
import type { LoaderFunction } from "react-router";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";
import { auth } from "~/services/auth.server";
import { toLoaderData } from "~/utils/loaderData";
import { collectionEditorProjection } from "~/utils/queryProjections.server";
import { activeCatalogItemFilter } from "~/utils/catalogItems.server";
import { activeCatalogCollectionFilter } from "~/utils/catalogCollections.server";

export const CollectionLoader: LoaderFunction = async ({ params, request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });

  if (!params.collection) {
    return json({ collection: null, itemCount: 0 });
  }

  const [collection, itemCount] = await Promise.all([
    Collections.findOne({
      ...activeCatalogCollectionFilter,
      shortUrl: params.collection,
    })
      .select(collectionEditorProjection)
      .lean()
      .exec(),
    Items.countDocuments({
      ...activeCatalogItemFilter,
      collectionRef: params.collection,
    }),
  ]);
  if (!collection) return redirect("/");

  return json({
    collection: toLoaderData(collection),
    itemCount,
  });
};
