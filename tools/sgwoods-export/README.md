# SG Woods accounting export

This is a separate, read-only exporter for SG Woods accounting data. It reads
the `verifications` collection with the fixed filter `domain: "sgwoods"` and
downloads only the S3 objects referenced by the selected verifications.

It creates:

- `reports/huvudbok.pdf` - human-readable general ledger grouped by account.
- `reports/huvudbok.csv` - one row per journal entry with the period balance.
- `reports/verifikationslista.csv` - one row per verification.
- `reports/bilageindex.csv` - source-to-local mapping for supporting files.
- `source/verifications.json` - lossless normalized source records.
- `attachments/` - referenced S3 supporting files.
- `manifest.json` and `SHA256SUMS` - counts, validation results and checksums.

The tool never inserts, updates or deletes MongoDB data and never writes to S3.

## Credentials

The repository contains full environment templates for later application work,
not just the exporter. Create separate local files for stage and production:

```sh
cp .env.stage.example .env.stage.local
cp .env.production.example .env.production.local
chmod 600 .env.stage.local .env.production.local
```

Use a MongoDB user with `read` access and an AWS identity limited to
`s3:GetObject` for the relevant verification objects. The exporter does not
list the bucket. URL-encode reserved characters in the MongoDB password.
Populated `.env.*.local` files and `exports/` are ignored by Git.

Only the following application settings are needed by this exporter:

- `MONGODB_URL`
- `MONGODB_DATABASE` only when the URL does not contain the database name
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN` when temporary credentials are used
- `AWS_REGION`
- `AWS_S3_BUCKET_NAME`
- `AWS_VERIFICATIONS_PATH`
- `EXPORT_SOURCE_LABEL`

Email, Stripe, session, OpenAI, Google, item and collection settings are not
used. `AWS_S3_BUCKET_NAME` and `AWS_VERIFICATIONS_PATH` must contain the SG
Woods values for the selected environment. Every referenced S3 object is
checked against both values before download; Moa Clay objects and other S3
prefixes are rejected. Do not put `//` comments after values in an env file.
Use `#` on a separate line for comments.

## Build

```sh
docker compose -f compose.export.yml build sgwoods-export
```

## Stage rehearsal

The end date is inclusive. The target directory must not already exist.

```sh
APP_ENV_FILE=.env.stage.local docker compose -f compose.export.yml run --rm \
  sgwoods-export \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --output /exports/sgwoods-stage-2024 \
  --fail-on-warning
```

## Production export

Production requires an explicit confirmation flag. The flag only authorizes
reads; the implementation contains no database or S3 write calls.

```sh
APP_ENV_FILE=.env.production.local docker compose -f compose.export.yml run --rm \
  sgwoods-export \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --output /exports/sgwoods-production-2024 \
  --confirm-production-read \
  --fail-on-warning
```

## Local fixture test

This test needs no credentials and does not contact MongoDB or AWS:

```sh
APP_ENV_FILE=.env.stage.example docker compose -f compose.export.yml run --rm --no-deps \
  sgwoods-export \
  --fixture /tool/fixtures/verifications.json \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --output /exports/fixture-2024 \
  --skip-files \
  --fail-on-warning
```

The fixture is intended for development only. The production bundle is not a
replacement for review by the person responsible for the bookkeeping.
