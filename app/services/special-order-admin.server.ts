import { Items } from "~/schemas/items";
import { activeCatalogItemFilter } from "~/utils/catalogItems.server";

export const specialOrderSourceImages = (images: string[] | undefined) =>
  Array.from(
    new Set(
      (images ?? [])
        .map((image) => image?.trim())
        .filter((image): image is string => Boolean(image))
    )
  );

export const specialOrderSourceImage = (images: string[] | undefined) =>
  specialOrderSourceImages(images)[0] ?? "";

export const sourceProducts = async () => {
  const items = await Items.find(activeCatalogItemFilter)
    .select("headline price images productInfos longDescription collectionRef")
    .sort({ _id: -1 })
    .limit(100)
    .lean();
  return items.map((item) => {
    const images = specialOrderSourceImages(item.images);

    return {
      _id: String(item._id),
      headline: item.headline ?? "Namnlös produkt",
      image: images[0] ?? "",
      images,
      longDescription: item.longDescription ?? "",
      price: Number(item.price ?? 0),
      productInfos: item.productInfos ?? [],
    };
  });
};

export const publicOriginFrom = (request: Request) => {
  const configuredOrigin = process.env.SPECIAL_ORDER_PUBLIC_ORIGIN?.trim();
  if (configuredOrigin) return new URL(configuredOrigin).origin;
  if (process.env.NODE_ENV === "production") return "https://moaclayco.com";

  const url = new URL(request.url);
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    url.host;
  const protocol =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${protocol}://${host}`;
};
