# Borttagning av konto 2050

## Omfattning

2050-migreringen genomfördes när datamodellen fortfarande var domänavgränsad
och omfattade då endast Moa Clay Co. Efter övergången till en enda butik läser
verktyget samtliga verifikationer; det avbryter om äldre data innehåller en
annan butik. Själva borttagningen av de äldre `domain`-fälten dokumenteras i
`docs/single-store-mongo-migration.md`.

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

Följande butikssamlingar kopierades:

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

## Production — utförd 2026-08-13

En ny skrivskyddad dry-run bekräftade den dokumenterade fördelningen 16/6/10/10,
ett slutantal på 230 verifikationer och 0 rader på konto 2050:

```sh
node --env-file=.env.production.local --import=tsx \
  tools/remove-tax-account-2050.ts \
  --target=production
```

Production migrerades därefter med både skrivflagga och separat
production-spärr:

```sh
node --env-file=.env.production.local --import=tsx \
  tools/remove-tax-account-2050.ts \
  --target=production \
  --apply \
  --confirm-production=remove-2050
```

Efterkontrollen gav:

- 230 verifikationer.
- 0 journalrader på konto 2050.
- 0 obalanserade verifikationer.
- 0 dubbla verifikationsnummer.
- Samtliga 42 originalverifikationer låg på rätt konto för sin händelsetyp.
- Verifikationsräknaren på A238.

Production saknade den valfria tillfälliga A239. De sex gamla rättelserna A231,
A232, A233, A235, A236 och A237 samt den felaktiga A229 togs bort. A229:s
underlag flyttades till A238.

Verktyget avbryter om databasnamnet, källverifikationerna, de sex gamla
rättelserna, A229, A238, verifikationsräknaren eller den förväntade
fördelningen 16/6/10/10 avviker. Efter genomförd migrering är det idempotent
och verifierar slutläget utan nya skrivningar.
