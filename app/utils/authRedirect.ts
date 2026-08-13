export const DEFAULT_AUTHENTICATED_REDIRECT = "/";

const AUTHENTICATION_PATHS = new Set([
  "/login",
  "/auth/google",
  "/auth/google/callback",
]);
const RETURN_TO_BASE_URL = "https://moaclayco.invalid";

export const getSafeAuthenticationReturnTo = (
  value: string | null | undefined,
  fallback = DEFAULT_AUTHENTICATED_REDIRECT
) => {
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;

  try {
    const url = new URL(value, RETURN_TO_BASE_URL);
    if (
      url.origin !== RETURN_TO_BASE_URL ||
      AUTHENTICATION_PATHS.has(url.pathname)
    ) {
      return fallback;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
};

export const getGoogleAuthenticationPath = (returnTo: string) => {
  const search = new URLSearchParams({
    returnTo: getSafeAuthenticationReturnTo(returnTo),
  });
  return `/auth/google?${search.toString()}`;
};

export const getLoginPath = ({
  error,
  returnTo,
}: {
  error?: string;
  returnTo: string;
}) => {
  const search = new URLSearchParams({
    returnTo: getSafeAuthenticationReturnTo(returnTo),
  });
  if (error) search.set("error", error);
  return `/login?${search.toString()}`;
};
