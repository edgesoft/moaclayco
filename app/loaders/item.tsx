import {
  LoaderFunction,
  redirect,
} from "react-router";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";
import { Orders } from "~/schemas/orders";
import { auth } from "~/services/auth.server";
import { toLoaderData } from "~/utils/loaderData";
import {
  collectionEditorProjection,
  itemEditorProjection,
} from "~/utils/queryProjections.server";
import { activeCatalogItemFilter } from "~/utils/catalogItems.server";
import { activeCatalogCollectionFilter } from "~/utils/catalogCollections.server";

 const loader: LoaderFunction = async ({ params, request }) => {
    await auth.isAuthenticated(request, { failureRedirect: "/login" });
    const [collection, item, availableCollections] = await Promise.all([
      Collections.findOne({
        ...activeCatalogCollectionFilter,
        shortUrl: params.collection,
      })
        .select(collectionEditorProjection)
        .lean()
        .exec(),
      params.id
        ? Items.findOne({
            ...activeCatalogItemFilter,
            _id: params.id,
            collectionRef: params.collection,
          })
            .select(itemEditorProjection)
            .lean()
            .exec()
        : null,
      Collections.find(activeCatalogCollectionFilter)
        .select(collectionEditorProjection)
        .sort({ sortOrder: 1, _id: 1 })
        .lean()
        .exec(),
    ]);
  
    if (!collection) {
      return redirect("/");
    }

    if (params.id && !item) {
      return redirect(`/collections/${params.collection}`);
    }
  
    const [activeOrderCount, orderCount] = item
      ? await Promise.all([
          Orders.countDocuments({
            "items.itemRef": String(item._id),
            status: { $in: ["OPENED", "PENDING"] },
          }),
          Orders.countDocuments({
            "items.itemRef": String(item._id),
          }),
        ])
      : [0, 0];

    return toLoaderData({
      collection,
      item,
      availableCollections,
      orderImpact: { activeOrderCount, orderCount },
    });
  };

export const ItemLoader = loader
