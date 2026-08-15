import { data as json, type LoaderFunction } from "react-router";
import { Collections } from "~/schemas/collections";
import { Items } from "~/schemas/items";
import { Orders } from "~/schemas/orders";
import { auth } from "~/services/auth.server";
import { activeCatalogItemFilter } from "~/utils/catalogItems.server";
import { activeCatalogCollectionFilter } from "~/utils/catalogCollections.server";
import { toLoaderData } from "~/utils/loaderData";

export type CollectionRemovalPlanData = {
  alternatives: Array<{
    _id: string;
    headline: string;
    image: string;
    itemCount: number;
    shortUrl: string;
  }>;
  collection: {
    headline: string;
    shortUrl: string;
  };
  items: Array<{
    _id: string;
    activeOrderCount: number;
    amount: number;
    headline: string;
    image: string;
    orderCount: number;
    price: number;
  }>;
};

export const loader: LoaderFunction = async ({ params, request }) => {
  await auth.isAuthenticated(request, { failureRedirect: "/login" });
  const collectionRef = params.collection;
  if (!collectionRef) {
    throw new Response("Collection saknas", { status: 404 });
  }

  const [collection, items, alternatives] = await Promise.all([
    Collections.findOne({
      ...activeCatalogCollectionFilter,
      shortUrl: collectionRef,
    })
      .select("headline shortUrl")
      .lean<{ headline?: string; shortUrl?: string }>(),
    Items.find({
      ...activeCatalogItemFilter,
      collectionRef,
    })
      .select("headline images amount price")
      .sort({ _id: -1 })
      .lean<Array<{
        _id: unknown;
        amount?: number;
        headline?: string;
        images?: string[];
        price?: number;
      }>>(),
    Collections.find({
      ...activeCatalogCollectionFilter,
      shortUrl: { $ne: collectionRef },
    })
      .select("headline image shortUrl sortOrder")
      .sort({ sortOrder: 1, _id: 1 })
      .lean<Array<{
        _id: unknown;
        headline?: string;
        image?: string;
        shortUrl?: string;
      }>>(),
  ]);

  if (!collection?.shortUrl) {
    throw new Response("Collection kunde inte hittas", { status: 404 });
  }

  const itemIds = items.map((item) => String(item._id));
  const alternativeRefs = alternatives.flatMap((alternative) =>
    alternative.shortUrl ? [alternative.shortUrl] : []
  );
  const [orders, itemCounts] = await Promise.all([
    itemIds.length
      ? Orders.find({ "items.itemRef": { $in: itemIds } })
          .select("items.itemRef status")
          .lean<Array<{
            items?: Array<{ itemRef?: string }>;
            status?: string;
          }>>()
      : [],
    alternativeRefs.length
      ? Items.aggregate<{ _id: string; count: number }>([
          {
            $match: {
              ...activeCatalogItemFilter,
              collectionRef: { $in: alternativeRefs },
            },
          },
          { $group: { _id: "$collectionRef", count: { $sum: 1 } } },
        ])
      : [],
  ]);

  const orderCounts = new Map<string, number>();
  const activeOrderCounts = new Map<string, number>();
  const itemIdSet = new Set(itemIds);
  orders.forEach((order) => {
    const refsInOrder = new Set(
      (order.items ?? [])
        .map((item) => String(item.itemRef ?? ""))
        .filter((itemRef) => itemIdSet.has(itemRef))
    );
    refsInOrder.forEach((itemRef) => {
      orderCounts.set(itemRef, (orderCounts.get(itemRef) ?? 0) + 1);
      if (order.status === "OPENED" || order.status === "PENDING") {
        activeOrderCounts.set(
          itemRef,
          (activeOrderCounts.get(itemRef) ?? 0) + 1
        );
      }
    });
  });
  const countByCollection = new Map(
    itemCounts.map((count) => [String(count._id), Number(count.count)])
  );

  return json(
    toLoaderData({
      alternatives: alternatives.flatMap((alternative) =>
        alternative.shortUrl
          ? [
              {
                _id: String(alternative._id),
                headline: alternative.headline ?? "Collection",
                image: alternative.image ?? "",
                itemCount: countByCollection.get(alternative.shortUrl) ?? 0,
                shortUrl: alternative.shortUrl,
              },
            ]
          : []
      ),
      collection: {
        headline: collection.headline ?? "Collection",
        shortUrl: collection.shortUrl,
      },
      items: items.map((item) => {
        const itemId = String(item._id);
        return {
          _id: itemId,
          activeOrderCount: activeOrderCounts.get(itemId) ?? 0,
          amount: Number(item.amount ?? 0),
          headline: item.headline ?? "Produkt",
          image: item.images?.find(Boolean) ?? "",
          orderCount: orderCounts.get(itemId) ?? 0,
          price: Number(item.price ?? 0),
        };
      }),
    } satisfies CollectionRemovalPlanData),
    { headers: { "Cache-Control": "private, no-store" } }
  );
};
