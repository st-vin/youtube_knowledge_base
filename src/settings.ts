import { App, Notice, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type YTKBPlugin from "./main";
import type {
  AIProviderID,
  FolderStrategy,
  NoteStatus,
  Prompt,
  YTKBSettings,
} from "./types";
import { BUILTIN_PROMPTS } from "./prompts/builtinPrompts";

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: YTKBSettings = {
  version: "1.0.0",
  activeProvider: "anthropic",
  providers: {
    anthropic: { apiKey: "", model: "claude-sonnet-4-6" },
    openai: { apiKey: "", model: "gpt-4o" },
    gemini: { apiKey: "", model: "gemini-2.0-flash" },
    ollama: { baseUrl: "http://localhost:11434", model: "llama3" },
    cerebras: { apiKey: "", model: "llama3.1-8b" },
    groq: { apiKey: "", model: "openai/gpt-oss-120b", reasoningEffort: "medium" },
  },
  // ↑ Raised from 2000 — old ceiling was forcing the model to compress into generics
  maxTokens: 8000,
  // ↑ Raised from 0.3 — extraction of non-obvious insights needs interpretive latitude
  temperature: 0.5,
  vault: {
    rootFolder: "YouTube Knowledge Base",
    mocFolder: "YouTube Knowledge Base/99-MOC",
    autoCreateFolders: true,
    folderStrategy: "by-category",
    maintainIndex: true,
    categoryFolderMap: {
      ai: "01-AI-Agents",
      programming: "02-Programming-Tools",
      career: "03-Career",
      mindset: "04-Mindset-Productivity",
      interests: "05-Interests-Society",
      uncategorized: "06-Uncategorized",
    },
  },
  notes: {
    defaultPromptId: "universal",
    autoDetectCategory: true,
    includeRawTranscript: false,
    enableTwoPassSchemaExtraction: true,
    defaultStatus: "raw",
    dateFormat: "YYYY-MM-DD",
    filenameTemplate: "{{date}}-{{title-slug}}",
  },
  tags: {
    prefix: "",
    alwaysAddSourceTag: true,
    autoSuggest: true,
    customTags: [],
  },
  customPrompts: [],
};

// ─── Settings tab ─────────────────────────────────────────────────────────────

export class YTKBSettingTab extends PluginSettingTab {
  plugin: YTKBPlugin;

  constructor(app: App, plugin: YTKBPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("ytkb-settings");

    this.renderProviders(containerEl);
    this.renderVault(containerEl);
    this.renderNotes(containerEl);
    this.renderTags(containerEl);
    this.renderPrompts(containerEl);
  }

  // ── AI providers ────────────────────────────────────────────────────────────

  private renderProviders(containerEl: HTMLElement): void {
    new Setting(containerEl).setHeading().setName("AI providers");

    // Active provider selector
    new Setting(containerEl)
      .setName("Active provider")
      .setDesc("Which AI provider to use for all extractions.")
      .addDropdown((drop) => {
        drop
          .addOption("anthropic", "Anthropic Claude")
          .addOption("openai", "OpenAI")
          .addOption("gemini", "Google Gemini")
          .addOption("cerebras", "Cerebras (fastest)")
          .addOption("groq", "Groq (reasoning)")
          .addOption("ollama", "Ollama (local)")
          .setValue(this.plugin.settings.activeProvider)
          .onChange(async (value) => {
            this.plugin.settings.activeProvider = value as AIProviderID;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    // Anthropic
    new Setting(containerEl)
      .setHeading()
      .setName("Anthropic Claude")
      .setClass(
        this.plugin.settings.activeProvider === "anthropic"
          ? "ytkb-provider-active"
          : "ytkb-provider-inactive"
      );

    this.addApiKeyField(
      containerEl,
      "Anthropic API key",
      "Get your key at console.anthropic.com.",
      this.plugin.settings.providers.anthropic.apiKey,
      async (v) => {
        this.plugin.settings.providers.anthropic.apiKey = v;
        await this.plugin.saveSettings();
      }
    );

    new Setting(containerEl)
      .setName("Claude model")
      .addDropdown((drop) => {
        drop
          .addOption("claude-sonnet-4-6", "Claude Sonnet 4.6 (recommended)")
          .addOption("claude-opus-4-6", "Claude Opus 4.6 (most capable)")
          .addOption("claude-haiku-4-5-20251001", "Claude Haiku 4.5 (fastest)")
          .setValue(this.plugin.settings.providers.anthropic.model)
          .onChange(async (v) => {
            this.plugin.settings.providers.anthropic.model = v;
            await this.plugin.saveSettings();
          });
      })
      .addButton((btn) => {
        btn
          .setButtonText("Test connection")
          .setClass("ytkb-test-btn")
          .onClick(() => this.testConnection("anthropic", btn.buttonEl));
      });

    // OpenAI
    new Setting(containerEl)
      .setHeading()
      .setName("OpenAI")
      .setClass(
        this.plugin.settings.activeProvider === "openai"
          ? "ytkb-provider-active"
          : "ytkb-provider-inactive"
      );

    this.addApiKeyField(
      containerEl,
      "OpenAI API key",
      "Get your key at platform.openai.com.",
      this.plugin.settings.providers.openai.apiKey,
      async (v) => {
        this.plugin.settings.providers.openai.apiKey = v;
        await this.plugin.saveSettings();
      }
    );

    new Setting(containerEl)
      .setName("OpenAI model")
      .addDropdown((drop) => {
        drop
          .addOption("gpt-4o", "GPT-4o (recommended)")
          .addOption("gpt-4o-mini", "GPT-4o mini (faster)")
          .addOption("gpt-4-turbo", "GPT-4 Turbo")
          .setValue(this.plugin.settings.providers.openai.model)
          .onChange(async (v) => {
            this.plugin.settings.providers.openai.model = v;
            await this.plugin.saveSettings();
          });
      })
      .addButton((btn) => {
        btn
          .setButtonText("Test connection")
          .setClass("ytkb-test-btn")
          .onClick(() => this.testConnection("openai", btn.buttonEl));
      });

    // Gemini
    new Setting(containerEl)
      .setHeading()
      .setName("Google Gemini")
      .setClass(
        this.plugin.settings.activeProvider === "gemini"
          ? "ytkb-provider-active"
          : "ytkb-provider-inactive"
      );

    this.addApiKeyField(
      containerEl,
      "Gemini API key",
      "Get your key at aistudio.google.com.",
      this.plugin.settings.providers.gemini.apiKey,
      async (v) => {
        this.plugin.settings.providers.gemini.apiKey = v;
        await this.plugin.saveSettings();
      }
    );

    new Setting(containerEl)
      .setName("Gemini model")
      .addDropdown((drop) => {
        drop
          .addOption("gemini-2.0-flash", "Gemini 2.0 Flash (recommended)")
          .addOption("gemini-1.5-pro", "Gemini 1.5 Pro")
          .addOption("gemini-1.5-flash", "Gemini 1.5 Flash")
          .setValue(this.plugin.settings.providers.gemini.model)
          .onChange(async (v) => {
            this.plugin.settings.providers.gemini.model = v;
            await this.plugin.saveSettings();
          });
      })
      .addButton((btn) => {
        btn
          .setButtonText("Test connection")
          .setClass("ytkb-test-btn")
          .onClick(() => this.testConnection("gemini", btn.buttonEl));
      });

    // Cerebras
    new Setting(containerEl)
      .setHeading()
      .setName("Cerebras")
      .setClass(
        this.plugin.settings.activeProvider === "cerebras"
          ? "ytkb-provider-active"
          : "ytkb-provider-inactive"
      );

    this.addApiKeyField(
      containerEl,
      "Cerebras API key",
      "Get your free key at cloud.cerebras.ai.",
      this.plugin.settings.providers.cerebras.apiKey,
      async (v) => {
        this.plugin.settings.providers.cerebras.apiKey = v;
        await this.plugin.saveSettings();
      }
    );

    new Setting(containerEl)
      .setName("Cerebras model")
      .setDesc(
        "Cerebras runs at 2,000–3,000 tokens/s — noticeably faster than other providers."
      )
      .addDropdown((drop) => {
        drop
          .addOption("llama3.1-8b", "Llama 3.1 8B (fastest, ~2200 tok/s)")
          .addOption("gpt-oss-120b", "GPT OSS 120B (most capable, ~3000 tok/s)")
          .addOption(
            "qwen-3-235b-a22b-instruct-2507",
            "Qwen 3 235B (preview, ~1400 tok/s)"
          )
          .addOption("zai-glm-4.7", "GLM 4.7 (preview, ~1000 tok/s)")
          .setValue(this.plugin.settings.providers.cerebras.model)
          .onChange(async (v) => {
            this.plugin.settings.providers.cerebras.model = v;
            await this.plugin.saveSettings();
          });
      })
      .addButton((btn) => {
        btn
          .setButtonText("Test connection")
          .setClass("ytkb-test-btn")
          .onClick(() => this.testConnection("cerebras", btn.buttonEl));
      });

    // Groq
    new Setting(containerEl)
      .setHeading()
      .setName("Groq")
      .setClass(
        this.plugin.settings.activeProvider === "groq"
          ? "ytkb-provider-active"
          : "ytkb-provider-inactive"
      );

    this.addApiKeyField(
      containerEl,
      "Groq API key",
      "Get your free key at console.groq.com.",
      this.plugin.settings.providers.groq.apiKey,
      async (v) => {
        this.plugin.settings.providers.groq.apiKey = v;
        await this.plugin.saveSettings();
      }
    );

    new Setting(containerEl)
      .setName("Groq model")
      .setDesc(
        "gpt-oss-120b is a reasoning model — it thinks before answering. Reasoning effort controls how long it thinks."
      )
      .addDropdown((drop) => {
        drop
          .addOption("openai/gpt-oss-120b", "GPT OSS 120B (reasoning, 500 tok/s)")
          .addOption("openai/gpt-oss-20b", "GPT OSS 20B (reasoning, 1000 tok/s)")
          .addOption("llama-3.3-70b-versatile", "Llama 3.3 70B (standard, 2000 tok/s)")
          .addOption("llama3-8b-8192", "Llama 3 8B (fastest, 3000 tok/s)")
          .setValue(this.plugin.settings.providers.groq.model)
          .onChange(async (v) => {
            this.plugin.settings.providers.groq.model = v;
            await this.plugin.saveSettings();
            // Re-render to show/hide reasoning effort control
            this.display();
          });
      })
      .addButton((btn) => {
        btn
          .setButtonText("Test connection")
          .setClass("ytkb-test-btn")
          .onClick(() => this.testConnection("groq", btn.buttonEl));
      });

    // Only show reasoning effort control when the selected model supports it
    const isReasoningModel =
      this.plugin.settings.providers.groq.model === "openai/gpt-oss-120b" ||
      this.plugin.settings.providers.groq.model === "openai/gpt-oss-20b";

    if (isReasoningModel) {
      new Setting(containerEl)
        .setName("Reasoning effort")
        .setDesc(
          "Low = fast, uses fewer thinking tokens. Medium = balanced. High = deepest analysis, slowest."
        )
        .addDropdown((drop) => {
          drop
            .addOption("low", "Low — quick, minimal thinking")
            .addOption("medium", "Medium — balanced (recommended)")
            .addOption("high", "High — deepest analysis, slower")
            .setValue(this.plugin.settings.providers.groq.reasoningEffort)
            .onChange(async (v) => {
              this.plugin.settings.providers.groq.reasoningEffort =
                v as "low" | "medium" | "high";
              await this.plugin.saveSettings();
            });
        });
    }

    // Ollama
    new Setting(containerEl)
      .setHeading()
      .setName("Ollama (local)")
      .setClass(
        this.plugin.settings.activeProvider === "ollama"
          ? "ytkb-provider-active"
          : "ytkb-provider-inactive"
      );

    new Setting(containerEl)
      .setName("Ollama server URL")
      .setDesc("URL of your running Ollama instance.")
      .addText((text) => {
        text
          .setPlaceholder("http://localhost:11434")
          .setValue(this.plugin.settings.providers.ollama.baseUrl)
          .onChange(async (v) => {
            this.plugin.settings.providers.ollama.baseUrl = v;
            await this.plugin.saveSettings();
          });
      })
      .addButton((btn) => {
        btn
          .setButtonText("Test connection")
          .setClass("ytkb-test-btn")
          .onClick(() => this.testConnection("ollama", btn.buttonEl));
      });

    new Setting(containerEl)
      .setName("Ollama model")
      .setDesc("Name of a locally installed Ollama model.")
      .addText((text) => {
        text
          .setPlaceholder("llama3")
          .setValue(this.plugin.settings.providers.ollama.model)
          .onChange(async (v) => {
            this.plugin.settings.providers.ollama.model = v;
            await this.plugin.saveSettings();
          });
      });

    // Shared generation params
    new Setting(containerEl).setHeading().setName("Generation");

    new Setting(containerEl)
      .setName("Max tokens")
      .setDesc("Maximum length of AI response. 4000 recommended for thorough extraction.")
      .addSlider((slider) => {
        slider
          .setLimits(500, 8000, 100)
          .setValue(this.plugin.settings.maxTokens)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.maxTokens = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Temperature")
      .setDesc("0.3–0.5 recommended. Lower = safer/shorter. Higher = more interpretive/creative.")
      .addSlider((slider) => {
        slider
          .setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.temperature)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.temperature = v;
            await this.plugin.saveSettings();
          });
      });
  }

  // ── Vault ────────────────────────────────────────────────────────────────────

  private renderVault(containerEl: HTMLElement): void {
    new Setting(containerEl).setHeading().setName("Vault organization");

    new Setting(containerEl)
      .setName("Root folder")
      .setDesc("Parent folder for all generated notes.")
      .addText((text) => {
        text
          .setPlaceholder("YouTube Knowledge Base")
          .setValue(this.plugin.settings.vault.rootFolder)
          .onChange(async (v) => {
            this.plugin.settings.vault.rootFolder = normalizePath(v);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("MOC folder")
      .setDesc("Where Map of Content files are stored.")
      .addText((text) => {
        text
          .setPlaceholder("YouTube Knowledge Base/99-MOC")
          .setValue(this.plugin.settings.vault.mocFolder)
          .onChange(async (v) => {
            this.plugin.settings.vault.mocFolder = normalizePath(v);
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Folder strategy")
      .setDesc("How notes are organized into subfolders.")
      .addDropdown((drop) => {
        drop
          .addOption("by-category", "By category (AI, Career, etc.)")
          .addOption("flat", "Flat (all in root folder)")
          .addOption("by-channel", "By channel name")
          .addOption("by-date", "By date (YYYY/MM)")
          .setValue(this.plugin.settings.vault.folderStrategy)
          .onChange(async (v) => {
            this.plugin.settings.vault.folderStrategy = v as FolderStrategy;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Auto-create folders")
      .setDesc("Create category folders automatically if they don't exist.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.vault.autoCreateFolders)
          .onChange(async (v) => {
            this.plugin.settings.vault.autoCreateFolders = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Maintain index note")
      .setDesc("Keep _INDEX.md updated with all processed videos.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.vault.maintainIndex)
          .onChange(async (v) => {
            this.plugin.settings.vault.maintainIndex = v;
            await this.plugin.saveSettings();
          });
      });
  }

  // ── Note templates ────────────────────────────────────────────────────────────

  private renderNotes(containerEl: HTMLElement): void {
    new Setting(containerEl).setHeading().setName("Note generation");

    const allPrompts = [
      ...BUILTIN_PROMPTS,
      ...this.plugin.settings.customPrompts,
    ];

    new Setting(containerEl)
      .setName("Default prompt")
      .setDesc("Prompt used when no category is auto-detected.")
      .addDropdown((drop) => {
        for (const p of allPrompts) {
          drop.addOption(p.id, p.name);
        }
        drop
          .setValue(this.plugin.settings.notes.defaultPromptId)
          .onChange(async (v) => {
            this.plugin.settings.notes.defaultPromptId = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Auto-detect category")
      .setDesc("Let AI determine the video category and prompt automatically.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.notes.autoDetectCategory)
          .onChange(async (v) => {
            this.plugin.settings.notes.autoDetectCategory = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Default note status")
      .addDropdown((drop) => {
        drop
          .addOption("raw", "Raw")
          .addOption("reviewing", "Reviewing")
          .addOption("processed", "Processed")
          .setValue(this.plugin.settings.notes.defaultStatus)
          .onChange(async (v) => {
            this.plugin.settings.notes.defaultStatus = v as NoteStatus;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Include raw transcript")
      .setDesc("Append the full transcript at the bottom of each note.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.notes.includeRawTranscript)
          .onChange(async (v) => {
            this.plugin.settings.notes.includeRawTranscript = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Two-pass extraction (quality mode)")
      .setDesc(
        "For long/dense technical videos, run two AI passes (analysis + archival) and merge results to reduce missing/empty sections."
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.notes.enableTwoPassSchemaExtraction)
          .onChange(async (v) => {
            this.plugin.settings.notes.enableTwoPassSchemaExtraction = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Filename template")
      .setDesc("Supports: {{date}}, {{title-slug}}, {{channel-slug}}.")
      .addText((text) => {
        text
          .setPlaceholder("{{date}}-{{title-slug}}")
          .setValue(this.plugin.settings.notes.filenameTemplate)
          .onChange(async (v) => {
            this.plugin.settings.notes.filenameTemplate = v;
            await this.plugin.saveSettings();
          });
      });
  }

  // ── Tags ──────────────────────────────────────────────────────────────────────

  private renderTags(containerEl: HTMLElement): void {
    new Setting(containerEl).setHeading().setName("Tags");

    new Setting(containerEl)
      .setName("Tag prefix")
      .setDesc("Optional prefix for all generated tags (e.g. yt/).")
      .addText((text) => {
        text
          .setPlaceholder("yt/")
          .setValue(this.plugin.settings.tags.prefix)
          .onChange(async (v) => {
            this.plugin.settings.tags.prefix = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Always add #youtube tag")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.tags.alwaysAddSourceTag)
          .onChange(async (v) => {
            this.plugin.settings.tags.alwaysAddSourceTag = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("AI tag suggestions")
      .setDesc("Let AI suggest tags from your taxonomy.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.tags.autoSuggest)
          .onChange(async (v) => {
            this.plugin.settings.tags.autoSuggest = v;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Custom tags")
      .setDesc("Add tags to make available for AI suggestions (one per line).")
      .addTextArea((area) => {
        area
          .setPlaceholder("#my-topic\n#my-project")
          .setValue(this.plugin.settings.tags.customTags.join("\n"))
          .onChange(async (v) => {
            this.plugin.settings.tags.customTags = v
              .split("\n")
              .map((t) => t.trim())
              .filter((t) => t.length > 0);
            await this.plugin.saveSettings();
          });
        area.inputEl.rows = 4;
      });
  }

  // ── Prompt library ────────────────────────────────────────────────────────────

  private renderPrompts(containerEl: HTMLElement): void {
    new Setting(containerEl).setHeading().setName("Prompt library");

    const builtinWrap = containerEl.createDiv({ cls: "ytkb-prompt-list" });
    for (const p of BUILTIN_PROMPTS) {
      const row = builtinWrap.createDiv({ cls: "ytkb-prompt-row" });
      row.createSpan({ cls: "ytkb-prompt-name", text: p.name });
      row.createSpan({ cls: "ytkb-prompt-badge", text: "built-in" });
      row.createSpan({ cls: "ytkb-prompt-desc", text: p.description });
    }

    for (const p of this.plugin.settings.customPrompts) {
      this.renderCustomPromptRow(containerEl, p);
    }

    new Setting(containerEl).addButton((btn) => {
      btn
        .setButtonText("Add custom prompt")
        .setCta()
        .onClick(async () => {
          const newPrompt: Prompt = {
            id: `custom-${Date.now()}`,
            name: "New prompt",
            category: "universal",
            description: "My custom extraction prompt.",
            isBuiltIn: false,
            isEnabled: true,
            userPromptTemplate:
              "Analyze this video transcript and extract key insights.\n\nTranscript:\n{{transcript}}",
          };
          this.plugin.settings.customPrompts.push(newPrompt);
          await this.plugin.saveSettings();
          this.display();
        });
    });
  }

  private renderCustomPromptRow(
    containerEl: HTMLElement,
    prompt: Prompt
  ): void {
    new Setting(containerEl)
      .setName(prompt.name)
      .setDesc(prompt.description)
      .addText((text) => {
        text.setValue(prompt.name).onChange(async (v) => {
          prompt.name = v;
          await this.plugin.saveSettings();
        });
        text.inputEl.ariaLabel = "Prompt name";
      })
      .addTextArea((area) => {
        area.setValue(prompt.userPromptTemplate).onChange(async (v) => {
          prompt.userPromptTemplate = v;
          await this.plugin.saveSettings();
        });
        area.inputEl.rows = 5;
        area.inputEl.ariaLabel = "Prompt template";
      })
      .addButton((btn) => {
        btn
          .setIcon("trash")
          .setClass("ytkb-danger-btn")
          .setTooltip("Delete prompt")
          .onClick(async () => {
            this.plugin.settings.customPrompts =
              this.plugin.settings.customPrompts.filter(
                (p) => p.id !== prompt.id
              );
            await this.plugin.saveSettings();
            this.display();
          });
        btn.buttonEl.ariaLabel = "Delete prompt";
      });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private addApiKeyField(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    value: string,
    onChange: (v: string) => Promise<void>
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        text
          .setPlaceholder("Paste your API key here")
          .setValue(value)
          .onChange(onChange);
        text.inputEl.type = "password";
        text.inputEl.ariaLabel = name;
        text.inputEl.autocomplete = "off";
      });
  }

  private testConnection(
    provider: AIProviderID,
    btnEl: HTMLButtonElement
  ): void {
    const original = btnEl.textContent ?? "Test connection";
    btnEl.textContent = "Testing…";
    btnEl.disabled = true;

    void this.plugin.testProviderConnection(provider).then((result) => {
      if (result.success) {
        btnEl.textContent = `✓ Connected (${result.latencyMs}ms)`;
        btnEl.addClass("ytkb-test-success");
      } else {
        btnEl.textContent = "✗ Failed";
        btnEl.addClass("ytkb-test-fail");
        new Notice(`Connection failed: ${result.error ?? "Unknown error"}`, 5000);
      }
      setTimeout(() => {
        btnEl.textContent = original;
        btnEl.disabled = false;
        btnEl.removeClass("ytkb-test-success");
        btnEl.removeClass("ytkb-test-fail");
      }, 4000);
    });
  }
}
