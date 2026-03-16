import { requestUrl } from "obsidian";
import type {
  CompletionRequest,
  ConnectionResult,
  YTKBSettings,
} from "../types";
import type { IAIProvider } from "./AIProvider";

export class CerebrasProvider implements IAIProvider {
  readonly id = "cerebras" as const;
  readonly name = "Cerebras";

  private settings: YTKBSettings;

  constructor(settings: YTKBSettings) {
    this.settings = settings;
  }

  isConfigured(): boolean {
    return this.settings.providers.cerebras.apiKey.trim().length > 0;
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    try {
      const resp = await requestUrl({
        url: "https://api.cerebras.ai/v1/chat/completions",
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.settings.providers.cerebras.model,
          max_completion_tokens: 10,
          messages: [
            { role: "user", content: "Reply with the single word: ready" },
          ],
        }),
        throw: false,
      });

      if (resp.status === 200) {
        return { success: true, latencyMs: Date.now() - start };
      }

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

  async complete(request: CompletionRequest): Promise<string> {
    const resp = await requestUrl({
      url: "https://api.cerebras.ai/v1/chat/completions",
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: this.settings.providers.cerebras.model,
        max_completion_tokens: request.maxTokens,
        temperature: request.temperature,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
      }),
    });

    const body = resp.json as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message: string };
    };

    if (body.error) {
      throw new Error(`Cerebras: ${body.error.message}`);
    }

    const text = body.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("Cerebras returned an empty response.");
    }

    return text;
  }

  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.settings.providers.cerebras.apiKey}`,
    };
  }
}

