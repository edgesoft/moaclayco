import OpenAI from "openai";

// Konfigurera OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Använd API-nyckeln från .env-filen
});

export default openai;
