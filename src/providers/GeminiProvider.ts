import { requestUrl } from "obsidian";
import type { CompletionRequest, ConnectionResult, YTKBSettings } from "../types";
import type { IAIProvider } from "./AIProvider";

export class GeminiProvider implements IAIProvider {
  readonly id = "gemini" as const;
  readonly name = "Google Gemini";
  private settings: YTKBSettings;

  constructor(settings: YTKBSettings) {
    this.settings = settings;
  }

  isConfigured(): boolean {
    return this.settings.providers.gemini.apiKey.trim().length > 0;
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    try {
      const resp = await requestUrl({
        url: this.endpoint("generateContent"),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply with the single word: ready" }] }],
          generationConfig: { maxOutputTokens: 10 },
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
      url: this.endpoint("generateContent"),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemPrompt }] },
        contents: [{ parts: [{ text: request.userPrompt }] }],
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature,
        },
      }),
    });

    const body = resp.json as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
      error?: { message: string };
    };

    if (body.error) throw new Error(`Gemini: ${body.error.message}`);
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no content.");
    return text;
  }

  private endpoint(method: string): string {
    const model = this.settings.providers.gemini.model;
    const key = this.settings.providers.gemini.apiKey;
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}?key=${key}`;
  }
}
