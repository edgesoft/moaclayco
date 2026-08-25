# Moa clay collection


## Development
Local development runs entirely through Docker and uses the same Node major
version as stage and production. The app reads stage credentials from the
Git-ignored `.env.stage.local` file and is available at
`http://localhost:3000`.

Start the app:

```sh
docker compose -f compose.local.yml up --build
```

Stop it:

```sh
docker compose -f compose.local.yml down
```

Run project commands inside the container, for example:

```sh
docker compose -f compose.local.yml exec app npm run typecheck
```

Verify the running application and the production dependency baseline:

```sh
docker compose -f compose.local.yml exec app npm run smoke
docker compose -f compose.local.yml exec app npm run audit:critical
docker compose -f compose.local.yml exec app npm run audit:production
```

The development container automatically refreshes its named `node_modules`
volume when `package-lock.json` changes.

Build and smoke-test the production-like stage image on port 3100:

```sh
docker compose -f compose.stage-smoke.yml up --build --wait
docker compose -f compose.stage-smoke.yml exec app npm run smoke
docker compose -f compose.stage-smoke.yml down
```

The storefront has one customer and one theme. Localhost uses the same Moa Clay
Collections configuration as every deployed hostname.


## Deployment
The `fly-prod.toml` and `Dockerfile-prod` is used for production. The github workflow is set up to build with these files when pused to the `master` branch. `fly-stage` and `Dockerfile-stage` is used for the stage environment. It should be pushed to the `next` branch. The stage fly application has the following url `https://moaclayco-stage.fly.dev/`. All code should be tested there before pushing to master. 

the `.env` file should contain the following keys.

 - MONGODB_URL `url to mongodb atlas`
 - EMAIL_PASSWORD `email password`
 - EMAIL_USERNAME `email username`
 - EMAIL_REDIRECT_TO optional stage-only recipient that safely captures every order email and disables BCC
 - NODE_ENV `production` or `development`
 - STRIPE_PUBLIC_KEY `public key` to Stripe
 - STRIPE_SRV `server key` to Stripe
 - STRIPE_API_VERSION `2023-08-16` or `2026-07-29.dahlia`; defaults to legacy
 - STRIPE_WEBHOOK fallback signing secret for a single Stripe endpoint
 - STRIPE_WEBHOOK_LEGACY signing secret for the versioned legacy endpoint
 - STRIPE_WEBHOOK_DAHLIA signing secret for the versioned Dahlia endpoint
 - STRIPE_WEBHOOK_ACTIVE_VERSION the only webhook version allowed to create side effects
 - SESSION_SECRET `a long random session-signing secret`
 - GOOGLE_CLIENT_ID `OAuth Web application client ID`
 - GOOGLE_CLIENT_SECRET `OAuth Web application client secret`
 - GOOGLE_CALLBACK_URL `the exact OAuth callback URL`
 - GOOGLE_ALLOWED_EMAILS `additional comma-separated administrator emails`
 - AWS_ACCESS_KEY_ID
 - AWS_SECRET_ACCESS_KEY
 - AWS_REGION=eu-north-1
 - AWS_S3_BUCKET_NAME=moaclayco-stage
 - AWS_ITEM_PATH=items-stage
 - AWS_ORDER_IMAGE_PATH=items-stage/order-history
 - AWS_COLLECTION_PATH=collections-stage
 - ASSET_ORIGIN=https://38vabcm3.twic.pics
 - AWS_VERIFICATIONS_PATH=verifications-stage
 - OPENAI_API_KEY
 - OPENAI_ACCOUNTING_MODEL `gpt-5.6-terra` by default

## Google administrator login

Administrator login uses Google OpenID Connect instead of email magic links.
Create a **Web application** OAuth client in Google Cloud and register these
exact authorized redirect URIs for the environments you use:

```text
http://localhost:3000/auth/google/callback
https://moaclayco-stage.fly.dev/auth/google/callback
https://moaclayco.com/auth/google/callback
```

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in
the environment for each deployment. The three built-in approved accounts are
`moaclayco@gmail.com`, `moagusen@gmail.com`, and
`wicket.programmer@gmail.com`. `GOOGLE_ALLOWED_EMAILS` can add more accounts;
it does not remove the built-in administrators.

The login flow validates PKCE, state, nonce, Google's verified-email claim, and
the email allowlist. Missing approved users are provisioned on their first
successful login, while an existing user is linked to Google's stable subject
identifier.

Local environment templates for stage and production-like development are
available as `.env.stage.example` and `.env.production.example`. Populated
`.env.*.local` files are ignored by Git.

## Accounting document interpretation

PDFs and images are sent directly to the OpenAI Responses API. The application
does not use local PDF text extraction, Tesseract, or Google Vision. Results are
parsed through a strict accounting schema and then checked for valid dates,
unique account lines, signed source totals, and balanced debit/credit entries.

Run the deterministic local checks:

```sh
docker compose -f compose.local.yml exec app npm test
```

## Stripe webhook end-to-end test

The Stripe E2E suite uses the Stripe sandbox and an isolated Docker environment.
It never connects to the configured application database and captures all email
in Mailpit. The suite starts a MongoDB replica set, the app, Mailpit, and a
version-pinned Stripe CLI listener; it removes the containers and volumes when
the run finishes.

Set a sandbox `sk_test_...` key as `STRIPE_SRV` in `.env.stage.local`, or export
it only for the test process, then run:

```sh
npm run test:e2e:stripe
```

The suite verifies valid and invalid signatures, successful, failed and canceled
PaymentIntents, accounting, stock, discounts, captured confirmation email, and
duplicate-event idempotency. Stripe sandbox objects are tagged with a unique
`e2eRunId` and remain visible in Stripe Workbench for diagnostics. Set
`STRIPE_E2E_KEEP=1` only when you intentionally want to inspect the isolated
containers after a failed run.

The `Stripe Webhook E2E` GitHub Actions workflow runs the same suite manually.
Add the sandbox key as the repository secret `STRIPE_E2E_SECRET_KEY`, then start
the workflow from the Actions tab. Keep this key limited to a dedicated Stripe
sandbox; never use a live `sk_live_...` key.

The E2E suite defaults both API requests and Stripe CLI webhook rendering to
`2026-07-29.dahlia`, independent of the sandbox account's default version. It
also verifies the event API version received by the application. The real
sandbox suite is intentionally pinned to this migration target; legacy behavior
is covered by the unit-level rollout tests.

## Stripe API rollout

Stripe request and webhook versions are allowlisted separately instead of
accepting arbitrary environment values. Missing request configuration defaults
to `2023-08-16`, while the existing production webhook remains supported at
`2020-08-27` for rollback compatibility. Local development, stage and
production use `2026-07-29.dahlia` for both requests and the active webhook.

When one environment has a single webhook endpoint, `STRIPE_WEBHOOK` remains a
supported fallback. For a parallel rollout, configure two endpoints and their
version-specific secrets:

```text
/webhook?stripe_api_version=2020-08-27
/webhook?stripe_api_version=2023-08-16
/webhook?stripe_api_version=2026-07-29.dahlia
```

Set each Stripe endpoint to render events with the version in its URL. Both
signatures and event versions are verified, but only the endpoint matching
`STRIPE_WEBHOOK_ACTIVE_VERSION` creates side effects. This makes the cutover a
configuration change after the new endpoint has been verified. Keep
`capture_method=automatic` during this API migration; adopting asynchronous
capture is a separate change because balance transactions can arrive later.

Run a real API regression against a synthetic fixture:

```sh
docker compose -f compose.local.yml exec -T \
  -e ACCOUNTING_E2E_FIXTURE=/app/tests/fixtures/accounting/supplier-invoice.pdf \
  -e ACCOUNTING_E2E_EXPECTED=/app/tests/fixtures/accounting/supplier-invoice.expected.json \
  app npm run test:e2e:accounting
```

The E2E assertion intentionally compares document type, transaction dates,
signed totals, and exact account postings. Free-form descriptions may vary
without making the accounting result non-deterministic.
