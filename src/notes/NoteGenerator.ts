import type { VideoNote, YTKBSettings } from "../types";
import { DEFAULT_TAG_TAXONOMY } from "../prompts/builtinPrompts";

export class NoteGenerator {
  private settings: YTKBSettings;

  constructor(settings: YTKBSettings) {
    this.settings = settings;
  }

  // ─── Filename ─────────────────────────────────────────────────────────────────

  buildFilename(note: VideoNote): string {
    const template = this.settings.notes.filenameTemplate;
    const date = this.formatDate(note.dateWatched);
    const titleSlug = this.slugify(note.title);
    const channelSlug = this.slugify(note.channel);

    return (
      template
        .replace("{{date}}", date)
        .replace("{{title-slug}}", titleSlug)
        .replace("{{channel-slug}}", channelSlug)
        .slice(0, 200) // path-safe length
        .replace(/[/\\:*?"<>|]/g, "-") + ".md"
    );
  }

  // ─── Tag assembly ─────────────────────────────────────────────────────────────

  buildTags(note: VideoNote): string[] {
    const prefix = this.settings.tags.prefix ?? "";
    const tags: string[] = [];

    // Always add source tag if configured
    if (this.settings.tags.alwaysAddSourceTag) {
      tags.push(`${prefix}youtube`);
    }

    // Category tag
    tags.push(`${prefix}${note.category}`);

    // Type tag
    tags.push(`${prefix}${note.type}`);

    // Status tag
    tags.push(`status/${note.status}`);

    // AI-suggested tags — filter against known taxonomy + custom tags
    if (this.settings.tags.autoSuggest && note.suggestedTags.length > 0) {
      const allowedTags = new Set([
        ...DEFAULT_TAG_TAXONOMY.map((t) => t.replace(/^#/, "")),
        ...this.settings.tags.customTags.map((t) => t.replace(/^#/, "")),
      ]);

      for (const t of note.suggestedTags) {
        const clean = t.replace(/^#/, "").toLowerCase().trim();
        if (clean && allowedTags.has(clean)) {
          tags.push(`${prefix}${clean}`);
        }
      }
    }

    // Deduplicate
    return [...new Set(tags)];
  }

  // ─── Markdown note ────────────────────────────────────────────────────────────

  buildMarkdown(note: VideoNote): string {
    const tags = this.buildTags(note);
    note.tags = tags; // store final tags on note

    const frontmatter = this.buildFrontmatter(note, tags);
    const body = this.buildBody(note);

    return frontmatter + "\n" + body;
  }

  private buildFrontmatter(note: VideoNote, tags: string[]): string {
    const tagLines = tags.map((t) => `  - ${t}`).join("\n");

    return [
      "---",
      `title: "${this.escapeYaml(note.title)}"`,
      `channel: "${this.escapeYaml(note.channel)}"`,
      `date_watched: ${note.dateWatched}`,
      `url: "${note.url}"`,
      `video_id: "${note.videoId}"`,
      `category: ${note.category}`,
      `type: ${note.type}`,
      `status: ${note.status}`,
      `tags:`,
      tagLines,
      `related_notes: []`,
      `key_person: "${this.escapeYaml(note.keyPerson)}"`,
      `plugin_version: "1.0.0"`,
      "---",
    ].join("\n");
  }

  private buildBody(note: VideoNote): string {
    const parts: string[] = [];

    // Core idea
    parts.push(`## Core idea\n\n${note.coreIdea}`);

    // Key concepts
    if (note.keyConcepts.length > 0) {
      const conceptLines = note.keyConcepts
        .map(
          (c) =>
            `### ${c.name}\n\n${c.definition}${c.importance ? ` — *${c.importance}*` : ""}`
        )
        .join("\n\n");
      parts.push(`## Key concepts\n\n${conceptLines}`);
    }

    // Steps
    if (note.steps.length > 0) {
      const stepLines = note.steps
        .map((s, i) => `${i + 1}. ${s}`)
        .join("\n");
      parts.push(`## Steps / workflow\n\n${stepLines}`);
    }

    // Insights
    if (note.insights.length > 0) {
      const insightLines = note.insights.map((i) => `- ${i}`).join("\n");
      parts.push(`## Insights & surprises\n\n${insightLines}`);
    }

    // Actionables
    if (note.actionables.length > 0) {
      const actionLines = note.actionables.map((a) => `- ${a}`).join("\n");
      parts.push(`## Actionable takeaways\n\n${actionLines}`);
    }

    // Quotes
    if (note.quotes.length > 0) {
      const quoteLines = note.quotes.map((q) => `> ${q}`).join("\n\n");
      parts.push(`## Quotes\n\n${quoteLines}`);
    }

    // Connections
    if (note.connections.length > 0) {
      const connLines = note.connections.map((c) => `- ${c}`).join("\n");
      parts.push(`## Connections\n\n${connLines}`);
    }

    // Raw notes area
    parts.push(`## Raw notes\n\n<!-- Add your own notes here -->`);

    // Raw transcript (optional)
    if (
      this.settings.notes.includeRawTranscript &&
      note.rawTranscript
    ) {
      parts.push(
        `## Full transcript\n\n<details>\n<summary>Expand transcript</summary>\n\n${note.rawTranscript}\n\n</details>`
      );
    }

    return parts.join("\n\n---\n\n");
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  }

  private formatDate(iso: string): string {
    // Already formatted — just return as-is
    return iso;
  }

  private escapeYaml(text: string): string {
    return text.replace(/"/g, '\\"');
  }
}
