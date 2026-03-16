import { App, Modal, Notice, Setting } from "obsidian";
import type { YTKBSettings } from "../types";
import { BUILTIN_PROMPTS } from "../prompts/builtinPrompts";
import { TranscriptFetcher } from "../transcript/TranscriptFetcher";

export interface BatchResult {
  urls: string[];
  promptId: string;
}

export class BatchModal extends Modal {
  private settings: YTKBSettings;
  private onSubmit: (result: BatchResult) => void;
  private rawUrls = "";
  private promptId: string;

  constructor(
    app: App,
    settings: YTKBSettings,
    onSubmit: (result: BatchResult) => void
  ) {
    super(app);
    this.settings = settings;
    this.onSubmit = onSubmit;
    this.promptId = settings.notes.defaultPromptId;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("ytkb-batch-modal");

    contentEl.createEl("h2", { text: "Batch process videos" });
    contentEl.createEl("p", {
      text: "Paste one YouTube URL per line. Videos will be processed sequentially.",
      cls: "ytkb-modal-desc",
    });

    new Setting(contentEl)
      .setName("YouTube URLs")
      .addTextArea((area) => {
        area
          .setPlaceholder(
            "https://youtube.com/watch?v=abc123\nhttps://youtu.be/xyz456\n…"
          )
          .onChange((v) => {
            this.rawUrls = v;
            this.updateSubmitState();
          });
        area.inputEl.rows = 10;
        area.inputEl.addClass("ytkb-batch-area");
        area.inputEl.ariaLabel = "YouTube URLs, one per line";
        window.setTimeout(() => area.inputEl.focus(), 50);
      });

    const allPrompts = [...BUILTIN_PROMPTS, ...this.settings.customPrompts];
    new Setting(contentEl)
      .setName("Prompt for all videos")
      .addDropdown((drop) => {
        drop.addOption("auto", "Auto (per category)");
        for (const p of allPrompts) drop.addOption(p.id, p.name);
        drop.setValue(this.promptId).onChange((v) => {
          this.promptId = v;
        });
      });

    const btnRow = contentEl.createDiv({ cls: "ytkb-btn-row" });

    const cancelBtn = btnRow.createEl("button", {
      text: "Cancel",
      cls: "ytkb-cancel-btn",
    });
    cancelBtn.ariaLabel = "Cancel";
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = btnRow.createEl("button", {
      text: "Start batch",
      cls: "ytkb-submit-btn",
    });
    submitBtn.id = "ytkb-batch-submit";
    submitBtn.ariaLabel = "Start batch processing";
    submitBtn.disabled = true;
    submitBtn.addEventListener("click", () => this.submit());
  }

  private updateSubmitState(): void {
    const validUrls = this.parseUrls();
    const btn =
      this.contentEl.querySelector<HTMLButtonElement>("#ytkb-batch-submit");
    if (btn) {
      btn.disabled = validUrls.length === 0;
      btn.textContent =
        validUrls.length > 0
          ? `Start batch (${validUrls.length} video${validUrls.length > 1 ? "s" : ""})`
          : "Start batch";
    }
  }

  private parseUrls(): string[] {
    return this.rawUrls
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => {
        if (!u) return false;
        return TranscriptFetcher.extractVideoId(u) !== null;
      });
  }

  private submit(): void {
    const urls = this.parseUrls();
    if (urls.length === 0) {
      new Notice("No valid YouTube URLs found.");
      return;
    }
    this.close();
    this.onSubmit({ urls, promptId: this.promptId });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
