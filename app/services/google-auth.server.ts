import * as oidc from "openid-client";
import { Users } from "~/schemas/user";
import type { User } from "~/types";
import { accountingYear } from "~/utils/accountingDates";
import {
  DEFAULT_AUTHENTICATED_REDIRECT,
  getSafeAuthenticationReturnTo,
} from "~/utils/authRedirect";

const GOOGLE_ISSUER = new URL("https://accounts.google.com");
const DEFAULT_ALLOWED_EMAILS = [
  "moaclayco@gmail.com",
  "moagusen@gmail.com",
  "wicket.programmer@gmail.com",
];

export const GOOGLE_OAUTH_FLOW_SESSION_KEY = "google:oauth-flow";

export type GoogleOauthFlow = {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  state: string;
  createdAt: number;
};

export class GoogleAuthenticationError extends Error {
  code:
    | "configuration"
    | "invalid_flow"
    | "not_allowed"
    | "not_verified"
    | "account_conflict"
    | "provider_error";

  constructor(code: GoogleAuthenticationError["code"], message: string) {
    super(message);
    this.name = "GoogleAuthenticationError";
    this.code = code;
  }
}

let configurationPromise: Promise<oidc.Configuration> | undefined;

const requiredEnvironmentValue = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new GoogleAuthenticationError(
      "configuration",
      `${name} is not configured`
    );
  }
  return value;
};

export const normalizeGoogleEmail = (email: string) =>
  email.trim().toLowerCase();

export const getAllowedGoogleEmails = () => {
  const configuredEmails = process.env.GOOGLE_ALLOWED_EMAILS?.split(",")
    .map(normalizeGoogleEmail)
    .filter(Boolean);

  return new Set([...DEFAULT_ALLOWED_EMAILS, ...(configuredEmails ?? [])]);
};

export const isAllowedGoogleEmail = (email: string) =>
  getAllowedGoogleEmails().has(normalizeGoogleEmail(email));

export const isGoogleAuthenticationConfigured = () =>
  Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      process.env.GOOGLE_CALLBACK_URL?.trim()
  );

export const getGoogleCallbackUrl = () => {
  const callbackUrl = new URL(requiredEnvironmentValue("GOOGLE_CALLBACK_URL"));
  const isLocal = ["localhost", "127.0.0.1"].includes(callbackUrl.hostname);

  if (callbackUrl.protocol !== "https:" && !isLocal) {
    throw new GoogleAuthenticationError(
      "configuration",
      "GOOGLE_CALLBACK_URL must use HTTPS outside localhost"
    );
  }

  if (callbackUrl.pathname !== "/auth/google/callback") {
    throw new GoogleAuthenticationError(
      "configuration",
      "GOOGLE_CALLBACK_URL must end with /auth/google/callback"
    );
  }

  return callbackUrl;
};

const getGoogleConfiguration = () => {
  if (!configurationPromise) {
    configurationPromise = oidc.discovery(
      GOOGLE_ISSUER,
      requiredEnvironmentValue("GOOGLE_CLIENT_ID"),
      requiredEnvironmentValue("GOOGLE_CLIENT_SECRET")
    );
  }

  return configurationPromise;
};

export const getGoogleAuthorizationParameters = ({
  redirectUri,
  codeChallenge,
  state,
  nonce,
}: {
  redirectUri: string;
  codeChallenge: string;
  state: string;
  nonce: string;
}) => ({
  redirect_uri: redirectUri,
  scope: "openid email profile",
  code_challenge: codeChallenge,
  code_challenge_method: "S256" as const,
  state,
  nonce,
  prompt: "select_account" as const,
});

export const createGoogleAuthorization = async (
  returnTo = DEFAULT_AUTHENTICATED_REDIRECT
) => {
  const configuration = await getGoogleConfiguration();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  const url = oidc.buildAuthorizationUrl(
    configuration,
    getGoogleAuthorizationParameters({
      redirectUri: getGoogleCallbackUrl().toString(),
      codeChallenge,
      state,
      nonce,
    })
  );

  return {
    url,
    flow: {
      codeVerifier,
      state,
      nonce,
      returnTo: getSafeAuthenticationReturnTo(returnTo),
      createdAt: Date.now(),
    } satisfies GoogleOauthFlow,
  };
};

export const isGoogleOauthFlow = (value: unknown): value is GoogleOauthFlow => {
  if (!value || typeof value !== "object") return false;
  const flow = value as Partial<GoogleOauthFlow>;

  return (
    typeof flow.codeVerifier === "string" &&
    typeof flow.state === "string" &&
    typeof flow.nonce === "string" &&
    typeof flow.returnTo === "string" &&
    flow.returnTo === getSafeAuthenticationReturnTo(flow.returnTo) &&
    typeof flow.createdAt === "number" &&
    Date.now() - flow.createdAt < 10 * 60 * 1000
  );
};

const sessionUserFromDocument = (user: {
  _id: { toString(): string };
  firstname?: string;
  lastname?: string;
  email: string;
  fiscalYear?: number;
}): User => ({
  _id: user._id.toString(),
  firstname: user.firstname ?? "",
  lastname: user.lastname ?? "",
  email: normalizeGoogleEmail(user.email),
  fiscalYear:
    user.fiscalYear ?? accountingYear(new Date()) ?? new Date().getUTCFullYear(),
});

export const completeGoogleAuthentication = async (
  request: Request,
  flow: GoogleOauthFlow
) => {
  const callbackUrl = getGoogleCallbackUrl();
  callbackUrl.search = new URL(request.url).search;

  let tokens;
  try {
    tokens = await oidc.authorizationCodeGrant(
      await getGoogleConfiguration(),
      callbackUrl,
      {
        pkceCodeVerifier: flow.codeVerifier,
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
      }
    );
  } catch (error) {
    throw new GoogleAuthenticationError(
      "provider_error",
      error instanceof Error ? error.name : "Google authorization failed"
    );
  }

  const claims = tokens.claims();
  if (!claims || typeof claims.email !== "string") {
    throw new GoogleAuthenticationError(
      "provider_error",
      "Google returned no email claim"
    );
  }

  if (claims.email_verified !== true) {
    throw new GoogleAuthenticationError(
      "not_verified",
      "Google email is not verified"
    );
  }

  const email = normalizeGoogleEmail(claims.email);
  if (!isAllowedGoogleEmail(email)) {
    throw new GoogleAuthenticationError(
      "not_allowed",
      "Google account is not allowed"
    );
  }

  const googleSubject = claims.sub;
  if (!googleSubject) {
    throw new GoogleAuthenticationError(
      "provider_error",
      "Google returned no subject claim"
    );
  }

  const linkedUser = await Users.findOne({ googleSubject });
  if (linkedUser && normalizeGoogleEmail(linkedUser.email) !== email) {
    throw new GoogleAuthenticationError(
      "account_conflict",
      "Google identity is linked to another account"
    );
  }

  let user = linkedUser ?? (await Users.findOne({ email }));
  if (user?.googleSubject && user.googleSubject !== googleSubject) {
    throw new GoogleAuthenticationError(
      "account_conflict",
      "Email is linked to another Google identity"
    );
  }

  if (!user) {
    user = await Users.create({
      email,
      firstname:
        typeof claims.given_name === "string" ? claims.given_name : "",
      lastname:
        typeof claims.family_name === "string" ? claims.family_name : "",
      fiscalYear: accountingYear(new Date()) ?? new Date().getUTCFullYear(),
      googleSubject,
      authProvider: "google",
    });
  } else if (!user.googleSubject || user.authProvider !== "google") {
    user.googleSubject = googleSubject;
    user.authProvider = "google";
    await user.save();
  }

  return sessionUserFromDocument(user);
};
