import assert from "node:assert/strict";
import test from "node:test";
import { emailTransportOptions } from "../app/services/email-provider.server";

test("uses the production SMTP defaults", () => {
  assert.deepEqual(
    emailTransportOptions({
      EMAIL_PASSWORD: "password",
      EMAIL_USERNAME: "mailer@example.com",
    }),
    {
      auth: { pass: "password", user: "mailer@example.com" },
      host: "send.one.com",
      port: 465,
      secure: true,
    }
  );
});

test("supports an unauthenticated local SMTP sink", () => {
  assert.deepEqual(
    emailTransportOptions({
      EMAIL_HOST: "mailpit",
      EMAIL_PORT: "1025",
      EMAIL_SECURE: "false",
    }),
    {
      host: "mailpit",
      port: 1025,
      secure: false,
    }
  );
});

test("rejects partial credentials and invalid transport values", () => {
  assert.throws(
    () => emailTransportOptions({ EMAIL_USERNAME: "mailer@example.com" }),
    /must both be configured/
  );
  assert.throws(
    () => emailTransportOptions({ EMAIL_PORT: "0" }),
    /EMAIL_PORT/
  );
  assert.throws(
    () => emailTransportOptions({ EMAIL_SECURE: "yes" }),
    /EMAIL_SECURE/
  );
});
