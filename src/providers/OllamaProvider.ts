import { requestUrl } from "obsidian";
import type { CompletionRequest, ConnectionResult, YTKBSettings } from "../types";
import type { IAIProvider } from "./AIProvider";

export class OllamaProvider implements IAIProvider {
  readonly id = "ollama" as const;
  readonly name = "Ollama (local)";
  private settings: YTKBSettings;

  constructor(settings: YTKBSettings) {
    this.settings = settings;
  }

  isConfigured(): boolean {
    return this.settings.providers.ollama.baseUrl.trim().length > 0;
  }

  async testConnection(): Promise<ConnectionResult> {
    const start = Date.now();
    const baseUrl = this.settings.providers.ollama.baseUrl.replace(/\/$/, "");
    try {
      const resp = await requestUrl({
        url: `${baseUrl}/api/tags`,
        method: "GET",
        throw: false,
      });
      if (resp.status === 200) {
        return { success: true, latencyMs: Date.now() - start };
      }
      return { success: false, error: `Ollama not reachable at ${baseUrl}` };
    } catch (e) {
      return {
        success: false,
        error: `Ollama not detected at ${baseUrl}. Make sure Ollama is running.`,
      };
    }
  }

  async complete(request: CompletionRequest): Promise<string> {
    const baseUrl = this.settings.providers.ollama.baseUrl.replace(/\/$/, "");
    const combinedPrompt = `${request.systemPrompt}\n\n${request.userPrompt}`;

    const resp = await requestUrl({
      url: `${baseUrl}/api/generate`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.settings.providers.ollama.model,
        prompt: combinedPrompt,
        stream: false,
        options: {
          num_predict: request.maxTokens,
          temperature: request.temperature,
        },
      }),
    });

    const body = resp.json as { response?: string; error?: string };
    if (body.error) throw new Error(`Ollama: ${body.error}`);
    if (!body.response) throw new Error("Ollama returned no response.");
    return body.response;
  }
}
