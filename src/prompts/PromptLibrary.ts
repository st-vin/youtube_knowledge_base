import type { Prompt, VideoCategory, YTKBSettings } from "../types";
import { BUILTIN_PROMPTS, DEFAULT_TAG_TAXONOMY, SYSTEM_PROMPT } from "./builtinPrompts";

export class PromptLibrary {
  private settings: YTKBSettings;

  constructor(settings: YTKBSettings) {
    this.settings = settings;
  }

  // ─── Prompt selection ────────────────────────────────────────────────────────

  getAllPrompts(): Prompt[] {
    return [...BUILTIN_PROMPTS, ...this.settings.customPrompts];
  }

  getPromptById(id: string): Prompt | undefined {
    return this.getAllPrompts().find((p) => p.id === id);
  }

  getPromptForCategory(category: VideoCategory): Prompt {
    const categoryMap: Record<VideoCategory, string> = {
      ai: "ai-tech",
      programming: "ai-tech",
      career: "career",
      mindset: "mindset",
      interests: "ted",
      uncategorized: "universal",
    };

    const promptId = categoryMap[category] ?? this.settings.notes.defaultPromptId;
    return (
      this.getPromptById(promptId) ??
      this.getPromptById(this.settings.notes.defaultPromptId) ??
      BUILTIN_PROMPTS[0]
    );
  }

  getDefaultPrompt(): Prompt {
    return (
      this.getPromptById(this.settings.notes.defaultPromptId) ??
      BUILTIN_PROMPTS[0]
    );
  }

  // ─── Template rendering ───────────────────────────────────────────────────────
  //
  // New variables added to support quality improvements:
  //
  //   {{videoLength}}  — human-readable length label from ProcessingPipeline
  //                      e.g. "medium (10–40 min)", "long (40+ min)"
  //
  //   {{chunkNote}}    — empty string for normal videos; a note for the AI
  //                      explaining that the transcript was pre-summarized in
  //                      sections when isChunked = true. This prevents the AI
  //                      from treating section headers as part of the content.

  renderPrompt(
    prompt: Prompt,
    vars: {
      transcript: string;
      title?: string;
      channel?: string;
      url: string;
      date: string;
      videoLength?: string;
      isChunked?: boolean;
    }
  ): { system: string; user: string } {
    const taxonomy = [
      ...DEFAULT_TAG_TAXONOMY,
      ...this.settings.tags.customTags,
    ].join(", ");

    const chunkNote = vars.isChunked
      ? "Note: This is a structured summary of a long video. The original transcript was pre-processed in three chronological sections to preserve full coverage. Treat [Section 1], [Section 2], [Section 3] markers as navigation aids, not content."
      : "";

    const user = prompt.userPromptTemplate
      .replace(/\{\{transcript\}\}/g, vars.transcript)
      .replace(/\{\{title\}\}/g, vars.title ?? "Unknown")
      .replace(/\{\{channel\}\}/g, vars.channel ?? "Unknown")
      .replace(/\{\{url\}\}/g, vars.url)
      .replace(/\{\{date\}\}/g, vars.date)
      .replace(/\{\{existingTags\}\}/g, taxonomy)
      .replace(/\{\{videoLength\}\}/g, vars.videoLength ?? "unknown length")
      .replace(/\{\{chunkNote\}\}/g, chunkNote)
      // Clean up blank lines left by empty chunkNote
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return { system: SYSTEM_PROMPT, user };
  }

  // ─── Category detection prompt ────────────────────────────────────────────────

  getCategoryDetectionPrompt(transcript: string): {
    system: string;
    user: string;
  } {
    return {
      system:
        "You are a video content classifier. Respond with ONLY a single word from the allowed categories.",
      user: `Classify this video transcript into ONE category.

Allowed categories: ai, programming, career, mindset, interests, uncategorized

Rules:
- ai: AI, LLM, machine learning, agents, RAG, prompt engineering, neural networks
- programming: software development, code tutorials, open source, cybersecurity (non-AI)
- career: job advice, professional development, CS careers, interviews, workplace
- mindset: mental models, productivity, habits, self-improvement, philosophy, psychology
- interests: TED talks, society, history, science, culture, technology trends, general interest
- uncategorized: none of the above

Transcript (first 20000 chars):
${transcript.slice(0, 20000)}

Respond with ONLY one word — the category name:`,
    };
  }
}
