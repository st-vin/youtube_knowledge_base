import { requestUrl } from "obsidian";
import type { CompletionRequest, ConnectionResult, YTKBSettings } from "../types";
import type { IAIProvider } from "./AIProvider";

// ─── Groq Provider ────────────────────────────────────────────────────────────
//
// Groq uses an OpenAI-compatible API at a different base URL.
// The key difference from OpenAI: reasoning models (gpt-oss-120b) require
// temperature: 1 and accept a reasoning_effort parameter ("low"|"medium"|"high").
// Using any temperature other than 1 with gpt-oss-120b degrades output quality.
//
// Endpoint: https://api.groq.com/openai/v1/chat/completions
//                              ↑ /openai/ is required — NOT /v1/ directly

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Models that use reasoning_effort and require temperature: 1
const REASONING_MODELS = new Set([
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
]);

export class GroqProvider implements IAIProvider {
  readonly id = "groq" as const;
  readonly name = "Groq";
  private settings: YTKBSettings;

  constructor(settings: YTKBSettings) {
    this.settings = settings;
  }

  // ─── Is the provider ready to use? ───────────────────────────────────────────
  // Just checks if the user has entered an API key. Called before any request.

  isConfigured(): boolean {
    return this.settings.providers.groq.apiKey.trim().length > 0;
  }

  // ─── Test connection ──────────────────────────────────────────────────────────
  // Sends a tiny request and measures how long it takes.
  // The settings page "Test connection" button calls this.

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    try {
      const resp = await requestUrl({
        url: GROQ_ENDPOINT,
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.settings.providers.groq.model,
          messages: [{ role: "user", content: "Reply with the single word: ready" }],
          max_completion_tokens: 10,
          // Use temperature 1 for reasoning models, settings value for others
          temperature: this.isReasoningModel() ? 1 : this.settings.temperature,
        }),
        throw: false,
      });

      if (resp.status === 200) {
        return { success: true, latencyMs: Date.now() - start };
      }

      // Groq returns error details in resp.json.error.message
      const body = resp.json as { error?: { message?: string } };
      return {
        success: false,
        error: body?.error?.message ?? `HTTP ${resp.status}`,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Network error",
      };
    }
  }

  // ─── Complete a prompt ────────────────────────────────────────────────────────
  // This is what the pipeline calls when it wants to extract insights from a transcript.

  async complete(request: CompletionRequest): Promise<string> {
    const isReasoning = this.isReasoningModel();

    // Build the request body
    const body: Record<string, unknown> = {
      model: this.settings.providers.groq.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      max_completion_tokens: request.maxTokens,
      // Reasoning models MUST use temperature: 1 — override whatever the user set
      temperature: isReasoning ? 1 : request.temperature,
    };

    // Only add reasoning_effort for models that support it
    if (isReasoning) {
      body["reasoning_effort"] = this.settings.providers.groq.reasoningEffort;
    }

    const resp = await requestUrl({
      url: GROQ_ENDPOINT,
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    // Parse the response — same shape as OpenAI
    const data = resp.json as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`Groq: ${data.error.message}`);
    }

    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("Groq returned an empty response.");
    }

    return text;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      // Groq uses the same Bearer pattern as OpenAI
      "Authorization": `Bearer ${this.settings.providers.groq.apiKey}`,
    };
  }

  private isReasoningModel(): boolean {
    return REASONING_MODELS.has(this.settings.providers.groq.model);
  }
}
