import { useState, useRef, useEffect } from "react";
import { useFetcher, useParams, useNavigate } from "@remix-run/react";
import { useLoaderData } from "@remix-run/react";
import { ActionFunction, json } from "@remix-run/node";
import { Verifications } from "~/schemas/verifications";
import { Readable } from "stream";
import { s3Client } from "~/services/s3.server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import Tesseract from "tesseract.js";
import openai from "~/services/openapi.server";
import parser from 'pdf-parse'
import { v4 as uuidv4 } from 'uuid'; 

const content = `Du är en assistent som hjälper till att extrahera kvitto- och fakturainformation för bokföring. Din uppgift är att analysera texten och extrahera följande information i ett JSON-format:

1. **Datum (date)**: Datumet då köpet eller försäljningen gjordes.
2. **Moms (tax)**: Det belopp som motsvarar moms (VAT) på köpet eller försäljningen.
3. **Totalpris (total)**: Det totala beloppet inklusive moms.
4. **Beskrivning (description)**: En övergripande beskrivning av vad köpet eller försäljningen gäller, inklusive **fakturans eller kvittots datum**. Om fakturanummer och kundnummer finns med ska detta också tas med i beskrivningen.
5. **Konto-information (account)**: Konto för bokföring. Detta inkluderar debit och credit för varje konto enligt följande regler:

- Om texten **innehåller** **0006116446**, så är det en faktura som **du har skickat** till kund och fått betalt via Swish eller som kundfordran. Då ska kontona **2611 (Utgående moms på varor och frakt)** och **3001 (Försäljning av varor)** vara *credit*, och **1930 (Bank)** vara *debit* (om Swish används) eller **1510 (Kundfordringar)** om betalning sker senare.
- Om texten **inte innehåller** **0006116446**, så är det ett inköp. Då ska kontona **2640 (moms)** och **4000 (material)** vara *debit*, och **1930 (Bank)** vara *credit*. Detta gäller **alltid om texten inte innehåller 0006116446**.

Fördelning av summor:
- Konto **1930/1510 (Bank)** ska alltid motsvara totalsumman.
- Konto **2640/2611 (moms)** ska motsvara momsen.
- Konto **4000/3001 (material)** ska vara det återstående beloppet som är totalpris minus moms.

**Det är viktigt att endast fakturor som innehåller "0006116446" klassas som försäljningar. Om detta nummer saknas, är det ett inköp.**

Returnera resultatet som ett JSON-objekt i följande format:

{
  "date": "YYYY-MM-DD",
  "description": "Beskrivning av köpet eller försäljningen",
  "account": {
    "4000": { "debit": 100, "credit": 0 },
    "2640": { "debit": 25, "credit": 0 },
    "1930": { "debit": 0, "credit": 125 }
  }
}`

enum SelectorType  {
  INVOICE,
  RECEIPT,
  TAX_ACCOUNT
}

/**
 * Ta med Samules sedan också
 */
const selectorData = [
  {
    maxTokens: 500,
    type: SelectorType.INVOICE,
    keywords: ["0006116446"],
    content: `Du är en assistent som hjälper till att extrahera fakturainformation för bokföring. Din uppgift är att analysera texten och extrahera följande information i ett JSON-format:
    
    1. **Datum (date)**: Datumet då försäljningen gjordes.
    2. **Moms (tax)**: Det belopp som motsvarar moms (VAT) på försäljningen.
    3. **Totalpris (total)**: Det totala beloppet inklusive moms.
    4. **Beskrivning (description)**: En övergripande beskrivning av vad försäljningen gäller, inklusive **fakturans datum**. Om fakturanummer och kundnummer finns med ska detta också tas med i beskrivningen. Kundens referens ska vara med i beskrivningen.
    5. **Konto-information (accounts)**: Konton för bokföring. Detta inkluderar debit och credit för varje konto enligt följande regler:

    - Om texten **innehåller** **0006116446**, så är det en faktura som **du har skickat** till kund och fått betalt via Swish eller som kundfordran. Då ska kontona **2611 (Utgående moms på varor och frakt)** och **3001 (Försäljning av varor)** vara *credit*, och **1930 (Bank)** vara *debit* (om Swish används) eller **1510 (Kundfordringar)** om betalning sker senare.
    - Tänk på att det skulle kunna vara en kredit faktura. Om totalbeloppet är negativt ska debit och kredit bytas ut.

    Fördelning av summor:
    - Konto **1930/1510 (Bank)** ska alltid motsvara totalsumman inklusive moms.
    - Konto **2611 (moms)** ska motsvara momsen.
    - Konto **3001 (Försäljning av varor)** ska vara det återstående beloppet som är totalpris minus moms.

      Returnera resultatet som ett JSON-objekt i följande format:

      { 
        "date": "YYYY-MM-DD",
        "description": "Beskrivning av försäljningen (Datum: YYYY-MM-DD, Fakturnr: 100, Kundnr: 10)",
        "accounts": {
          "3001": { "debit": 0, "credit": 100 },
          "2611": { "debit": 0, "credit": 25 },
          "1930": { "debit": 125, "credit": 0 }
        }
      }
    `
  },
  {
    maxTokens: 500,
    type: SelectorType.RECEIPT,
    keywords: ["Kvittonr", "Kvitto", "BUTIKSNR", "Kassakvitto", "Kassa", "Faktura", "Fakturanummer", "Fakturadatum"],
    content: `Du är en assistent som hjälper till att extrahera inköp för bokföring. Din uppgift är att analysera texten och extrahera följande information i ett JSON-format:
    
    1. **Datum (date)**: Datumet då köpet gjordes.
    2. **Moms (tax)**: Det belopp som motsvarar moms (VAT) på köpet.
    3. **Totalpris (total)**: Det totala beloppet inklusive moms.
    4. **Beskrivning (description)**: En övergripande beskrivning av vad köpet gäller, inklusive **fakturans datum** eller ***kvittots datum***. Om fakturanummer/Kvittonummer och/eller kundnummer finns med ska detta också tas med i beskrivningen. Finns företagets namn ska det vara med.
    5. **Konto-information (accounts)**: Konton för bokföring. Detta inkluderar debit och credit för varje konto enligt följande regler:

    - Kontona **2640 (Ingående moms)** och **4000 (Material/Varukostnader)** ska vara *debit*, och **1930 (Bank)** vara *credit*.

    Fördelning av summor:
    - Konto **1930 (Bank)** ska alltid motsvara totalsumman inklusive moms.
    - Konto **2640 (moms)** ska motsvara momsen.
    - Konto **4000 (Material/Varukostnader)** ska vara det återstående beloppet som är totalpris minus moms.

      Returnera resultatet som ett JSON-objekt i följande format:

      { 
        "date": "YYYY-MM-DD",
        "description": "Beskrivning av fakturan/köpet (Datum: YYYY-MM-DD, Fakturnr: 100, Kundnr: 10, Kvittonr: 120)",
        "accounts": {
          "4000": { "debit": 100, "credit": 0 },
          "2640": { "debit": 25, "credit": 0 },
          "1930": { "debit": 0, "credit": 125 }
        }
      }
    `
  },
  {
    maxTokens: 500,
    type: SelectorType.RECEIPT,
    keywords: ["5722 32 953 76", "5130 00 238 99"], // Moa clayco
    content:  `Du är en assistent som hjälper till att extrahera bokföringsinformation. Din uppgift är att analysera texten och extrahera följande i JSON-format:
        
    1. **Datum (date)**: Datumet då pengarna drogs eller sattes in på kontot.
    2. **Totalpris (total)**: Det totala beloppet.
    3. **Beskrivning (description)**: Beskriv händelsen baserat på transaktionstypen:
       - Om pengar sätts in på ett konto (positivt belopp utan överföring), använd beskrivningen "Insättning (Datum: YYYY-MM-DD)".
       - Om pengar dras från ett konto (negativt belopp utan överföring) för en utgift, använd beskrivningen "Kortköp (Datum: YYYY-MM-DD)" tillsammans med detaljer om transaktionen.
       - Om det är en överföring mellan två konton, använd beskrivningen "Överföring (Datum: YYYY-MM-DD)".
    4. **Konto-information (accounts)**: Följ dessa regler noggrant för att avgöra debit och kredit:
    
    - **Regler för specifika konton:**
        - **Om till/från konto är "5722 32 953 76":**
            - Om **till konto** är "5722 32 953 76":
                - Om beloppet är positivt, debitera **1930**.
                - Om beloppet är negativt, kreditera **1930**.
            - Om **från konto** är "5722 32 953 76":
                - Kreditera alltid **1930**.
                - Om beloppet är negativt, debitera även **2013** för eget uttag.
        - **Om till/från konto är "5130 00 238 99":**
            - Om **till konto** är "5130 00 238 99":
                - Om beloppet är positivt, kreditera **2018**.
                - Om beloppet är negativt, debitera **2018**.
            - Om **från konto** är "5130 00 238 99":
                - Kreditera alltid **2018** om pengar flyttas från detta konto.
    
    - **Kortköp eller affärsutgifter från sekundärt konto**:
        - Vid kortköp eller andra affärsutgifter från **5130 00 238 99** (ej eget uttag):
            - Debitera **2018** med beloppet.
            - Kreditera **1930** med beloppet.
    
    - **Överföring mellan konton:**
        - Om **till konto** är "5722 32 953 76" och **från konto** är "5130 00 238 99":
            - Debitera **1930** och kreditera **2018**.
        - Om **till konto** är "5130 00 238 99" och **från konto** är "5722 32 953 76":
            - Om beloppet är negativt, kreditera **1930** och debitera **2013**.
            - Om beloppet är positivt, debitera **1930** och kreditera **2018**.
    
    5. **Specifika regler för negativa/positiva belopp:**
        - Vid positiva belopp och inget annat specificeras, debitera **1930** och kreditera **2018**.
        - Vid negativa belopp och inget annat specificeras, kreditera **1930** och debitera **2013**.
    
    ### Exempel på transaktion:
    - Datum: 2024-02-27
    - Belopp: -3000
    - Från konto: 5130 00 238 99
    - Beskrivning: Överföring
    
    Förväntat resultat:
    \`\`\`json
    {
      "date": "2024-02-27",
      "total": -3000,
      "description": "Överföring (Datum: 2024-02-27)",
      "accounts": {
        "1930": { "debit": 0, "credit": 3000 },
        "2018": { "debit": 3000, "credit": 0 }
      }
    }
    \`\`\`
    
    Analysera detta och returnera ett JSON-objekt i ovanstående format med korrekt kontoinformation för debit och kredit.
    `
  },
  {
    maxTokens: 3000,
    type: SelectorType.TAX_ACCOUNT,
    keywords: ["Skatteverket", "Skattekonto"], 
    content: `Jag har en ostrukturerad text med bokföringsdata från ett skattekonto där raderna är uppdelade i kolumnerna **Datum**, **Specifikation**, **Belopp**, och **Saldo**. Vissa rader saknar mellanslag mellan **Belopp** och **Saldo**, vilket gör det svårt att avgöra var **Belopp** slutar och **Saldo** börjar. Returnera resultatet i JSON-format enligt instruktionerna nedan.

### Instruktioner:
1. **Kolumnstruktur**: Varje rad följer strukturen **Datum**, **Specifikation**, **Belopp**, och **Saldo**. Identifiera dessa kolumner för varje rad i texten.

2. **Regel för Belopp och Saldo**:
  - Belopp och Saldo är ihopskrivet. Det betyder att du får göra tester för att titta på raden innan och raden efter för att matcha logiken.
  Exempel:
  240404Moms febr 20243333
  240406Slutlig skatt-29 943-29 910

  som du ser är den sista raden Saldo -29 910. och Beloppet -29 943. Det betyder att raden innan måsta ha Saldo 33 och belopp 33 för att det ska stämma.

3. **Returnera som JSON**:
   - Returnera resultatet i JSON-format som en lista med objekt enligt följande struktur:
     [
       {
         "Datum": "YYYY-MM-DD",
         "Specifikation": "Exempel specifikation",
         "Belopp": -1234,
         "Saldo": 5678
       },
       ...
     ]

Här är texten att tolka:

**Skattekonto
Gustafsson, Moa 000611-6446
Bokförda transaktioner
DatumSpecifikationBeloppSaldo
Ingående saldo 2024-01-010
240404Moms febr 20243333
240406Slutlig skatt-29 943-29 910
240406Avdragen skatt40 14510 235
240406Intäktsränta2210 257
240406Korrigerad intäktsränta1210 269
240406Utbetalning-10 20267
240409Inbetalning bokförd 240408473540
240504Intäktsränta1541
240507Inbetalning bokförd 240506266807
240513Moms mars 2024-473334
240612Moms april 2024-26668
240705Inbetalning bokförd 240704115183
240706Intäktsränta1184
240809Inbetalning bokförd 240808614798
240819Moms juni 2024-115683
240901Intäktsränta1684
240906Moms aug 2024158842
240912Moms juli 2024-614228
240916Utbetalning-15870
241009Inbetalning bokförd 2410082 0002 070
Utgående saldo 2024-10-152 070
Omfattar transaktionstyp: Alla fr.o.m. 2024-01-01 t.o.m. 2024-10-15, sorterade efter transaktionsdag.
2024-10-15 10:19Skattekonto - Skatteverket
https://sso.skatteverket.se/sk/ska/hamtaBokfTrans.do1/1**

Returnera endast JSON-strukturen.
`
  }
]


/**
 * Om parsedData innehåller vissa ord ska vi välja outcomeSelector 
 * beroende på det samt sätta vilka konton som ska medverka
 * @param parsedData
 */
const outcomeSelector = (parsedData: String) => {

  const normalizedParsedData = parsedData.toLowerCase();

  const selector = selectorData.find((selector) => 
    selector.keywords.some((keyword) => normalizedParsedData.includes(keyword.toLowerCase()))
  );

  console.log("SELECTOR", selector && selector.keywords)

  return selector || null; // Returnera null om inget matchar

}


const parseData = async(data: string) => {

  const selector = outcomeSelector(data)
  if (!selector) {
    return undefined
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o", // Använder GPT-4-modellen
    messages: [
      {
        role: "system",
        content: selector.content,
      },
      {
        role: "user",
        content: data,
      },
    ],
    max_tokens: selector.maxTokens, // Justera beroende på behov
  });

  // Extrahera GPT-svaret
  const extractedData = response.choices[0].message.content;
  console.log("Extraherad data:", extractedData);

  try {
    const cleanedData = extractedData
    .replace(/```json/g, "") // Ta bort ```json i början
    .replace(/```/g, ""); // Ta bort ``` i slutet

  // Försök att parsa till JSON
  const parsedData = JSON.parse(cleanedData || "{}");

  console.log("Parsed JSON:", parsedData);


    return parsedData
  } catch (e) {
    console.error("Failed to parse JSON:", e);
    return undefined
  }
}

async function runOcr(fileBuffer: Tesseract.ImageLike) {
  try {
    const { data } = await Tesseract.recognize(
      fileBuffer,
      "eng", // Välj språk, t.ex. 'eng' för engelska eller 'swe' för svenska
      {
        tessedit_char_whitelist:
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
        logger: (m) => console.log(m), // Logger för att se processen
      }
    );

    return data.text; // Returnera extraherad text från OCR
  } catch (error) {
    console.error("Error during OCR processing:", error);
    throw new Error("OCR processing failed.");
  }
}



export const action: ActionFunction = async ({ request, params }) => {
  const formData = await request.formData();
  const file = formData.get("file");

  // Konvertera filen till en Buffer endast en gång
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  // S3-upload och parsing körs parallellt med Promise.all
  const awsVerificationsPath = process.env.AWS_VERIFICATIONS_PATH;
  const fileName = `${Date.now()}-${file.name}`
  const filePath = `${awsVerificationsPath}/${fileName}`;
  const uploadParams = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: filePath,
    Body: fileBuffer,
    ContentType: file.type,
  };

  const upload = new Upload({
    client: s3Client,
    params: uploadParams,
  });

  const uploadPromise = upload.done();

  let parsePromise;


  function preprocessText(text: string) {
    return text.replace(/(\d)(\d{2})(?=\D*$)/gm, '$1 $2');
}

  // Hantering för PDF- och bildfiler
  if (file.type === "application/pdf") {
    parsePromise = parser(fileBuffer).then((pdfData) => {

      console.log("pre", preprocessText(pdfData.text))
      console.log("Extraherad text från PDF:", pdfData.text);



      return parseData(pdfData.text);
    });
  } else if (file.type.startsWith("image/")) {
    parsePromise = runOcr(fileBuffer).then((ocrResult) => {
      console.log("OCR Result:", ocrResult);
      return parseData(ocrResult);
    });
  } else {
    return json({ uuid: uuidv4(), verificationData: null, status: "failed" }, { status: 400 });
  }

  // Kör både uppladdningen och parsningen parallellt
  const [uploadResult, parsedData] = await Promise.all([uploadPromise, parsePromise]);

  console.log("HELLO", parseData)


  // Returnera både S3-url och parsed data
  return json({ uuid: uuidv4(),  file: {filePath: uploadResult.Location, label: fileName}, verificationData: parsedData, status: "success"  });
};

