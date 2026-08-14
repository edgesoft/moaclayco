const DEFAULT_ASSET_ORIGIN = "https://38vabcm3.twic.pics";

export const assetUrlFromKey = (key: string) => {
  const origin = process.env.ASSET_ORIGIN?.trim() || DEFAULT_ASSET_ORIGIN;
  const url = new URL(origin);
  url.pathname = `/${key.replace(/^\/+/, "")}`;
  url.search = "";
  url.hash = "";
  return url.toString();
};
