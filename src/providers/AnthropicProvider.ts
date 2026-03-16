import { requestUrl } from "obsidian";
import type { CompletionRequest, ConnectionResult, YTKBSettings } from "../types";
import type { IAIProvider } from "./AIProvider";

export class AnthropicProvider implements IAIProvider {
  readonly id = "anthropic" as const;
  readonly name = "Anthropic Claude";
  private settings: YTKBSettings;

  constructor(settings: YTKBSettings) {
    this.settings = settings;
  }

  isConfigured(): boolean {
    return this.settings.providers.anthropic.apiKey.trim().length > 0;
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    try {
      const resp = await requestUrl({
        url: "https://api.anthropic.com/v1/messages",
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.settings.providers.anthropic.model,
          max_tokens: 10,
          messages: [{ role: "user", content: "Reply with the single word: ready" }],
        }),
        throw: false,
      });
      if (resp.status === 200) {
        return { success: true, latencyMs: Date.now() - start };
      }
      const body = resp.json as { error?: { message?: string } };
      return { success: false, error: body?.error?.message ?? `HTTP ${resp.status}` };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : "Network error" };
    }
  }

  async complete(request: CompletionRequest): Promise<string> {
    const resp = await requestUrl({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.settings.providers.anthropic.model,
        max_tokens: request.maxTokens,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.userPrompt }],
        temperature: request.temperature,
      }),
    });

    const body = resp.json as {
      content?: Array<{ type: string; text: string }>;
      error?: { message: string };
    };

    if (body.error) throw new Error(`Anthropic: ${body.error.message}`);
    const text = body.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new Error("Anthropic returned no text content.");
    return text;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.settings.providers.anthropic.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
}
