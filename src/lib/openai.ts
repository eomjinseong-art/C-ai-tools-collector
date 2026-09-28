import OpenAI from "openai";

export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

let client: OpenAI | undefined;

export function openaiModel(): string {
  const configured = process.env.OPENAI_MODEL?.trim();
  return configured || DEFAULT_OPENAI_MODEL;
}

/**
 * Swap the shared client. Tests inject an `OpenAI` instance whose `fetch`
 * returns a canned chat completion; production leaves this unset.
 */
export function configureOpenAIClient(next: OpenAI | undefined): void {
  client = next;
}

export function openai(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY env var");
    client = new OpenAI({ apiKey });
  }
  return client;
}
