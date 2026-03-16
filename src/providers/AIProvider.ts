import type {
  AIProviderID,
  CompletionRequest,
  ConnectionResult,
  YTKBSettings,
} from "../types";
import { AnthropicProvider } from "./AnthropicProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import { GeminiProvider } from "./GeminiProvider";
import { OllamaProvider } from "./OllamaProvider";
import { CerebrasProvider } from "./CerebrasProvider";
import { GroqProvider } from "./GroqProvider";

// ─── Abstract interface ───────────────────────────────────────────────────────

export interface IAIProvider {
  readonly id: AIProviderID;
  readonly name: string;
  isConfigured(): boolean;
  testConnection(): Promise<ConnectionResult>;
  complete(request: CompletionRequest): Promise<string>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createProvider(
  id: AIProviderID,
  settings: YTKBSettings
): IAIProvider {
  switch (id) {
    case "anthropic":
      return new AnthropicProvider(settings);
    case "openai":
      return new OpenAIProvider(settings);
    case "gemini":
      return new GeminiProvider(settings);
    case "ollama":
      return new OllamaProvider(settings);
    case "cerebras":
      return new CerebrasProvider(settings);
    case "groq":
      return new GroqProvider(settings);
  }
}

export function getActiveProvider(settings: YTKBSettings): IAIProvider {
  return createProvider(settings.activeProvider, settings);
}
