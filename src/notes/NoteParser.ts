import type { Concept, VideoCategory, VideoNote, VideoType } from "../types";

// ─── Structured output parser ─────────────────────────────────────────────────
//
// Primary path: parse the labeled-section format mandated by SYSTEM_PROMPT.
// Fallback path: heuristic markdown header extraction.

export class NoteParser {
  parse(
    raw: string,
    meta: {
      title: string;
      channel: string;
      url: string;
      videoId: string;
      dateWatched: string;
      defaultCategory: VideoCategory;
      defaultStatus: string;
    }
  ): VideoNote {
    const cleaned = raw.trim();

    const coreIdea = this.extract(cleaned, "CORE_IDEA") ?? "No core idea extracted.";
    const keyConcepts = this.parseConcepts(cleaned);
    const steps = this.parseList(cleaned, "STEPS");
    const insights = this.parseList(cleaned, "INSIGHTS");
    const actionables = this.parseList(cleaned, "ACTIONABLES");
    const quotes = this.parseList(cleaned, "QUOTES");
    const connections = this.parseList(cleaned, "CONNECTIONS");
    const suggestedCategory = this.parseCategory(cleaned) ?? meta.defaultCategory;
    const suggestedType = this.parseType(cleaned) ?? "explainer";
    const suggestedTags = this.parseTags(cleaned);
    const keyPerson = this.extract(cleaned, "KEY_PERSON") ?? "Unknown";

    return {
      title: meta.title,
      channel: meta.channel,
      url: meta.url,
      videoId: meta.videoId,
      dateWatched: meta.dateWatched,
      category: suggestedCategory,
      type: suggestedType,
      status: meta.defaultStatus as VideoNote["status"],
      tags: [],
      keyPerson,
      coreIdea,
      keyConcepts,
      steps,
      insights,
      actionables,
      quotes,
      connections,
      suggestedTags,
    };
  }

  // ─── Section extractors ───────────────────────────────────────────────────────

  private extract(text: string, key: string): string | null {
    const pattern = new RegExp(`^${key}:\\s*(.+)$`, "m");
    const match = text.match(pattern);
    return match?.[1]?.trim() ?? null;
  }

  private parseList(text: string, section: string): string[] {
    // Find the section header and collect bullet/numbered items until next section
    const sectionPattern = new RegExp(
      `^${section}:\\s*\\n([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`,
      "m"
    );
    const match = text.match(sectionPattern);
    if (!match?.[1]) return [];

    const block = match[1];
    if (block.trim() === "N/A" || block.trim() === "") return [];

    const lines = block.split("\n").map((l) => l.trim());
    const items: string[] = [];

    for (const line of lines) {
      // Match bullet (- text) or numbered (1. text)
      const bulletMatch = line.match(/^[-*]\s+(.+)/);
      const numberedMatch = line.match(/^\d+\.\s+(.+)/);
      const extracted = bulletMatch?.[1] ?? numberedMatch?.[1];
      if (extracted) items.push(extracted.trim());
    }

    return items;
  }

  private parseConcepts(text: string): Concept[] {
    const sectionPattern = /^KEY_CONCEPTS:\s*\n([\s\S]*?)(?=\n[A-Z_]+:|$)/m;
    const match = text.match(sectionPattern);
    if (!match?.[1]) return [];

    const block = match[1];
    const concepts: Concept[] = [];

    // Each concept is a "- Name: ..." block with optional indented fields
    const conceptBlocks = block.split(/\n(?=- Name:)/);

    for (const cb of conceptBlocks) {
      const nameLine = cb.match(/^-\s*Name:\s*(.+)/m);
      const defLine = cb.match(/^\s*Definition:\s*(.+)/m);
      const impLine = cb.match(/^\s*Importance:\s*(.+)/m);

      if (nameLine?.[1]) {
        concepts.push({
          name: nameLine[1].trim(),
          definition: defLine?.[1]?.trim() ?? "",
          importance: impLine?.[1]?.trim() ?? "",
        });
      }
    }

    return concepts;
  }

  private parseCategory(text: string): VideoCategory | null {
    const raw = this.extract(text, "SUGGESTED_CATEGORY");
    if (!raw) return null;
    const valid: VideoCategory[] = [
      "ai", "programming", "career", "mindset", "interests", "uncategorized",
    ];
    const lower = raw.toLowerCase().trim() as VideoCategory;
    return valid.includes(lower) ? lower : null;
  }

  private parseType(text: string): VideoType | null {
    const raw = this.extract(text, "SUGGESTED_TYPE");
    if (!raw) return null;
    const valid: VideoType[] = [
      "tutorial", "talk", "explainer", "opinion", "deep-dive",
    ];
    const lower = raw.toLowerCase().trim() as VideoType;
    return valid.includes(lower) ? lower : null;
  }

  private parseTags(text: string): string[] {
    const raw = this.extract(text, "SUGGESTED_TAGS");
    if (!raw) return [];
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }
}
