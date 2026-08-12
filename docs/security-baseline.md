# Security baseline

This document records the security and build baseline introduced by issue #206.

## Enforced checks

- Node.js 20 is used in development, CI, stage, and production containers.
- Dependencies are installed reproducibly with `npm ci` and `package-lock.json`.
- TypeScript checking must pass in CI.
- CI must complete a production build.
- CI fails if `npm audit` reports a critical vulnerability in production or
  development dependencies.
- The Docker healthcheck performs an HTTP smoke check and verifies an HTML response.

## Known debt

As of 2026-08-11, the full audit reports 15 findings (8 high and 7 moderate)
and no critical vulnerabilities. The production-only audit reports 8 findings
(6 high and 2 moderate) and no critical vulnerabilities.

The remaining production high-severity findings originate from the React Router
6 and Remix 2 dependency tree. npm does not offer a patched Remix 2 upgrade for
these advisories; removing them requires the separately planned React Router
migration.

The email-link authentication stack and its vulnerable UUID dependency have
been removed. Administrator authentication now uses Google OpenID Connect with
PKCE, state, nonce, verified-email enforcement, and an explicit allowlist.
