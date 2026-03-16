import { App, Modal, Notice, Setting } from "obsidian";
import type { VideoCategory, YTKBSettings } from "../types";
import { BUILTIN_PROMPTS } from "../prompts/builtinPrompts";
import { YouTubeClient } from "../transcript/YouTubeClient";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface UrlInputResult {
  url: string;
  promptId: string;
  categoryOverride?: VideoCategory;
  manualTranscript?: string;
}

/**
 * Options for pre-populating the modal after an auto-fetch failure.
 * When openManualTranscript is true the modal opens with the advanced section
 * expanded and the manual transcript textarea visible, so the user can paste
 * without hunting for it.
 */
export interface UrlInputOptions {
  prefilledUrl?: string;
  openManualTranscript?: boolean;
  /** Human-readable reason shown in a hint banner at the top of the modal */
  hint?: string;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export class UrlInputModal extends Modal {
  private settings: YTKBSettings;
  private onSubmit: (result: UrlInputResult) => void;
  private opts: UrlInputOptions;

  // Form state — preserved across re-renders (toggling sections)
  private url: string;
  private promptId: string;
  private categoryOverride: VideoCategory | "" = "";
  private manualTranscript = "";
  private showAdvanced: boolean;
  private showManualTranscript: boolean;

  constructor(
    app: App,
    settings: YTKBSettings,
    onSubmit: (result: UrlInputResult) => void,
    opts: UrlInputOptions = {}
  ) {
    super(app);
    this.settings = settings;
    this.onSubmit = onSubmit;
    this.opts = opts;

    // Initialise state from options
    this.url = opts.prefilledUrl ?? "";
    this.promptId = settings.notes.defaultPromptId;
    this.showAdvanced = opts.openManualTranscript ?? false;
    this.showManualTranscript = opts.openManualTranscript ?? false;
  }

  onOpen(): void {
    this.modalEl.addClass("ytkb-url-modal");
    this.render();
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Process YouTube URL" });

    // ── Hint banner (shown after auto-fetch failure) ───────────────────────────
    if (this.opts.hint) {
      const banner = contentEl.createDiv({ cls: "ytkb-hint-banner" });
      const icon = banner.createSpan({ cls: "ytkb-hint-icon", text: "⚠" });
      icon.ariaLabel = "Warning";
      banner.createSpan({ text: this.opts.hint });
    }

    // ── URL field ──────────────────────────────────────────────────────────────
    new Setting(contentEl)
      .setName("YouTube URL")
      .addText((text) => {
        text
          .setPlaceholder("https://youtube.com/watch?v=...")
          .setValue(this.url)
          .onChange((v) => {
            this.url = v.trim();
            this.updateSubmitButton();
          });

        text.inputEl.addClass("ytkb-url-input");
        text.inputEl.ariaLabel = "YouTube URL";
        text.inputEl.setAttribute("autocomplete", "off");

        // Submit on Enter
        text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter") this.submit();
        });

        // Auto-populate from clipboard when modal opens fresh (no prefill)
        if (!this.opts.prefilledUrl) {
          void navigator.clipboard
            .readText()
            .then((clip) => {
              const isYT =
                clip.includes("youtube.com/watch") ||
                clip.includes("youtu.be/") ||
                clip.includes("youtube.com/shorts") ||
                clip.includes("youtube.com/live");
              if (isYT && !this.url) {
                text.setValue(clip.trim());
                this.url = clip.trim();
                this.updateSubmitButton();
              }
            })
            .catch(() => {
              // Clipboard access denied — not a problem
            });
        }

        // Focus: URL field when fresh, transcript area when in manual mode
        if (!this.showManualTranscript) {
          window.setTimeout(() => text.inputEl.focus(), 50);
        }
      });

    // ── Advanced options toggle ────────────────────────────────────────────────
    const advWrap = contentEl.createDiv({ cls: "ytkb-advanced-toggle" });
    const advBtn = advWrap.createEl("button", {
      text: this.showAdvanced ? "▾ Hide options" : "▸ Show options",
      cls: "ytkb-toggle-btn",
    });
    advBtn.ariaLabel = "Toggle advanced options";
    advBtn.addEventListener("click", () => {
      this.showAdvanced = !this.showAdvanced;
      if (!this.showAdvanced) this.showManualTranscript = false;
      this.render();
    });

    if (this.showAdvanced) {
      this.renderAdvanced(contentEl);
    }

    // ── Action row ─────────────────────────────────────────────────────────────
    const btnRow = contentEl.createDiv({ cls: "ytkb-btn-row" });

    const cancelBtn = btnRow.createEl("button", {
      text: "Cancel",
      cls: "ytkb-cancel-btn",
    });
    cancelBtn.ariaLabel = "Cancel";
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = btnRow.createEl("button", {
      text: "Process video",
      cls: "ytkb-submit-btn",
    });
    submitBtn.id = "ytkb-submit";
    submitBtn.ariaLabel = "Process video";
    submitBtn.disabled = !this.url;
    submitBtn.addEventListener("click", () => this.submit());
    submitBtn.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") this.submit();
    });
  }

  // ─── Advanced section ─────────────────────────────────────────────────────────

  private renderAdvanced(contentEl: HTMLElement): void {
    const advEl = contentEl.createDiv({ cls: "ytkb-advanced" });

    // Prompt selector
    const allPrompts = [...BUILTIN_PROMPTS, ...this.settings.customPrompts];
    new Setting(advEl)
      .setName("Extraction prompt")
      .setDesc("Which prompt template to use.")
      .addDropdown((drop) => {
        drop.addOption("auto", "Auto (detect from category)");
        for (const p of allPrompts) {
          drop.addOption(p.id, p.name);
        }
        drop.setValue(this.promptId).onChange((v) => {
          this.promptId = v;
        });
      });

    // Category override
    new Setting(advEl)
      .setName("Category override")
      .setDesc("Force a specific category instead of auto-detection.")
      .addDropdown((drop) => {
        drop
          .addOption("", "Auto-detect")
          .addOption("ai", "AI & LLM")
          .addOption("programming", "Programming")
          .addOption("career", "Career")
          .addOption("mindset", "Mindset & productivity")
          .addOption("interests", "Interests & society")
          .addOption("uncategorized", "Uncategorized")
          .setValue(this.categoryOverride)
          .onChange((v) => {
            this.categoryOverride = v as VideoCategory | "";
          });
      });

    // Manual transcript toggle
    const tWrap = advEl.createDiv({ cls: "ytkb-transcript-toggle" });
    const tBtn = tWrap.createEl("button", {
      text: this.showManualTranscript
        ? "▾ Hide manual transcript"
        : "▸ Paste transcript manually",
      cls: "ytkb-toggle-btn",
    });
    tBtn.ariaLabel = "Toggle manual transcript input";
    tBtn.addEventListener("click", () => {
      this.showManualTranscript = !this.showManualTranscript;
      this.render();
    });

    if (this.showManualTranscript) {
      this.renderManualTranscript(advEl);
    }
  }

  // ─── Manual transcript section ────────────────────────────────────────────────

  private renderManualTranscript(container: HTMLElement): void {
    const howTo = container.createDiv({ cls: "ytkb-manual-howto" });
    howTo.createEl("p", {
      text: "How to get a transcript from YouTube:",
      cls: "ytkb-manual-howto-title",
    });
    const steps = howTo.createEl("ol", { cls: "ytkb-manual-howto-steps" });
    [
      'Open the video on YouTube',
      'Click the "…" (more) button below the video',
      'Select "Show transcript"',
      'Click the three-dot menu in the transcript panel → "Toggle timestamps" (off)',
      'Select all transcript text and paste it below',
    ].forEach((s) => steps.createEl("li", { text: s }));

    new Setting(container)
      .setName("Transcript text")
      .addTextArea((area) => {
        area
          .setPlaceholder("Paste transcript here…")
          .setValue(this.manualTranscript)
          .onChange((v) => {
            this.manualTranscript = v;
          });
        area.inputEl.rows = 10;
        area.inputEl.addClass("ytkb-transcript-area");
        area.inputEl.ariaLabel = "Manual transcript text";

        // Focus the textarea when it becomes visible
        window.setTimeout(() => area.inputEl.focus(), 50);
      });
  }

  // ─── Submit ───────────────────────────────────────────────────────────────────

  private updateSubmitButton(): void {
    const btn =
      this.contentEl.querySelector<HTMLButtonElement>("#ytkb-submit");
    if (btn) btn.disabled = !this.url;
  }

  private submit(): void {
    const trimmed = this.url.trim();

    if (!trimmed) {
      new Notice("Please enter a YouTube URL.");
      return;
    }

    if (!trimmed.includes("youtube.com") && !trimmed.includes("youtu.be")) {
      new Notice(
        "That doesn't look like a YouTube URL. Please check and try again."
      );
      return;
    }

    const videoId = YouTubeClient.extractVideoId(trimmed);
    if (!videoId) {
      new Notice("Could not extract a video ID from that URL.");
      return;
    }

    this.close();
    this.onSubmit({
      url: trimmed,
      promptId: this.promptId,
      categoryOverride: this.categoryOverride || undefined,
      manualTranscript: this.manualTranscript.trim() || undefined,
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
