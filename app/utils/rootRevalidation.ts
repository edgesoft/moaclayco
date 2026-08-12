export function shouldRevalidateRoot({
  currentPathname,
  defaultShouldRevalidate,
  formMethod,
  nextPathname,
}: {
  currentPathname: string;
  defaultShouldRevalidate: boolean;
  formMethod?: string;
  nextPathname: string;
}) {
  if (formMethod && formMethod !== "GET") return defaultShouldRevalidate;

  const staysInAccounting =
    currentPathname.startsWith("/admin/verifications") &&
    nextPathname.startsWith("/admin/verifications");

  const isCatalogPath = (pathname: string) =>
    pathname === "/" ||
    pathname.startsWith("/collections/") ||
    pathname.startsWith("/items/");
  const staysInCatalog =
    isCatalogPath(currentPathname) && isCatalogPath(nextPathname);

  return staysInAccounting || staysInCatalog
    ? false
    : defaultShouldRevalidate;
}
