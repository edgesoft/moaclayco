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
    content: `
    Du är en assistent som hjälper till att extrahera bokföringsinformation. Din uppgift är att analysera texten och extrahera följande i JSON-format:
            
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
                - Om beloppet är positivt, debitera **2018**.
                - Om beloppet är negativt, kreditera **2018**.
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
            - Om beloppet är positivt, kreditera **1930** och debitera **2018**.
    
    5. **Specifika regler för negativa/positiva belopp:**
        - Vid positiva belopp och inget annat specificeras, debitera **1930** och kreditera **2018**.
        - Vid negativa belopp och inget annat specificeras, kreditera **1930** och debitera **2013**.
    
    ### Exempel på transaktion:
    - Datum: 2024-02-27
    - Belopp: -3000
    - Från konto: 5130 00 238 99
    - Beskrivning: Överföring
    
    Förväntat resultat:
    {
      "date": "2024-02-27",
      "total": -3000,
      "description": "Överföring (Datum: 2024-02-27)",
      "accounts": {
        "1930": { "debit": 0, "credit": 3000 },
        "2018": { "debit": 3000, "credit": 0 }
      }
    }
    
    Analysera detta och returnera ett JSON-objekt i ovanstående format med korrekt kontoinformation för debit och kredit.
    `
  },
  {
    maxTokens: 500,
    type: SelectorType.RECEIPT,
    keywords: ["5709 00 121 15"],
    content:  `Du är en assistent som hjälper till att extrahera bokföringsinformation. Din uppgift är att analysera texten och extrahera följande i JSON-format:
        
    1. **Datum (date)**: Datumet då pengarna drogs eller sattes in på kontot.
    2. **Totalpris (total)**: Det totala beloppet.
    3. **Beskrivning (description)**: Beskriv händelsen baserat på transaktionstypen. Ta med rubrik om det finns:
       - Om pengar sätts in på ett konto (positivt belopp utan överföring), använd beskrivningen "Insättning (Datum: YYYY-MM-DD)".
       - Om pengar dras från ett konto (negativt belopp utan överföring) för en utgift, använd beskrivningen "Kortköp (Datum: YYYY-MM-DD)" tillsammans med detaljer om transaktionen.
       - Om det är en överföring mellan två konton, använd beskrivningen "Överföring (Datum: YYYY-MM-DD)".
    4. **Konto-information (accounts)**: Följ dessa regler noggrant för att avgöra debit och kredit:
    
   - Från kontot är **5709 00 121 15** och det är inget tillkonto. Bokför som **2018** credit,  konto **4000** debit och konto **2640** med 25% moms.
   - Om det är ett negativt belopp ska 2018 crediteras men det är alltid ett positivt belopp. Debit och kredit tar hand om det.

    Förväntat resultat:
    \`\`\`json
    {
      "date": "2024-02-27",
      "total": -229,30,
      "description": "Överföring (Datum: 2024-02-27)",
      "accounts": {
        "4000": { "debit": 183,44, "credit": 0},
        "2640": { "debit": 45,86, "credit": 0},
        "2018": { "debit": 0, "credit": 229,30 }
      }
    }
    \`\`\`
    
    Analysera detta och returnera ett JSON-objekt i ovanstående format med korrekt kontoinformation för debit och kredit.
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
      "swe", // Välj språk, t.ex. 'eng' för engelska eller 'swe' för svenska
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
