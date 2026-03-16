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

    const coreIdea =
      this.extractBlock(cleaned, "CORE_IDEA") ??
      this.extractLine(cleaned, "CORE_IDEA") ??
      "No core idea extracted.";
    const keyConcepts = this.parseConcepts(cleaned);

    // New schema sections
    const toolsAndTechnologies =
      this.extractBlock(cleaned, "TOOLS_AND_TECHNOLOGIES") ?? "";
    const architecturesAndSystems =
      this.extractBlock(cleaned, "ARCHITECTURES_AND_SYSTEMS") ?? "";
    const proceduresAndProcesses =
      this.extractBlock(cleaned, "PROCEDURES_AND_PROCESSES") ?? "";
    const codeAndImplementation =
      this.extractBlock(cleaned, "CODE_AND_IMPLEMENTATION") ?? "";
    const denseSummary = this.extractBlock(cleaned, "DENSE_SUMMARY") ?? "";

    const keyInsights = this.parseListItems(cleaned, "KEY_INSIGHTS");
    const warningsAndAntipatterns = this.parseListItems(
      cleaned,
      "WARNINGS_AND_ANTIPATTERNS"
    );
    const metricsAndBenchmarks = this.parseListItems(
      cleaned,
      "METRICS_AND_BENCHMARKS"
    );
    const weakPoints = this.parseListItems(cleaned, "WEAK_POINTS");
    const openQuestions = this.parseListItems(cleaned, "OPEN_QUESTIONS");
    const indexTerms = this.parseFlatLines(cleaned, "INDEX_TERMS");

    const { assumes, leadsTo, references } = this.parsePrerequisites(cleaned);

    // Legacy fields (populated for backward compatibility)
    const steps: string[] = [];
    const insights = keyInsights;
    const actionables: string[] = [];
    const quotes: string[] = [];
    const connections = this.parseListItems(cleaned, "CONNECTIONS");

    const suggestedCategory = this.parseCategory(cleaned) ?? meta.defaultCategory;
    const suggestedType = this.parseType(cleaned) ?? "explainer";
    const suggestedTags = this.parseTags(cleaned);
    const keyPerson =
      this.extractLine(cleaned, "KEY_PERSON") ??
      this.extractBlock(cleaned, "KEY_PERSON") ??
      "Unknown";

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

      toolsAndTechnologies,
      architecturesAndSystems,
      proceduresAndProcesses,
      codeAndImplementation,
      keyInsights,
      warningsAndAntipatterns,
      metricsAndBenchmarks,
      weakPoints,
      openQuestions,
      denseSummary,
      prerequisitesAssumes: assumes,
      prerequisitesLeadsTo: leadsTo,
      prerequisitesReferences: references,
      indexTerms,

      steps,
      insights,
      actionables,
      quotes,
      connections,
      suggestedTags,
    };
  }

  // ─── Section extractors ───────────────────────────────────────────────────────

  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private labelPrefixPattern(): string {
    // Some models may include the prompt's `//` prefix literally.
    return String.raw`(?:\/\/\s*)?`;
  }

  private extractLine(text: string, key: string): string | null {
    const k = this.escapeRegExp(key);
    const pattern = new RegExp(`^${this.labelPrefixPattern()}${k}:\\s*(.+)$`, "m");
    const match = text.match(pattern);
    return match?.[1]?.trim() ?? null;
  }

  private extractBlock(text: string, section: string): string | null {
    const k = this.escapeRegExp(section);
    const nextLabel = `${this.labelPrefixPattern()}[A-Z_]+:`;
    const pattern = new RegExp(
      `^${this.labelPrefixPattern()}${k}:\\s*\\n([\\s\\S]*?)(?=\\n${nextLabel}|$)`,
      "m"
    );
    const match = text.match(pattern);
    if (!match?.[1]) return null;

    const block = match[1].trim();
    if (!block || block === "N/A") return null;
    return block;
  }

  private parseListItems(text: string, section: string): string[] {
    const block = this.extractBlock(text, section);
    if (!block) return [];

    const lines = block.split("\n");
    const items: string[] = [];
    let current: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
      const numberedMatch = trimmed.match(/^\d+\.\s+(.+)/);
      const extracted = bulletMatch?.[1] ?? numberedMatch?.[1];

      if (extracted) {
        if (current.length > 0) {
          items.push(current.join(" ").trim());
          current = [];
        }
        current.push(extracted.trim());
      } else if (current.length > 0) {
        current.push(trimmed);
      }
    }

    if (current.length > 0) items.push(current.join(" ").trim());
    return items;
  }

  private parseFlatLines(text: string, section: string): string[] {
    const block = this.extractBlock(text, section);
    if (!block) return [];

    return block
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .filter((l) => l.toLowerCase() !== "n/a");
  }

  private parseConcepts(text: string): Concept[] {
    const block = this.extractBlock(text, "KEY_CONCEPTS");
    if (!block) return [];

    const concepts: Concept[] = [];

    // Each concept is a "- Name: ..." block with optional indented fields
    const conceptBlocks = block.split(/\n(?=\s*-\s*Name:)/);

    for (const cb of conceptBlocks) {
      const nameLine = cb.match(/^-\s*Name:\s*(.+)/m);
      const defLine = cb.match(/^\s*Definition:\s*(.+)/m);
      const whyLine = cb.match(/^\s*Why It Matters:\s*(.+)/m);
      const impLine = cb.match(/^\s*Importance:\s*(.+)/m);

      if (nameLine?.[1]) {
        concepts.push({
          name: nameLine[1].trim(),
          definition: defLine?.[1]?.trim() ?? "",
          importance: (whyLine?.[1] ?? impLine?.[1] ?? "").trim(),
        });
      }
    }

    return concepts;
  }

  private parsePrerequisites(text: string): {
    assumes: string;
    leadsTo: string;
    references: string;
  } {
    const block = this.extractBlock(text, "PREREQUISITES");
    if (!block) return { assumes: "", leadsTo: "", references: "" };

    const assumes =
      block.match(/^\s*Assumes knowledge of:\s*(.+)\s*$/m)?.[1]?.trim() ?? "";
    const leadsTo =
      block.match(/^\s*Leads naturally to:\s*(.+)\s*$/m)?.[1]?.trim() ?? "";
    const references =
      block.match(/^\s*References made:\s*(.+)\s*$/m)?.[1]?.trim() ?? "";

    return { assumes, leadsTo, references };
  }

  private parseCategory(text: string): VideoCategory | null {
    const raw = this.extractLine(text, "SUGGESTED_CATEGORY");
    if (!raw) return null;
    const valid: VideoCategory[] = [
      "ai", "programming", "career", "mindset", "interests", "uncategorized",
    ];
    const lower = raw.toLowerCase().trim() as VideoCategory;
    return valid.includes(lower) ? lower : null;
  }

  private parseType(text: string): VideoType | null {
    const raw = this.extractLine(text, "SUGGESTED_TYPE");
    if (!raw) return null;
    const valid: VideoType[] = [
      "tutorial", "talk", "explainer", "opinion", "deep-dive",
    ];
    const lower = raw.toLowerCase().trim() as VideoType;
    return valid.includes(lower) ? lower : null;
  }

  private parseTags(text: string): string[] {
    const raw = this.extractLine(text, "SUGGESTED_TAGS");
    if (!raw) return [];
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }
}
