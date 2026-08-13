# En butik utan `domain` i MongoDB

Appen använder nu alltid Moa Clay Collections enda tema och alla Mongo-frågor
är globala för den enda butiken. Stripe-metadata kan fortfarande innehålla det
stabila externa butiksvärdet `moaclayco`; det är inte ett Mongo-filter eller ett
temaval.

## Ordning

1. Deploya och verifiera den nya appversionen.
2. Kör migreringen som dry-run mot stage.
3. Kör migreringen med `--apply` mot stage och smoke-testa.
4. Kör dry-run mot production.
5. Kör production-migreringen först när den nya appversionen är verifierad.

Dry-run:

```bash
node --env-file=.env.stage.local --import=tsx \
  tools/remove-mongo-domains.ts --target=stage
```

Stage:

```bash
node --env-file=.env.stage.local --import=tsx \
  tools/remove-mongo-domains.ts --target=stage --apply
```

Production, dry-run:

```bash
node --env-file=.env.production.local --import=tsx \
  tools/remove-mongo-domains.ts --target=production
```

Production, efter verifierad deploy:

```bash
node --env-file=.env.production.local --import=tsx \
  tools/remove-mongo-domains.ts --target=production --apply \
  --confirm-production=single-store
```

Verktyget avbryter om databasen är fel, om någon kvarvarande `domain` inte är
`moaclayco`, eller om globala unika nycklar kolliderar. Vid apply skapas de nya
globala indexen först. Äldre globala index med rätt nyckel men utan unikhet
ersätts med ett unikt index under samma namn; vid fel återställs det gamla
indexet. Därefter tas fältet bort i en transaktion, verifikationsräknaren
konsolideras och sist tas gamla domain-index samt bevisat redundanta
prefixindex bort.

## Utförd 2026-08-13

Single-store-versionen deployades till production och gav HTTP 200 innan
production-databasen ändrades. Samma kod och migrering verifierades först mot
stage.

Efterkontrollen gav `domainFields=0`, inga legacy-domänindex och inga saknade
eller felkonfigurerade globala index i samtliga sju samlingar. Dokumentantalen
förblev oförändrade:

| Samling | Stage | Production |
| --- | ---: | ---: |
| accountingYears | 1 | 1 |
| collections | 17 | 17 |
| discounts | 4 | 4 |
| items | 145 | 145 |
| orders | 170 | 167 |
| verificationCounters | 1 | 1 |
| verifications | 250 | 235 |

Avslutande smoke-test gav HTTP 200 för både stage och production.
