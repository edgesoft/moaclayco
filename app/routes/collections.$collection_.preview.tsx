import type { LoaderFunction } from "react-router";
import { data as json } from "react-router";
import { Items } from "~/schemas/items";
import {
  catalogCacheKeys,
  readCatalogCache,
} from "~/services/catalog-cache.server";
import { toLoaderData } from "~/utils/loaderData";
import { activeCatalogItemFilter } from "~/utils/catalogItems.server";

export type CollectionPreviewItem = {
  _id: string;
  amount: number;
  headline: string;
  image: string;
};

export type CollectionPreviewData = {
  collectionRef: string;
  items: CollectionPreviewItem[];
};

export const loader: LoaderFunction = async ({ params }) => {
  const collectionRef = params.collection;
  if (!collectionRef) {
    throw new Response("Collection saknas", { status: 404 });
  }

  const items = await readCatalogCache(
    catalogCacheKeys.collectionPreview(collectionRef),
    async () => {
      const collectionItems = await Items.find({
        ...activeCatalogItemFilter,
        collectionRef,
      })
        .select("headline images amount")
        .sort({ _id: -1 })
        .lean()
        .exec();

      return toLoaderData(collectionItems).flatMap((item) => {
        const image = item.images?.find(
          (candidate: unknown): candidate is string =>
            typeof candidate === "string" && candidate.trim().length > 0
        );

        if (!image) return [];

        return [
          {
            _id: String(item._id),
            amount: Number(item.amount ?? 0),
            headline: String(item.headline ?? "Produkt"),
            image,
          },
        ];
      });
    }
  );

  return json(
    { collectionRef, items } satisfies CollectionPreviewData,
    { headers: { "Cache-Control": "private, no-store" } }
  );
};
