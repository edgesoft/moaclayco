# Leveransmejl: utkorg, återställning och stagekontroll

Det här dokumentet beskriver leveransmejlets beständiga tillstånd och hur ett
oklart utskick hanteras utan att kunden får ett tyst dubblettmejl. Modellen
gäller `SHIPPING` i `emailDeliveries`; `shippingEmailAt` finns kvar som en
bakåtkompatibel spegling men är inte längre den primära leveransstatusen.

## Tillstånd

| Status | Betydelse | Tillåten automatisk åtgärd |
| --- | --- | --- |
| `PENDING` | Utkorgsraden finns men inget anrop har ännu gjort anspråk på utskicket. | Kan hämtas av återställningen efter 60 sekunder. |
| `SENDING` | Ett anrop äger utskicket med en unik `claimToken`. | Ingen parallell sändning. Efter 15 minuter blir tillståndet `UNKNOWN`. |
| `SENT` | SMTP-servern accepterade mejlet och resultatet sparades. | Ingen omsändning. |
| `FAILED` | SMTP avvisade bevisligen mejlet före acceptans, exempelvis autentiserings-, envelope- eller uttryckligt 4xx/5xx-fel. | Administratören kan välja `Försök igen` på samma försök och samma stabila Message-ID. |
| `UNKNOWN` | Resultatet är tvetydigt: nätverksfel under `DATA`, SMTP-acceptans följd av databasfel, ett övergivet `SENDING` eller historisk order utan säkert leveranskvitto. | Aldrig automatisk omsändning. Administratören måste kontrollera och välja `Skicka ett nytt mejl`, vilket skapar ett nytt försök och Message-ID. |

Att statusen `SENT` betyder att mottagande SMTP-server accepterade mejlet, inte
att kunden öppnade eller läste det, framgår även i adminvyn.

## Idempotens och kraschgränser

- Första utskicket har en deterministisk nyckel per order och mejltyp. Ett unikt
  MongoDB-index och en atomisk övergång från `PENDING` till `SENDING` gör att två
  flikar inte kan genomföra två första sändningar.
- En samtidig `upsert` som förlorar kapplöpningen läser tillbaka den vinnande
  raden i stället för att visa ett tekniskt duplicate-key-fel.
- Ett medvetet nytt utskick använder det oklara försökets nummer för en
  deterministisk nästa rad. Två samtidiga klick kan därför inte skapa två
  separata omsändningar.
- Utkorgsraden skrivs före ordern ändras till `SHIPPED`. Om processen stannar
  mellan skrivningarna finns ett beständigt `PENDING`, men sändaren vägrar skicka
  tills ordern faktiskt är `SHIPPED`.
- Om processen stannar efter `SHIPPED` men före SMTP finns samma `PENDING` kvar
  för återställning eller den synliga åtgärden `Skicka nu`.
- Om SMTP har accepterat mejlet men `SENT` inte kan sparas görs ett omedelbart
  försök att markera raden `UNKNOWN`. Om även det misslyckas ändrar
  stale-återställningen ett kvarvarande `SENDING` till `UNKNOWN` efter 15 minuter.
- När orderns skickad-status återställs raderas varken utkorgsraden,
  `providerMessageId`, `sentAt` eller den historiska `shippingEmailAt`.

## Val av kö

MongoDB-utkorgen är tillräcklig för det nuvarande, administratörsdrivna och
lågvolymiga flödet:

- skapande, anspråk och tillstånd är beständiga och inspekterbara i samma
  databas som ordern;
- ett misslyckat eller oklart utskick syns på ordern och kräver rätt sorts
  uttrycklig åtgärd;
- högst tio äldre `PENDING` bearbetas var femte minut när appen får trafik;
- `FAILED` och `UNKNOWN` skickas aldrig automatiskt.

Detta ger inte en tidsbestämd leveransgaranti när appen saknar trafik. Byt till
en dedikerad worker eller schemalagd kökonsument om verksamheten behöver en
sådan garanti, större volym eller larm utan att en administratör öppnar appen.
En extern kö löser inte ensam SMTP:s tvetydiga acceptansgräns; för helt automatisk
hantering krävs dessutom en leverantör med sökbar leveransstatus eller verklig
idempotensnyckel.

## Integritetssäker observability

Loggar innehåller `orderId`, `deliveryId`, mejltyp, försök och resultat. Feltext
kortas och e-postadresser maskeras. Mottagaradressen lagras som ett kort SHA-256-
fingeravtryck i utkorgen; klartext hämtas från ordern först när utskicket görs.

## Säker verifiering i stage

Ingen verifiering får använda produktionskunder. Innan ett stageutskick:

1. Kontrollera att databasen är `storm-stage` och att stage använder stage-länken.
2. Rikta SMTP till en testserver/Mailpit och sätt `EMAIL_REDIRECT_TO` till en
   kontrollerad testmottagare. När variabeln finns ersätts mottagaren och BCC
   stängs av. Använd aldrig produktions-SMTP tillsammans med importerade
   kundadresser.
3. Skapa en syntetisk betald order med testadress och öppna orderdetaljen.
4. Klicka samtidigt i två sessioner på `Markera skickad och mejla kund` och
   verifiera en utkorgsrad, ett SMTP-mejl och status `SENT`.
5. Återställ skickad-status och verifiera att mejlhistoriken ligger kvar.
6. Simulera ett uttryckligt SMTP-avslag. Verifiera `FAILED`, synligt fel och
   `Försök igen`.
7. Simulera timeout under `DATA`. Verifiera `UNKNOWN`, ingen automatisk retry och
   den medvetna åtgärden `Skicka ett nytt mejl`.
8. Simulera databasfel efter SMTP-acceptans. Verifiera `UNKNOWN` direkt eller via
   stale-återställningen och att inget automatiskt nytt mejl skickas.
9. Kör `npm test`, `npm run lint`, `npm run typecheck` och `npm run build` på den
   commit som ska till stage.

Notera commit, testorder, utkorgens id och testserverns Message-ID i GitHub-issue
#218. Markera stagekriteriet först när hela listan ovan har verifierats.
