// ─── Domain types ───────────────────────────────────────────────────────────

export type VideoCategory =
  | "ai"
  | "programming"
  | "career"
  | "mindset"
  | "interests"
  | "uncategorized";

export type VideoType =
  | "tutorial"
  | "talk"
  | "explainer"
  | "opinion"
  | "deep-dive";

export type NoteStatus =
  | "raw"
  | "reviewing"
  | "processed"
  | "actionable"
  | "evergreen";

export type AIProviderID =
  | "anthropic"
  | "openai"
  | "gemini"
  | "ollama"
  | "cerebras"
  | "groq";

export type FolderStrategy =
  | "by-category"
  | "flat"
  | "by-channel"
  | "by-date";

// ─── Video / Note models ─────────────────────────────────────────────────────

export interface Concept {
  name: string;
  definition: string;
  importance: string;
}

export interface VideoNote {
  title: string;
  channel: string;
  url: string;
  videoId: string;
  dateWatched: string;
  category: VideoCategory;
  type: VideoType;
  status: NoteStatus;
  tags: string[];
  keyPerson: string;
  coreIdea: string;
  keyConcepts: Concept[];
  steps: string[];
  insights: string[];
  actionables: string[];
  quotes: string[];
  connections: string[];
  suggestedTags: string[];
  rawTranscript?: string;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

export interface Prompt {
  id: string;
  name: string;
  category: VideoCategory | "universal";
  description: string;
  isBuiltIn: boolean;
  isEnabled: boolean;
  userPromptTemplate: string;
}

// ─── AI ──────────────────────────────────────────────────────────────────────

export interface CompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
}

export interface ConnectionResult {
  success: boolean;
  latencyMs?: number;
  error?: string;
}

// ─── Transcript ───────────────────────────────────────────────────────────────

export interface TranscriptResult {
  text: string;
  source: "auto" | "manual";
  videoId: string;
  title?: string;
  channel?: string;
}

// Re-exported so pipeline and main.ts can import from one place
export type { TranscriptUnavailableReason } from "./transcript/YouTubeClient";
export { NoTranscriptError } from "./transcript/YouTubeClient";

// ─── Processing ───────────────────────────────────────────────────────────────

export interface ProcessingOptions {
  url: string;
  promptId: string;
  categoryOverride?: VideoCategory;
  manualTranscript?: string;
}

export interface ProcessingResult {
  note: VideoNote;
  filePath: string;
  noteFilename: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface ProviderConfig {
  anthropic: { apiKey: string; model: string };
  openai: { apiKey: string; model: string };
  gemini: { apiKey: string; model: string };
  ollama: { baseUrl: string; model: string };
  cerebras: { apiKey: string; model: string };
  groq: { apiKey: string; model: string; reasoningEffort: "low" | "medium" | "high" };
}

export interface VaultConfig {
  rootFolder: string;
  mocFolder: string;
  autoCreateFolders: boolean;
  folderStrategy: FolderStrategy;
  maintainIndex: boolean;
  categoryFolderMap: Record<VideoCategory, string>;
}

export interface NoteConfig {
  defaultPromptId: string;
  autoDetectCategory: boolean;
  includeRawTranscript: boolean;
  defaultStatus: NoteStatus;
  dateFormat: string;
  filenameTemplate: string;
}

export interface TagConfig {
  prefix: string;
  alwaysAddSourceTag: boolean;
  autoSuggest: boolean;
  customTags: string[];
}

export interface YTKBSettings {
  version: string;
  activeProvider: AIProviderID;
  providers: ProviderConfig;
  maxTokens: number;
  temperature: number;
  vault: VaultConfig;
  notes: NoteConfig;
  tags: TagConfig;
  customPrompts: Prompt[];
}
