import assert from "node:assert/strict";
import test from "node:test";
import {
  getGoogleAuthorizationParameters,
  isAllowedGoogleEmail,
  isGoogleOauthFlow,
  normalizeGoogleEmail,
} from "../app/services/google-auth.server";

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
      state: "state",
      createdAt: Date.now(),
    }),
    true
  );
  assert.equal(
    isGoogleOauthFlow({
      codeVerifier: "verifier",
      nonce: "nonce",
      state: "state",
      createdAt: Date.now() - 11 * 60 * 1000,
    }),
    false
  );
});
