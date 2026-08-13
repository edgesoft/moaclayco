import OpenAI from "openai";

let client: OpenAI | undefined;

export const getOpenAIClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  if (!client) {
    client = new OpenAI({
      apiKey,
      maxRetries: 2,
      timeout: 120_000,
    });
  }

  return client;
};
