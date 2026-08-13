# Borttagning av konto 2050

## Omfattning

Migreringen gäller endast dokument med `domain=moaclayco`. Den läser eller
skriver inte SGWoods-data. Fältet `domain` finns fortfarande kvar i appens
datamodell; detta är inte en domänmigrering.

Konto 2050 är inte ett tillgängligt konto i appen. Nya verifikationer med
2050 stoppas av valideringen. Produktionsverktyget nämner kontot endast för att
kunna hitta och ta bort de befintliga raderna.

## Återställning av stage — 2026-08-13

Stage återställdes från Moa Clay Co-dokumenten i production-databasen
`storm` till `storm-stage` med:

```sh
node tools/refresh-moaclayco-stage.mjs
node tools/refresh-moaclayco-stage.mjs --apply
node tools/refresh-moaclayco-stage.mjs --verify
```

Endast följande domänavgränsade samlingar kopierades:

| Samling | Antal dokument |
| --- | ---: |
| collections | 17 |
| discounts | 4 |
| items | 145 |
| orders | 167 |
| verificationCounters | 1 |
| verifications | 237 |

`users` och `webhookEvents` lämnades orörda. 671 refererade filer och bilder
kontrollerades mot stage-sökvägarna. 669 fanns oförändrade och två filer som
endast fanns i stage behölls. Inga SGWoods-dokument eller SGWoods-filer
kopierades.

## Direkt migrering av de ursprungliga verifikationerna

Stage migrerades med:

```sh
node --env-file=.env.stage.local --import=tsx \
  tools/remove-tax-account-2050.ts \
  --target=stage \
  --apply
```

Verktyget ändrade 42 ursprungliga verifikationer enligt deras verkliga
händelsetyp:

| Typ | Antal | Slutlig kontering |
| --- | ---: | --- |
| Intäktsränta | 16 | 2012 mot 8314 |
| Preliminär/slutlig/avdragen skatt | 6 | 2013 mot 2012 |
| Inbetalning till skattekontot | 10 | 2012 mot 1930 eller 2018 |
| Moms på skattekontot | 10 | 2012 mot 2650 |

Debet- och kreditriktningen behölls från respektive verklig transaktion.
Den gamla extra 2050/2650-delen togs bort från sammanslagna inbetalningar.

Dessutom gjordes följande i samma transaktion:

- De sex tidigare rättelserna A231, A232, A233, A235, A236 och A237 togs bort.
- Den felaktiga/dubbla A229 togs bort.
- A229:s underlag flyttades till den korrekta momsverifikationen A238.
- Den tillfälliga A239 togs bort.
- Verifikationsräknaren verifierades mot högsta kvarvarande nummer, A238.

Slutkontrollen av `storm-stage` gav:

- 230 verifikationer.
- 0 journalrader på konto 2050.
- 0 obalanserade verifikationer.
- 0 dubbla verifikationsnummer.
- Alla migrerade rader har ett positivt belopp på exakt en av debet eller
  kredit.
- 0 SGWoods-dokument i de sex kontrollerade samlingarna.

Det finns äldre nollrader (`debet=0`, `kredit=0`) i production-underlaget,
främst i momsrapporter. De berörs inte av denna avgränsade 2050-migrering.

## Production — inte utförd

Production har inte skrivits till. En skrivskyddad dry-run har kontrollerat att
samma migrering ger samma slutliga antal och kontosaldon som i stage.

Kör dry-run igen om production har ändrats:

```sh
node --env-file=.env.production.local --import=tsx \
  tools/remove-tax-account-2050.ts \
  --target=production
```

Efter uttryckligt godkännande körs production med både skrivflagga och separat
production-spärr:

```sh
node --env-file=.env.production.local --import=tsx \
  tools/remove-tax-account-2050.ts \
  --target=production \
  --apply \
  --confirm-production=remove-2050
```

Verktyget avbryter om databasnamnet, källverifikationerna, de sex gamla
rättelserna, A229, A238, verifikationsräknaren eller den förväntade
fördelningen 16/6/10/10 avviker. Efter genomförd migrering är det idempotent
och verifierar slutläget utan nya skrivningar.
