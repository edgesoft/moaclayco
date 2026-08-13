import type Stripe from "stripe";

export const STRIPE_CURRENT_WEBHOOK_API_VERSION = "2020-08-27" as const;
export const STRIPE_LEGACY_API_VERSION = "2023-08-16" as const;
export const STRIPE_TARGET_API_VERSION =
  "2026-07-29.dahlia" satisfies Stripe.LatestApiVersion;
export const STRIPE_WEBHOOK_VERSION_PARAMETER = "stripe_api_version";

export type SupportedStripeRequestApiVersion =
  | typeof STRIPE_LEGACY_API_VERSION
  | typeof STRIPE_TARGET_API_VERSION;

export type SupportedStripeWebhookApiVersion =
  | typeof STRIPE_CURRENT_WEBHOOK_API_VERSION
  | SupportedStripeRequestApiVersion;

const supportedStripeRequestApiVersions = new Set<string>([
  STRIPE_LEGACY_API_VERSION,
  STRIPE_TARGET_API_VERSION,
]);

const supportedStripeWebhookApiVersions = new Set<string>([
  STRIPE_CURRENT_WEBHOOK_API_VERSION,
  ...supportedStripeRequestApiVersions,
]);

export const parseStripeRequestApiVersion = (
  value: string
): SupportedStripeRequestApiVersion => {
  const normalized = value.trim();
  if (supportedStripeRequestApiVersions.has(normalized)) {
    return normalized as SupportedStripeRequestApiVersion;
  }

  throw new Error(
    `Unsupported Stripe request API version: ${normalized || "(empty)"}`
  );
};

export const parseStripeWebhookApiVersion = (
  value: string
): SupportedStripeWebhookApiVersion => {
  const normalized = value.trim();
  if (supportedStripeWebhookApiVersions.has(normalized)) {
    return normalized as SupportedStripeWebhookApiVersion;
  }

  throw new Error(
    `Unsupported Stripe webhook API version: ${normalized || "(empty)"}`
  );
};

export const getConfiguredStripeApiVersion = (
  environment: NodeJS.ProcessEnv = process.env
): SupportedStripeRequestApiVersion => {
  const configured = environment.STRIPE_API_VERSION?.trim();
  return configured
    ? parseStripeRequestApiVersion(configured)
    : STRIPE_LEGACY_API_VERSION;
};

export const getActiveStripeWebhookApiVersion = (
  environment: NodeJS.ProcessEnv = process.env
): SupportedStripeWebhookApiVersion => {
  const configured = environment.STRIPE_WEBHOOK_ACTIVE_VERSION?.trim();
  return configured
    ? parseStripeWebhookApiVersion(configured)
    : getConfiguredStripeApiVersion(environment);
};

export const getRequestedStripeWebhookApiVersion = (
  request: Request,
  environment: NodeJS.ProcessEnv = process.env
): SupportedStripeWebhookApiVersion => {
  const url = new URL(request.url);
  if (!url.searchParams.has(STRIPE_WEBHOOK_VERSION_PARAMETER)) {
    return getActiveStripeWebhookApiVersion(environment);
  }

  return parseStripeWebhookApiVersion(
    url.searchParams.get(STRIPE_WEBHOOK_VERSION_PARAMETER) ?? ""
  );
};

export const getStripeWebhookSecret = (
  apiVersion: SupportedStripeWebhookApiVersion,
  environment: NodeJS.ProcessEnv = process.env
) => {
  const versionSpecificSecret =
    apiVersion === STRIPE_TARGET_API_VERSION
      ? environment.STRIPE_WEBHOOK_DAHLIA
      : environment.STRIPE_WEBHOOK_LEGACY;

  return (
    versionSpecificSecret?.trim() || environment.STRIPE_WEBHOOK?.trim() || ""
  );
};

export const toStripeSdkApiVersion = (
  apiVersion: SupportedStripeRequestApiVersion
): Stripe.LatestApiVersion =>
  // During the rollout production can intentionally remain on the legacy API.
  // Remove this compatibility boundary when every environment uses Dahlia.
  apiVersion as Stripe.LatestApiVersion;
