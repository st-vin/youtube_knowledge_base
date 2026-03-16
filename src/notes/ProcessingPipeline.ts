import { App, Notice } from "obsidian";
import type {
  ProcessingOptions,
  ProcessingResult,
  VideoCategory,
  YTKBSettings,
} from "../types";
import { TranscriptFetcher } from "../transcript/TranscriptFetcher";
import { PromptLibrary } from "../prompts/PromptLibrary";
import { getActiveProvider } from "../providers/AIProvider";
import type { IAIProvider } from "../providers/AIProvider";
import { NoteParser } from "./NoteParser";
import { NoteGenerator } from "./NoteGenerator";
import { VaultManager } from "./VaultManager";

// Transcripts longer than this get processed in two passes:
//   Pass 1 — chunk into thirds, extract bullet summaries from each (cheap)
//   Pass 2 — main extraction runs against the combined summaries (full quality)
// This preserves coverage of the complete video arc rather than just the first half.
const LONG_TRANSCRIPT_THRESHOLD = 40_000;
const TWO_PASS_SCHEMA_THRESHOLD = 18_000;

export class ProcessingPipeline {
  private app: App;
  private settings: YTKBSettings;
  private fetcher: TranscriptFetcher;
  private promptLib: PromptLibrary;
  private parser: NoteParser;
  private generator: NoteGenerator;
  private vault: VaultManager;

  constructor(app: App, settings: YTKBSettings) {
    this.app = app;
    this.settings = settings;
    this.fetcher = new TranscriptFetcher();
    this.promptLib = new PromptLibrary(settings);
    this.parser = new NoteParser();
    this.generator = new NoteGenerator(settings);
    this.vault = new VaultManager(app, settings);
  }

  // ─── Main pipeline ────────────────────────────────────────────────────────────

  async process(
    options: ProcessingOptions,
    onStatus: (msg: string) => void
  ): Promise<ProcessingResult> {
    const provider = getActiveProvider(this.settings);

    if (!provider.isConfigured()) {
      throw new Error(
        `${provider.name} is not configured. Add your API key in plugin settings.`
      );
    }

    // 1. Validate URL
    const videoId = TranscriptFetcher.extractVideoId(options.url);
    if (!videoId) {
      throw new Error(
        "Invalid YouTube URL. Supported formats: youtube.com/watch?v=... or youtu.be/..."
      );
    }

    // 2. Check for duplicate
    const existing = this.vault.findExistingNote(videoId);
    if (existing && !options.forceOverwrite) {
      throw new DuplicateNoteError(
        `A note for this video already exists: [[${existing.basename}]]`,
        existing.path
      );
    }

    // 3. Fetch transcript
    onStatus("Connecting to YouTube…");
    let transcriptResult;

    if (options.manualTranscript) {
      transcriptResult = {
        text: options.manualTranscript,
        source: "manual" as const,
        videoId,
        title: "Unknown title",
        channel: "Unknown channel",
      };
    } else {
      // NoTranscriptError propagates to runPipeline in main.ts which re-opens
      // the URL modal with manual transcript pre-shown and the reason displayed.
      transcriptResult = await this.fetcher.fetch(videoId);
    }

    // 4. Auto-detect category
    let category: VideoCategory = options.categoryOverride ?? "uncategorized";

    if (!options.categoryOverride && this.settings.notes.autoDetectCategory) {
      onStatus("Detecting category…");
      try {
        const detectPrompt = this.promptLib.getCategoryDetectionPrompt(
          transcriptResult.text
        );
        const raw = await provider.complete({
          systemPrompt: detectPrompt.system,
          userPrompt: detectPrompt.user,
          maxTokens: 20,
          temperature: 0.1,
        });
        const detected = raw.trim().toLowerCase() as VideoCategory;
        const valid: VideoCategory[] = [
          "ai",
          "programming",
          "career",
          "mindset",
          "interests",
          "uncategorized",
        ];
        if (valid.includes(detected)) category = detected;
      } catch {
        // Non-fatal — fall back to default
      }
    }

    // 5. Two-pass processing for long transcripts
    //
    // For transcripts > LONG_TRANSCRIPT_THRESHOLD characters, the raw transcript
    // is compressed into a structured summary before the main extraction pass.
    // This preserves the full arc of the video — conclusions, takeaways, and the
    // second half — which plain truncation systematically discards.
    const rawTranscriptText = transcriptResult.text;
    const isLongTranscript =
      rawTranscriptText.length > LONG_TRANSCRIPT_THRESHOLD &&
      !options.manualTranscript;

    let contentForExtraction = rawTranscriptText;
    let wasChunked = false;

    if (isLongTranscript) {
      onStatus("Long video — processing in sections…");
      try {
        contentForExtraction = await this.twoPassSummarize(
          rawTranscriptText,
          provider,
          onStatus
        );
        wasChunked = true;
      } catch {
        // If two-pass fails, fall back silently to the raw transcript
        contentForExtraction = rawTranscriptText;
      }
    }

    // 6. Select and render prompt
    const promptId = options.promptId ?? this.settings.notes.defaultPromptId;
    const prompt =
      this.promptLib.getPromptById(promptId) ??
      this.promptLib.getPromptForCategory(category);

    const today = new Date().toISOString().split("T")[0];
    const rendered = this.promptLib.renderPrompt(prompt, {
      transcript: contentForExtraction,
      title: transcriptResult.title,
      channel: transcriptResult.channel,
      url: options.url,
      date: today,
      videoLength: this.getVideoLengthLabel(rawTranscriptText.length),
      isChunked: wasChunked,
    });

    const shouldUseTwoPassSchema =
      this.settings.notes.enableTwoPassSchemaExtraction &&
      contentForExtraction.length >= TWO_PASS_SCHEMA_THRESHOLD;

    // 7. AI extraction
    let aiOutput: string;
    if (shouldUseTwoPassSchema) {
      onStatus(`Extracting (analysis pass) with ${provider.name}…`);
      const analysis = await this.withRetry(() =>
        provider.complete({
          systemPrompt: rendered.system,
          userPrompt: this.buildAnalysisOnlyUserPrompt(rendered.user),
          maxTokens: this.settings.maxTokens,
          temperature: this.settings.temperature,
        })
      );

      onStatus(`Extracting (archival pass) with ${provider.name}…`);
      const archival = await this.withRetry(() =>
        provider.complete({
          systemPrompt: rendered.system,
          userPrompt: this.buildArchivalOnlyUserPrompt(rendered.user),
          maxTokens: this.settings.maxTokens,
          temperature: this.settings.temperature,
        })
      );

      aiOutput = [analysis.trim(), archival.trim()].join("\n\n");
    } else {
      onStatus(`Extracting with ${provider.name}…`);
      aiOutput = await this.withRetry(() =>
        provider.complete({
          systemPrompt: rendered.system,
          userPrompt: rendered.user,
          maxTokens: this.settings.maxTokens,
          temperature: this.settings.temperature,
        })
      );
    }

    // 8. Parse AI output into VideoNote
    onStatus("Generating note…");
    const note = this.parser.parse(aiOutput, {
      title: transcriptResult.title ?? "Unknown title",
      channel: transcriptResult.channel ?? "Unknown channel",
      url: options.url,
      videoId,
      dateWatched: today,
      defaultCategory: category,
      defaultStatus: this.settings.notes.defaultStatus,
    });

    // Attach raw transcript if configured
    if (this.settings.notes.includeRawTranscript) {
      note.rawTranscript = rawTranscriptText;
    }

    // 9. Build markdown & filename
    const markdown = this.generator.buildMarkdown(note);
    const filename = this.generator.buildFilename(note);
    const targetFolder = this.vault.getTargetFolder(note);

    // 10. Write to vault
    const { file } = await this.vault.writeNote(targetFolder, filename, markdown);

    // 11. Post-write tasks (non-blocking — failures are warned, not fatal)
    void this.runPostWriteTasks(note, filename);

    return {
      note,
      filePath: file.path,
      noteFilename: filename,
    };
  }

  // ─── Two-pass summarization ───────────────────────────────────────────────────
  //
  // Splits the transcript into thirds, extracts bullet summaries from each third
  // independently at low token cost, then returns the combined summaries for the
  // main extraction pass. The AI in the main pass receives a condensed but
  // structurally complete representation of the full video.

  private async twoPassSummarize(
    transcript: string,
    provider: IAIProvider,
    onStatus: (msg: string) => void
  ): Promise<string> {
    const NUM_CHUNKS = 3;
    const chunkSize = Math.ceil(transcript.length / NUM_CHUNKS);

    // Split at sentence boundaries near each chunk boundary
    const chunks: string[] = [];
    let pos = 0;
    for (let i = 0; i < NUM_CHUNKS; i++) {
      const targetEnd = i === NUM_CHUNKS - 1 ? transcript.length : pos + chunkSize;
      const boundaryEnd = this.findSentenceBoundary(transcript, targetEnd);
      chunks.push(transcript.slice(pos, boundaryEnd).trim());
      pos = boundaryEnd;
    }

    const chunkSummaries: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      onStatus(`Summarizing section ${i + 1} of ${chunks.length}…`);
      try {
        const summary = await provider.complete({
          systemPrompt:
            "You extract key ideas from transcript sections. Be specific and concrete — include names, numbers, examples, and mechanisms, not just topic labels. Use bullet points. No preamble, no intro sentence.",
          userPrompt: `Extract the 10–15 most important ideas, arguments, examples, or moments from this transcript section. Each bullet should be 2–3 sentences: state the idea, then include supporting detail or the speaker's reasoning. Prioritize surprising, specific, or actionable content over general observations. Preserve concrete examples, data points, and named references.\n\nSection ${i + 1} of ${chunks.length}:\n${chunks[i]}`,
          maxTokens: 1400,
          temperature: 0.3,
        });
        chunkSummaries.push(`[Section ${i + 1} of ${NUM_CHUNKS}]\n${summary.trim()}`);
      } catch {
        // If a chunk summary fails, include a truncated raw fallback so coverage is maintained
        chunkSummaries.push(
          `[Section ${i + 1} of ${NUM_CHUNKS} — summary unavailable]\n${chunks[i].slice(0, 800)}`
        );
      }
    }

    return chunkSummaries.join("\n\n");
  }

  // ─── Find sentence boundary near a target position ────────────────────────────

  private findSentenceBoundary(text: string, targetPos: number): number {
    const searchWindow = 600;
    const searchStart = Math.max(0, targetPos - searchWindow);
    const searchEnd = Math.min(text.length, targetPos + searchWindow);
    const before = text.slice(searchStart, Math.min(targetPos, searchEnd));

    // Find the last sentence-ending punctuation before the target
    const lastBreak = Math.max(
      before.lastIndexOf(". "),
      before.lastIndexOf(".\n"),
      before.lastIndexOf("! "),
      before.lastIndexOf("? ")
    );

    if (lastBreak > 0) {
      return searchStart + lastBreak + 2; // include the punctuation + space
    }

    return targetPos;
  }

  // ─── Video length label ───────────────────────────────────────────────────────

  private getVideoLengthLabel(charCount: number): string {
    if (charCount < 10_000) return "short (under 10 min)";
    if (charCount < 40_000) return "medium (10–40 min)";
    return "long (40+ min)";
  }

  private buildAnalysisOnlyUserPrompt(baseUserPrompt: string): string {
    return [
      baseUserPrompt,
      "",
      "IMPORTANT: Output ONLY the following labeled sections, in any order, with valid Markdown content. Do not output any other labels/sections.",
      "Required sections:",
      "- METADATA",
      "- CORE_IDEA",
      "- KEY_CONCEPTS",
      "- KEY_INSIGHTS",
      "- WEAK_POINTS",
      "- CONNECTIONS",
      "- OPEN_QUESTIONS",
      "- DENSE_SUMMARY",
      "",
      "If a required section genuinely has no content, write exactly: N/A",
    ].join("\n");
  }

  private buildArchivalOnlyUserPrompt(baseUserPrompt: string): string {
    return [
      baseUserPrompt,
      "",
      "IMPORTANT: Output ONLY the following labeled sections, in any order, with valid Markdown content. Do not output any other labels/sections.",
      "Required sections:",
      "- TOOLS_AND_TECHNOLOGIES",
      "- ARCHITECTURES_AND_SYSTEMS",
      "- PROCEDURES_AND_PROCESSES",
      "- CODE_AND_IMPLEMENTATION",
      "- WARNINGS_AND_ANTIPATTERNS",
      "- METRICS_AND_BENCHMARKS",
      "- PREREQUISITES",
      "- INDEX_TERMS",
      "",
      "If a required section genuinely has no content, write exactly: N/A",
    ].join("\n");
  }

  // ─── Post-write tasks ─────────────────────────────────────────────────────────

  private async runPostWriteTasks(
    note: import("../types").VideoNote,
    filename: string
  ): Promise<void> {
    const tasks = [
      this.vault.updateMOC(note, filename),
      this.vault.updateIndex(note, filename),
      this.vault.ensureSearchGuide(),
    ];

    for (const task of tasks) {
      try {
        await task;
      } catch (e) {
        console.error("[YT Knowledge Base] Post-write task failed:", e);
      }
    }
  }

  // ─── Retry with exponential backoff ──────────────────────────────────────────

  private async withRetry<T>(
    fn: () => Promise<T>,
    maxAttempts = 3
  ): Promise<T> {
    let lastError: Error = new Error("Unknown error");

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));

        const msg = lastError.message.toLowerCase();
        if (msg.includes("401") || msg.includes("403") || msg.includes("invalid")) {
          throw lastError;
        }

        if (attempt < maxAttempts) {
          const delay = Math.pow(2, attempt) * 1000;
          await sleep(delay);
          new Notice(`Retrying… attempt ${attempt + 1} of ${maxAttempts}`);
        }
      }
    }

    throw lastError;
  }
}

// ─── Custom errors ────────────────────────────────────────────────────────────

export class DuplicateNoteError extends Error {
  existingPath: string;
  constructor(message: string, existingPath: string) {
    super(message);
    this.name = "DuplicateNoteError";
    this.existingPath = existingPath;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Augment ProcessingOptions to include forceOverwrite
declare module "../types" {
  interface ProcessingOptions {
    forceOverwrite?: boolean;
  }
}
