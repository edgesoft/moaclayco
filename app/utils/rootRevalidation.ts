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
  if (formMethod && formMethod.toUpperCase() !== "GET") {
    return defaultShouldRevalidate;
  }

  const usesStableRootData = (pathname: string) =>
    pathname === "/" ||
    pathname.startsWith("/collections/") ||
    pathname.startsWith("/items/") ||
    pathname.startsWith("/admin/verifications") ||
    pathname.startsWith("/admin/orders") ||
    pathname.startsWith("/admin/discounts");

  return usesStableRootData(currentPathname) && usesStableRootData(nextPathname)
    ? false
    : defaultShouldRevalidate;
}
