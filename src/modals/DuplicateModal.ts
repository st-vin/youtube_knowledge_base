import { App, Modal, Setting } from "obsidian";

export type DuplicateAction = "overwrite" | "new" | "cancel";

export class DuplicateModal extends Modal {
  private existingPath: string;
  private onChoice: (action: DuplicateAction) => void;

  constructor(
    app: App,
    existingPath: string,
    onChoice: (action: DuplicateAction) => void
  ) {
    super(app);
    this.existingPath = existingPath;
    this.onChoice = onChoice;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("ytkb-duplicate-modal");

    contentEl.createEl("h2", { text: "Note already exists" });
    contentEl.createEl("p", {
      text: `A note for this video already exists at:`,
      cls: "ytkb-modal-desc",
    });
    contentEl.createEl("code", {
      text: this.existingPath,
      cls: "ytkb-existing-path",
    });
    contentEl.createEl("p", {
      text: "What would you like to do?",
      cls: "ytkb-modal-desc",
    });

    const btnRow = contentEl.createDiv({ cls: "ytkb-btn-row" });

    const cancelBtn = btnRow.createEl("button", {
      text: "Cancel",
      cls: "ytkb-cancel-btn",
    });
    cancelBtn.ariaLabel = "Cancel";
    cancelBtn.addEventListener("click", () => {
      this.close();
      this.onChoice("cancel");
    });

    const newBtn = btnRow.createEl("button", {
      text: "Create new version",
      cls: "ytkb-secondary-btn",
    });
    newBtn.ariaLabel = "Create a new versioned note";
    newBtn.addEventListener("click", () => {
      this.close();
      this.onChoice("new");
    });

    const overwriteBtn = btnRow.createEl("button", {
      text: "Overwrite existing",
      cls: "ytkb-danger-btn",
    });
    overwriteBtn.ariaLabel = "Overwrite the existing note";
    overwriteBtn.addEventListener("click", () => {
      this.close();
      this.onChoice("overwrite");
    });

    // Keyboard nav: Escape = cancel (already built into Modal)
    cancelBtn.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
