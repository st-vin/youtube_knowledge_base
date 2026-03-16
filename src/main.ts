import { Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, YTKBSettingTab } from "./settings";
import type { AIProviderID, ConnectionResult, YTKBSettings } from "./types";
import { ProcessingPipeline, DuplicateNoteError } from "./notes/ProcessingPipeline";
import { NoTranscriptError } from "./transcript/YouTubeClient";
import { UrlInputModal } from "./modals/UrlInputModal";
import { DuplicateModal } from "./modals/DuplicateModal";
import { BatchModal } from "./modals/BatchModal";
import { createProvider } from "./providers/AIProvider";
import type { ProcessingOptions } from "./types";

export default class YTKBPlugin extends Plugin {
  settings: YTKBSettings = DEFAULT_SETTINGS;

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new YTKBSettingTab(this.app, this));

    // Ribbon icon
    this.addRibbonIcon("youtube", "Process YouTube video", () => {
      this.openUrlModal();
    });

    // Commands
    this.addCommand({
      id: "process-url",
      name: "Process YouTube URL",
      callback: () => this.openUrlModal(),
    });

    this.addCommand({
      id: "process-clipboard",
      name: "Process URL from clipboard",
      callback: () => this.processFromClipboard(),
    });

    this.addCommand({
      id: "batch-process",
      name: "Batch process URLs",
      callback: () => this.openBatchModal(),
    });

    this.addCommand({
      id: "reprocess-note",
      name: "Re-process current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        const cache = this.app.metadataCache.getFileCache(file);
        const hasVideoId = !!cache?.frontmatter?.["video_id"];
        if (!checking && hasVideoId) {
          void this.reprocessCurrentNote(file);
        }
        return hasVideoId;
      },
    });
  }

  onunload(): void {
    // Obsidian cleans up all registered resources automatically
  }

  // ─── Settings ─────────────────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
    // Deep-merge nested objects so new defaults are not lost on upgrade
    this.settings.providers = Object.assign(
      {},
      DEFAULT_SETTINGS.providers,
      this.settings.providers
    );
    this.settings.vault = Object.assign(
      {},
      DEFAULT_SETTINGS.vault,
      this.settings.vault
    );
    this.settings.notes = Object.assign(
      {},
      DEFAULT_SETTINGS.notes,
      this.settings.notes
    );
    this.settings.tags = Object.assign(
      {},
      DEFAULT_SETTINGS.tags,
      this.settings.tags
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ─── Provider test (called from SettingTab) ───────────────────────────────────

  async testProviderConnection(id: AIProviderID): Promise<ConnectionResult> {
    const provider = createProvider(id, this.settings);
    return provider.testConnection();
  }

  // ─── URL modal ────────────────────────────────────────────────────────────────

  private openUrlModal(): void {
    new UrlInputModal(this.app, this.settings, (result) => {
      void this.runPipeline({
        url: result.url,
        promptId: result.promptId,
        categoryOverride: result.categoryOverride,
        manualTranscript: result.manualTranscript,
      });
    }).open();
  }

  // ─── Clipboard ────────────────────────────────────────────────────────────────

  private processFromClipboard(): void {
    void navigator.clipboard.readText().then((text) => {
      const url = text.trim();
      if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
        new Notice(
          "Clipboard does not contain a YouTube URL. Copy a YouTube URL and try again."
        );
        return;
      }
      void this.runPipeline({
        url,
        promptId: this.settings.notes.defaultPromptId,
      });
    }).catch(() => {
      new Notice("Could not read clipboard. Please use 'Process YouTube URL' instead.");
    });
  }

  // ─── Batch ────────────────────────────────────────────────────────────────────

  private openBatchModal(): void {
    new BatchModal(this.app, this.settings, (result) => {
      void this.runBatch(result.urls, result.promptId);
    }).open();
  }

  private async runBatch(urls: string[], promptId: string): Promise<void> {
    const total = urls.length;
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      new Notice(`Processing ${i + 1}/${total}: ${this.shortenUrl(url)}`);
      try {
        await this.runPipeline(
          { url, promptId },
          false // suppress per-note success notice in batch
        );
        succeeded++;
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : "Unknown error";
        new Notice(`Failed (${i + 1}/${total}): ${msg}`, 6000);
      }
      // Rate limit: 1 per 3 seconds
      if (i < urls.length - 1) {
        await sleep(3000);
      }
    }

    new Notice(
      `Batch complete — ${succeeded} succeeded, ${failed} failed.`,
      6000
    );
  }

  // ─── Re-process ───────────────────────────────────────────────────────────────

  private async reprocessCurrentNote(file: TFile): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(file);
    const url = cache?.frontmatter?.["url"] as string | undefined;

    if (!url) {
      new Notice("Could not find a URL in this note's frontmatter.");
      return;
    }

    new UrlInputModal(
      this.app,
      this.settings,
      (result) => {
        void this.runPipeline({
          url: result.url,
          promptId: result.promptId,
          categoryOverride: result.categoryOverride,
          manualTranscript: result.manualTranscript,
          forceOverwrite: true,
        });
      },
      { prefilledUrl: url }
    ).open();
  }

  // ─── Core pipeline runner ─────────────────────────────────────────────────────

  private async runPipeline(
    options: ProcessingOptions,
    showSuccessNotice = true
  ): Promise<void> {
    const pipeline = new ProcessingPipeline(this.app, this.settings);

    // Status bar item for progress feedback
    const statusItem = this.addStatusBarItem();
    statusItem.setText("⏳ YT Knowledge Base: processing…");

    const onStatus = (msg: string): void => {
      statusItem.setText(`⏳ ${msg}`);
    };

    try {
      const result = await pipeline.process(options, onStatus);

      statusItem.remove();

      if (showSuccessNotice) {
        const notice = new Notice(
          `✓ Note created: ${result.note.title.slice(0, 60)}`,
          8000
        );
        // Make the notice clickable to open the note
        notice.noticeEl.addEventListener("click", () => {
          const file = this.app.vault.getAbstractFileByPath(result.filePath);
          if (file instanceof TFile) {
            void this.app.workspace.getLeaf("tab").openFile(file);
          }
        });
        notice.noticeEl.style.cursor = "pointer";
        notice.noticeEl.title = "Click to open note";
      }
    } catch (e) {
      statusItem.remove();

      // ── NoTranscriptError: auto-fetch failed — reopen modal for manual paste ──
      if (e instanceof NoTranscriptError) {
        const reason = e.message;
        new Notice(`Transcript unavailable: ${reason}`, 6000);

        // Only offer manual paste for cases where it actually helps
        const manualPasteable =
          e.reason === "NO_CAPTIONS" ||
          e.reason === "AGE_RESTRICTED" ||
          e.reason === "HTTP_ERROR";

        if (manualPasteable) {
          new UrlInputModal(
            this.app,
            this.settings,
            (result) => {
              void this.runPipeline({
                url: result.url,
                promptId: result.promptId,
                categoryOverride: result.categoryOverride,
                manualTranscript: result.manualTranscript,
              });
            },
            {
              prefilledUrl: options.url,
              openManualTranscript: true,
              hint: reason,
            }
          ).open();
        }
        return;
      }

      // ── DuplicateNoteError: ask user what to do ────────────────────────────
      if (e instanceof DuplicateNoteError) {
        new DuplicateModal(this.app, e.existingPath, (action) => {
          if (action === "cancel") return;
          if (action === "overwrite") {
            void this.runPipeline({ ...options, forceOverwrite: true });
          } else {
            void this.runPipeline({
              ...options,
              forceOverwrite: false,
              url: options.url + `#v${Date.now()}`,
            });
          }
        }).open();
        return;
      }

      // ── All other errors ───────────────────────────────────────────────────
      const msg = e instanceof Error ? e.message : "Unknown error";
      new Notice(`YT Knowledge Base: ${msg}`, 8000);
      console.error("[YT Knowledge Base]", e);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private shortenUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.hostname + u.pathname.slice(0, 20);
    } catch {
      return url.slice(0, 40);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
