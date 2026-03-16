import { App, TFile, normalizePath } from "obsidian";
import type { VideoNote, YTKBSettings } from "../types";

export class VaultManager {
  private app: App;
  private settings: YTKBSettings;

  constructor(app: App, settings: YTKBSettings) {
    this.app = app;
    this.settings = settings;
  }

  // ─── Target folder ────────────────────────────────────────────────────────────

  getTargetFolder(note: VideoNote): string {
    const root = this.settings.vault.rootFolder;
    const strategy = this.settings.vault.folderStrategy;

    switch (strategy) {
      case "flat":
        return root;

      case "by-channel":
        return normalizePath(`${root}/${this.slugify(note.channel)}`);

      case "by-date": {
        const [year, month] = note.dateWatched.split("-");
        return normalizePath(`${root}/${year}/${month}`);
      }

      case "by-category":
      default: {
        const sub =
          this.settings.vault.categoryFolderMap[note.category] ??
          "06-Uncategorized";
        return normalizePath(`${root}/${sub}`);
      }
    }
  }

  // ─── File creation ────────────────────────────────────────────────────────────

  async writeNote(
    folderPath: string,
    filename: string,
    content: string
  ): Promise<{ file: TFile; existed: boolean }> {
    if (this.settings.vault.autoCreateFolders) {
      await this.ensureFolder(folderPath);
    }

    const fullPath = normalizePath(`${folderPath}/${filename}`);
    const existing = this.app.vault.getAbstractFileByPath(fullPath);

    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      return { file: existing, existed: true };
    }

    const file = await this.app.vault.create(fullPath, content);
    return { file, existed: false };
  }

  // ─── Duplicate detection ──────────────────────────────────────────────────────

  findExistingNote(videoId: string): TFile | null {
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (fm && fm["video_id"] === videoId) {
        return file;
      }
    }
    return null;
  }

  // ─── MOC update ───────────────────────────────────────────────────────────────

  async updateMOC(note: VideoNote, noteFilename: string): Promise<void> {
    const mocFolder = normalizePath(this.settings.vault.mocFolder);
    await this.ensureFolder(mocFolder);

    const categoryLabel = this.categoryLabel(note.category);
    const mocPath = normalizePath(`${mocFolder}/MOC-${categoryLabel}.md`);
    const existing = this.app.vault.getAbstractFileByPath(mocPath);

    const entry = `- [[${noteFilename.replace(".md", "")}]] — ${note.coreIdea.slice(0, 120)} \`#${note.category}\``;

    if (existing instanceof TFile) {
      await this.app.vault.process(existing, (content) => {
        return content + "\n" + entry;
      });
    } else {
      const header = `# ${categoryLabel} — Map of Content\n\nAll notes in the **${categoryLabel}** category.\n\n`;
      await this.app.vault.create(mocPath, header + entry + "\n");
    }
  }

  // ─── Index note ───────────────────────────────────────────────────────────────

  async updateIndex(note: VideoNote, noteFilename: string): Promise<void> {
    if (!this.settings.vault.maintainIndex) return;

    const root = normalizePath(this.settings.vault.rootFolder);
    await this.ensureFolder(root);

    const indexPath = normalizePath(`${root}/_INDEX.md`);
    const existing = this.app.vault.getAbstractFileByPath(indexPath);

    const row = `| [[${noteFilename.replace(".md", "")}\\|${this.escapeTable(note.title)}]] | ${this.escapeTable(note.channel)} | ${note.category} | ${note.dateWatched} | ${note.status} |`;

    if (existing instanceof TFile) {
      await this.app.vault.process(existing, (content) => {
        return content + "\n" + row;
      });
    } else {
      const header = [
        "# YouTube Knowledge Base — Index",
        "",
        "> Auto-maintained by YT Knowledge Base. Do not edit the table rows manually.",
        "",
        "| Note | Channel | Category | Date | Status |",
        "|------|---------|----------|------|--------|",
        row,
        "",
      ].join("\n");
      await this.app.vault.create(indexPath, header);
    }
  }

  // ─── Search guide ──────────────────────────────────────────────────────────────

  async ensureSearchGuide(): Promise<void> {
    const root = normalizePath(this.settings.vault.rootFolder);
    await this.ensureFolder(root);

    const guidePath = normalizePath(`${root}/_SEARCH_GUIDE.md`);
    if (this.app.vault.getAbstractFileByPath(guidePath)) return;

    const content = [
      "# Search guide",
      "",
      "Use these Dataview queries to search your knowledge base.",
      "Requires the [Dataview](https://github.com/blacksmithgu/obsidian-dataview) community plugin.",
      "",
      "## All notes",
      "",
      "```dataview",
      `TABLE title, channel, key_person, category, date_watched`,
      `FROM "${this.settings.vault.rootFolder}"`,
      `WHERE video_id != null`,
      `SORT date_watched DESC`,
      "```",
      "",
      "## By category",
      "",
      "```dataview",
      `TABLE title, channel, date_watched`,
      `FROM "${this.settings.vault.rootFolder}"`,
      `WHERE category = "ai"`,
      `SORT date_watched DESC`,
      "```",
      "",
      "## Unprocessed notes",
      "",
      "```dataview",
      `TABLE title, channel, date_watched`,
      `FROM "${this.settings.vault.rootFolder}"`,
      `WHERE status = "raw"`,
      `SORT date_watched DESC`,
      "```",
      "",
      "## By tag",
      "",
      "```dataview",
      `TABLE title, channel, date_watched`,
      `FROM "${this.settings.vault.rootFolder}"`,
      `WHERE contains(tags, "ai-agents")`,
      `SORT date_watched DESC`,
      "```",
    ].join("\n");

    await this.app.vault.create(guidePath, content);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!this.app.vault.getAbstractFileByPath(normalized)) {
      await this.app.vault.createFolder(normalized);
    }
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
  }

  private escapeTable(text: string): string {
    return text.replace(/\|/g, "\\|");
  }

  private categoryLabel(category: string): string {
    const labels: Record<string, string> = {
      ai: "AI & LLM",
      programming: "Programming",
      career: "Career",
      mindset: "Mindset & Productivity",
      interests: "Interests & Society",
      uncategorized: "Uncategorized",
    };
    return labels[category] ?? "Uncategorized";
  }
}
