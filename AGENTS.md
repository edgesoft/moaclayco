# Branchregler

- Brancher får aldrig ha ett namn som börjar med `agent/` eller `codex/`.
- Använd korta, neutrala och beskrivande namn utan verktygsprefix.
- Om den aktiva branchen har något av de förbjudna prefixen ska den byta namn
  innan nästa commit eller push. Se `BRANCH_NAMING.md`.

# UI-regler

- Använd aldrig webbläsarens vanliga/native `<select>`-dropdown i den användarvända huvudappen, inklusive admin- och bokföringsvyer.
- Använd aldrig browser-native `<input type="date">` i huvudappen. Datum och perioder ska väljas med en egen visuellt utformad periodkontroll eller kalenderkomponent.
- Val ska presenteras med en visuellt utformad komponent som passar Moa Clay Collections designsystem, till exempel en egen popover, radiogrupp eller projektets stylade select-komponent.
- En native dropdown får endast användas i interna engångsverktyg som inte är en del av huvudappen, och bara efter uttryckligt godkännande.
- Visa aldrig en odesignad browser-native formulärvy i huvudappen.
- Använd aldrig en helbredds svart primärknapp som ett generiskt avslut på ett formulär. Primära åtgärder ska vara proportionerliga, tydliga och passa innehållets visuella hierarki.
- Undvik generiska dashboard-mönster, stora KPI-kort och upprepade status-badges om de inte faktiskt gör uppgiften enklare.
- Huvudappens vyer ska följa Moa Clay Collections redaktionella uttryck: varm papperskänsla, lugn typografi, diskreta linjer och terrakotta som accent.
- Innan en ny eller ombyggd användarvy lämnas över ska den granskas visuellt i både smal mobilvy och normal desktopvy. Ett lyckat bygge räcker inte som visuell kvalitetssäkring.

## Förbjuden papperskorgsikon

- Använd aldrig en papperskorgsikon i huvudappens UI, varken som inline-SVG, ikonkomponent, Unicode-symbol eller importerad ikon.
- En borttagningsåtgärd ska i stället skrivas ut med tydlig text, till exempel `Ta bort raden`. I mycket kompakta listor får projektets neutrala stängningsikon användas om den är tydligt etiketterad för skärmläsare.
- Rita inte en egen papperskorg och ersätt inte förbudet med en annan destruktiv avfallsikon.
- Konteringsrader får inte ha en permanent borttagningskontroll i radens rubrik. Visa varken `Ta bort`, `Ta bort raden`, papperskorg eller stängningsikon där.
- Lägg aldrig en sticky sparrad ovanpå ett långt formulär. Sparaåtgärden ska komma efter sista fältet i dokumentflödet. I det färdiga formuläret ska den vara synlig även när något tillfälligt blockerar sparandet, då med en tydlig orsak. Under uppladdning och granskning ska den vara dold.
