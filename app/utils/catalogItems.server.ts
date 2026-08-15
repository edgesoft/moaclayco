export const activeCatalogItemFilter = {
  catalogStatus: { $ne: "retired" },
} as const;
