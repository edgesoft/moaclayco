# Legacy 2050 correction runbook

GitHub issue: https://github.com/edgesoft/moaclayco/issues/209

## Purpose

Older Moa Clay Co verifications used account 2050 as a technical tax-account
counter account. BAS uses 2012 for tax-account reconciliation in a sole trader,
while 2050 is reserved for an expansion fund.

This runbook records the traceable correction tested in stage. Original
verifications are never overwritten. Each change is a separate correction
verification linked to its source through metadata and an idempotency key.

Ordinary postings still reject account 2050. It is accepted only when metadata
contains `legacy2050Correction=true`.

## Stage execution - 2026-08-12

Source database: `storm-stage`

Source verifications: A223, A224, A226, A227, A228 and A229.

The correct replacement for the VAT part of A229 had already been created as
A240 by the tax-account PDF import. The migration tool refuses to run unless
that replacement exists with row fingerprint `2026-04-13:-23900:1`.

### Commands used

Dry-run:

```sh
npx tsx --env-file=.env.stage.local tools/correct-legacy-tax-account-2050.ts \
  --target=stage \
  --date=2026-08-12
```

Apply:

```sh
npx tsx --env-file=.env.stage.local tools/correct-legacy-tax-account-2050.ts \
  --target=stage \
  --date=2026-08-12 \
  --apply
```

### Corrections created

| New | Corrects | Journal entries |
| --- | --- | --- |
| A252 | A223 | Debit 2050 1; credit 8314 1 |
| A253 | A224 | Debit 2013 399; credit 2050 399 |
| A254 | A226 | Debit 2050 239; credit 2650 239 |
| A255 | A227 | Debit 2050 1; credit 8314 1 |
| A256 | A228 | Debit 2013 399; credit 2050 399 |
| A257 | A229 | Debit 2012 239; credit 2650 239; debit 2050 239; credit 2018 239 |

Every correction has:

- `legacy2050Correction=true`
- `migration=legacy-tax-account-2050-2026-v1`
- `correctionForVerification=<source number>`
- `githubIssue=209`
- idempotency key `legacy-tax-account-2050-2026-v1:A<source number>`

### Verified account balances

| Account | Before | After | Change |
| --- | ---: | ---: | ---: |
| 2012 | 3,115.00 | 3,354.00 | +239.00 |
| 2050 | 318.00 | 0.00 | -318.00 |
| 2013 | 6,164.00 | 6,962.00 | +798.00 |
| 2018 | -10,955.75 | -11,194.75 | -239.00 |
| 2650 | 436.00 | -42.00 | -478.00 |
| 8314 | -12.00 | -14.00 | -2.00 |

The tax-account balance on 2012 now agrees with the uploaded statement's
closing balance of 3,354.00. Account 2050 is zero. The correction is mainly a
balance-sheet reclassification, but the two old interest rows also increase
interest income on 8314 by 2.00.

### Verified statement re-upload

The same 21 statement rows were reconciled again against `storm-stage` after
the correction. The result was:

- booked: 21
- review: 0
- missing: 0

For statement reconciliation, a correction marked with
`legacy2050Correction=true` and `correctionForVerification=<source number>` is
combined with its original verification. This exposes the corrected effective
posting without rewriting or hiding either database record. A correction that
fully reverses an original, as for A229, removes that original from matching so
the imported replacement A240 is used instead.

## Production procedure - do not run without approval

Production must be checked independently. Do not assume it has the same latest
verification numbers or replacement postings as stage.

1. Deploy the validation change and migration tool.
2. Confirm that production still has the exact source signatures expected for
   A223, A224, A226, A227, A228 and A229.
3. Confirm that the tax-account PDF import has created the correct replacement
   for the A229 VAT portion. The tool checks the row fingerprint and entries.
4. Run the dry-run using the actual correction date:

   ```sh
   npx tsx --env-file=.env.production.local tools/correct-legacy-tax-account-2050.ts \
     --target=production \
     --date=YYYY-MM-DD
   ```

5. Review the database name, original signatures, replacement verification,
   existing corrections, proposed entries and before-balances in the output.
6. Obtain explicit approval for the production write.
7. Apply with the production confirmation guard:

   ```sh
   npx tsx --env-file=.env.production.local tools/correct-legacy-tax-account-2050.ts \
     --target=production \
     --date=YYYY-MM-DD \
     --apply \
     --confirm-production=issue-209
   ```

8. Verify that 2050 is zero, 2012 agrees with the tax-account statement and all
   account deltas equal the dry-run. Re-upload the same PDF and confirm the
   stage acceptance result: 21 booked, 0 review and 0 missing.
9. Re-run the tool in dry-run mode. It must report all six idempotent
   corrections as existing and propose no duplicate writes.

The tool stops instead of writing if the database target, source signatures,
replacement VAT posting or migration completeness differs from the verified
stage state. Do not bypass those guards; investigate the production difference
and update this runbook first.

## Reversal policy

Do not delete a correction verification. If a correction itself is wrong,
create a new dated and traceable reversal linked to the correction. A disposable
stage environment may alternatively be restored from a known source import,
but production history must remain append-only.
