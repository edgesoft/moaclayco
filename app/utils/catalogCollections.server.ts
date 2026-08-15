export const activeCatalogCollectionFilter = {
  catalogStatus: { $ne: "deleted" },
} as const;
