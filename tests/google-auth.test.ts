import assert from "node:assert/strict";
import test from "node:test";
import {
  getGoogleAuthorizationParameters,
  isAllowedGoogleEmail,
  isGoogleOauthFlow,
  normalizeGoogleEmail,
} from "../app/services/google-auth.server";
import { auth } from "../app/services/auth.server";
import { action as logoutAction } from "../app/routes/logout";
import { commitSession, getSession } from "../app/services/session.server";
import {
  getGoogleAuthenticationPath,
  getSafeAuthenticationReturnTo,
} from "../app/utils/authRedirect";

test("always asks Google to show the account chooser", () => {
  const parameters = getGoogleAuthorizationParameters({
    redirectUri: "https://stage.example.com/auth/google/callback",
    codeChallenge: "challenge",
    state: "state",
    nonce: "nonce",
  });

  assert.equal(parameters.prompt, "select_account");
});

test("normalizes Google email addresses", () => {
  assert.equal(normalizeGoogleEmail("  Moaclayco@GMAIL.com "), "moaclayco@gmail.com");
});

test("allows every approved Moa Clay Co administrator", () => {
  assert.equal(isAllowedGoogleEmail("Moaclayco@gmail.com"), true);
  assert.equal(isAllowedGoogleEmail("moagusen@gmail.com"), true);
  assert.equal(isAllowedGoogleEmail("wicket.programmer@gmail.com"), true);
});

test("rejects Google accounts outside the allowlist", () => {
  assert.equal(isAllowedGoogleEmail("someone-else@gmail.com"), false);
});

test("accepts only complete, recent OAuth flow state", () => {
  assert.equal(
    isGoogleOauthFlow({
      codeVerifier: "verifier",
      nonce: "nonce",
      returnTo: "/admin/orders?status=open",
      state: "state",
      createdAt: Date.now(),
    }),
    true
  );
  assert.equal(
    isGoogleOauthFlow({
      codeVerifier: "verifier",
      nonce: "nonce",
      returnTo: "/admin/orders?status=open",
      state: "state",
      createdAt: Date.now() - 11 * 60 * 1000,
    }),
    false
  );
});

test("keeps a safe same-site page through Google authentication", () => {
  assert.equal(
    getSafeAuthenticationReturnTo("/collections/sommar?sort=latest#pieces"),
    "/collections/sommar?sort=latest#pieces"
  );
  assert.equal(
    getGoogleAuthenticationPath("/collections/sommar?sort=latest#pieces"),
    "/auth/google?returnTo=%2Fcollections%2Fsommar%3Fsort%3Dlatest%23pieces"
  );
});

test("rejects external and authentication return targets", () => {
  assert.equal(
    getSafeAuthenticationReturnTo("https://example.com/elsewhere"),
    "/"
  );
  assert.equal(
    getSafeAuthenticationReturnTo("//example.com/elsewhere"),
    "/"
  );
  assert.equal(
    getSafeAuthenticationReturnTo("/auth/google"),
    "/"
  );
});

test("an unauthenticated page request carries its location to login", async () => {
  try {
    await auth.isAuthenticated(
      new Request("https://moaclayco.com/admin/orders?status=open"),
      { failureRedirect: "/login" }
    );
    assert.fail("Expected authentication to redirect");
  } catch (error) {
    assert.ok(error instanceof Response);
    assert.equal(error.status, 302);
    assert.equal(
      error.headers.get("Location"),
      "/login?returnTo=%2Fadmin%2Forders%3Fstatus%3Dopen"
    );
  }
});

test("logout clears the session before redirecting to the storefront", async () => {
  const session = await getSession();
  session.set(auth.sessionKey, { email: "admin@example.com" });
  const cookie = await commitSession(session);

  const response = await logoutAction({
    context: {},
    params: {},
    request: new Request("https://moaclayco.com/logout", {
      headers: { Cookie: cookie },
      method: "POST",
    }),
  } as never);

  assert.ok(response instanceof Response);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/");

  const setCookie = response.headers.get("Set-Cookie");
  assert.ok(setCookie);
  const clearedSession = await getSession(setCookie.split(";", 1)[0]);
  assert.equal(clearedSession.has(auth.sessionKey), false);
});
