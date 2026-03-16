import { requestUrl } from "obsidian";
import type { TranscriptResult } from "../types";
import {
  YouTubeClient,
  NoTranscriptError,
  YouTubeAPIError,
  type CaptionTrack,
  type PlayerResponse,
} from "./YouTubeClient";

// Truncation limit (~25k tokens at average density)
const MAX_TRANSCRIPT_CHARS = 80_000;

// Gap thresholds (seconds) for inferring sentence/paragraph boundaries from timedtext timing
const PARAGRAPH_GAP_THRESHOLD = 3.0; // > 3s gap → new paragraph
const SENTENCE_GAP_THRESHOLD = 1.2;  // > 1.2s gap → sentence end

export class TranscriptFetcher {
  private client: YouTubeClient;

  constructor() {
    this.client = new YouTubeClient();
  }

  // ─── Static helpers ───────────────────────────────────────────────────────────

  static extractVideoId(url: string): string | null {
    return YouTubeClient.extractVideoId(url);
  }

  // ─── Main fetch ───────────────────────────────────────────────────────────────

  /**
   * Fetch transcript and metadata for a YouTube video.
   *
   * Strategy:
   *   1. POST to /youtubei/v1/player with IOS client       (~95% of videos)
   *   2. If playabilityStatus signals age-gate, retry with TV Embedded client
   *   3. Parse captionTracks from the structured API response (no page scrape)
   *   4. Select best track: manual EN > auto EN > any manual > any auto > first
   *   5. Fetch and parse the timedtext XML from the track's baseUrl
   *      — with segment-aware sentence/paragraph break insertion
   *      — with filler word removal pass
   *
   * Throws NoTranscriptError with a specific reason for all unrecoverable cases.
   */
  async fetch(videoId: string): Promise<TranscriptResult> {
    // ── Tier 1: IOS client ─────────────────────────────────────────────────
    let response: PlayerResponse;
    try {
      response = await this.client.fetchWithIOS(videoId);
    } catch (e) {
      if (e instanceof YouTubeAPIError) {
        throw new NoTranscriptError(e.message, e.reason);
      }
      throw new NoTranscriptError(
        "Could not reach YouTube. Check your internet connection and try again.",
        "HTTP_ERROR"
      );
    }

    const playability = response.playabilityStatus;

    if (playability.status !== "OK") {
      const isAgeGated =
        playability.status === "LOGIN_REQUIRED" ||
        playability.desktopLegacyAgeGateReason != null ||
        (playability.reason ?? "").toLowerCase().includes("age");

      if (isAgeGated) {
        return this.fetchWithTVClient(videoId);
      }

      throw this.mapPlayabilityError(playability.status, playability.reason);
    }

    return this.extractAndFetch(response, videoId);
  }

  // ─── Tier 2: TV Embedded client ───────────────────────────────────────────────

  private async fetchWithTVClient(videoId: string): Promise<TranscriptResult> {
    let response: PlayerResponse;
    try {
      response = await this.client.fetchWithTVEmbedded(videoId);
    } catch (e) {
      if (e instanceof YouTubeAPIError) {
        throw new NoTranscriptError(e.message, e.reason);
      }
      throw new NoTranscriptError(
        "Could not reach YouTube. Check your internet connection and try again.",
        "HTTP_ERROR"
      );
    }

    if (response.playabilityStatus.status !== "OK") {
      throw this.mapPlayabilityError(
        response.playabilityStatus.status,
        response.playabilityStatus.reason
      );
    }

    return this.extractAndFetch(response, videoId);
  }

  // ─── Common: extract tracks and fetch XML ─────────────────────────────────────

  private async extractAndFetch(
    response: PlayerResponse,
    videoId: string
  ): Promise<TranscriptResult> {
    const tracks = this.extractTracks(response);

    if (tracks.length === 0) {
      throw new NoTranscriptError(
        "This video has no captions. You can paste the transcript text manually instead.",
        "NO_CAPTIONS"
      );
    }

    const track = this.selectBestTrack(tracks);
    const transcript = await this.fetchCaptionXml(track.baseUrl);

    return {
      text: this.truncate(transcript),
      source: "auto",
      videoId,
      title: response.videoDetails.title,
      channel: response.videoDetails.author,
    };
  }

  // ─── Caption track selection ──────────────────────────────────────────────────

  private selectBestTrack(tracks: CaptionTrack[]): CaptionTrack {
    const isManual = (t: CaptionTrack): boolean => t.kind !== "asr";
    const isEnglish = (t: CaptionTrack): boolean =>
      t.languageCode === "en" || t.languageCode.startsWith("en-");

    return (
      tracks.find((t) => isEnglish(t) && isManual(t)) ??
      tracks.find((t) => isEnglish(t)) ??
      tracks.find((t) => isManual(t)) ??
      tracks[0]
    );
  }

  private extractTracks(response: PlayerResponse): CaptionTrack[] {
    return (
      response.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
    );
  }

  // ─── Caption XML fetch ────────────────────────────────────────────────────────

  private async fetchCaptionXml(baseUrl: string): Promise<string> {
    let resp;
    try {
      resp = await requestUrl({ url: baseUrl, method: "GET" });
    } catch {
      throw new NoTranscriptError(
        "Failed to download captions. Please try again or paste the transcript manually.",
        "HTTP_ERROR"
      );
    }

    return this.parseTimedTextXml(resp.text);
  }

  // ─── Segment-aware XML parser ─────────────────────────────────────────────────
  //
  // YouTube's timedtext XML carries timing attributes on every <text> element:
  //   <text start="12.5" dur="2.3">Hello world</text>
  //
  // We use the gap between the end of one segment (start + dur) and the start of
  // the next to infer natural sentence and paragraph boundaries. This transforms
  // the flat transcript wall into properly punctuated prose, which dramatically
  // improves how the AI reasons over the content.
  //
  // Gap > PARAGRAPH_GAP_THRESHOLD → paragraph break (\n\n)
  // Gap > SENTENCE_GAP_THRESHOLD  → sentence end (". ")
  // Otherwise                     → space join
  //
  // Falls back to simple join if no timing attributes are present.

  private parseTimedTextXml(xml: string): string {
    interface Segment {
      text: string;
      start: number;
      end: number;
    }

    const segments: Segment[] = [];

    // Try to extract with timing attributes
    const timedRegex =
      /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
    let match: RegExpExecArray | null;

    while ((match = timedRegex.exec(xml)) !== null) {
      const start = parseFloat(match[1]);
      const dur = match[2] ? parseFloat(match[2]) : 2.0;
      const rawText = this.cleanSegmentText(match[3]);
      if (rawText) {
        segments.push({ text: rawText, start, end: start + dur });
      }
    }

    // If timing extraction found nothing, fall back to simple parse
    if (segments.length === 0) {
      return this.parseTimedTextXmlSimple(xml);
    }

    // Join segments with gap-aware breaks
    const parts: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const next = segments[i + 1];
      let text = seg.text;

      if (next) {
        const gap = next.start - seg.end;

        if (gap > PARAGRAPH_GAP_THRESHOLD) {
          // Long pause = speaker changing topic or taking a breath between ideas
          if (!/[.!?]$/.test(text)) text += ".";
          text += "\n\n";
        } else if (gap > SENTENCE_GAP_THRESHOLD) {
          // Short pause = sentence boundary
          if (!/[.!?]$/.test(text)) text += ".";
          text += " ";
        } else {
          // Tight continuation — just a space
          text += " ";
        }
      }

      parts.push(text);
    }

    const joined = parts.join("").trim();
    return this.removeFiller(joined);
  }

  // ─── Simple fallback parser (no timing data) ──────────────────────────────────

  private parseTimedTextXmlSimple(xml: string): string {
    const textParts: string[] = [];
    const textRegex = /<text[^>]*>([\s\S]*?)<\/text>/g;
    let match: RegExpExecArray | null;

    while ((match = textRegex.exec(xml)) !== null) {
      const raw = this.cleanSegmentText(match[1]);
      if (raw) textParts.push(raw);
    }

    if (textParts.length === 0) {
      throw new NoTranscriptError(
        "The captions were empty or could not be read. Try pasting the transcript manually.",
        "NO_CAPTIONS"
      );
    }

    return this.removeFiller(textParts.join(" "));
  }

  // ─── Text cleaning ────────────────────────────────────────────────────────────

  private cleanSegmentText(raw: string): string {
    return raw
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/<[^>]+>/g, "")    // strip inline tags e.g. <font color="">
      .replace(/\n/g, " ")
      .trim();
  }

  // ─── Filler removal ───────────────────────────────────────────────────────────
  //
  // Removes verbal fillers, repeated consecutive words, and sponsor markers.
  // This reduces the noise the AI reasons over and compresses ~10-15% of tokens
  // in auto-generated captions, which means more real content fits the budget.

  private removeFiller(text: string): string {
    return text
      // Verbal fillers (standalone only — don't strip "umbrella" or "uh-oh")
      .replace(/\b(um+|uh+|hmm+|er|ah)\b\s*/gi, " ")
      // Common transition filler phrases
      .replace(/\b(you know,?|i mean,?|like i said,?|as i mentioned,?|right\?|okay so|so yeah,?|you know what i mean)\b\s*/gi, " ")
      // Sponsor / promotional markers — remove through end of sentence
      .replace(
        /\b(this (video|episode) (is |was )?sponsored by|use (code|coupon|link) \w+|check out (the )?link (in|below)|link in (the )?description|discount code|affiliate link)\b[^.!?]*[.!?]?\s*/gi,
        " "
      )
      // Repeated consecutive words (e.g. "the the model", "is is")
      .replace(/\b(\w+)\s+\1\b/gi, "$1")
      // Collapse multiple spaces
      .replace(/  +/g, " ")
      // Collapse multiple newlines beyond two
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // ─── Playability error mapping ────────────────────────────────────────────────

  private mapPlayabilityError(
    status: string,
    youtubeReason?: string
  ): NoTranscriptError {
    switch (status) {
      case "LOGIN_REQUIRED":
        return new NoTranscriptError(
          "This video is age-restricted and requires sign-in. Try pasting the transcript manually.",
          "AGE_RESTRICTED"
        );

      case "UNPLAYABLE": {
        const r = youtubeReason?.toLowerCase() ?? "";
        if (
          r.includes("country") ||
          r.includes("region") ||
          r.includes("not available")
        ) {
          return new NoTranscriptError(
            youtubeReason ?? "This video is not available in your region.",
            "REGION_BLOCKED"
          );
        }
        return new NoTranscriptError(
          youtubeReason ?? "This video cannot be played.",
          "NO_CAPTIONS"
        );
      }

      case "ERROR":
        return new NoTranscriptError(
          youtubeReason ?? "This video does not exist or has been deleted.",
          "DELETED"
        );

      case "LIVE_STREAM_OFFLINE":
        return new NoTranscriptError(
          "Live stream transcripts are only available after the stream ends.",
          "LIVE_STREAM"
        );

      default:
        return new NoTranscriptError(
          youtubeReason ??
          `YouTube returned an unexpected status (${status}). Please try again.`,
          "HTTP_ERROR"
        );
    }
  }

  // ─── Truncation ───────────────────────────────────────────────────────────────

  private truncate(text: string): string {
    if (text.length <= MAX_TRANSCRIPT_CHARS) return text;

    const truncated = text.slice(0, MAX_TRANSCRIPT_CHARS);
    const lastPeriod = truncated.lastIndexOf(". ");
    const cutPoint =
      lastPeriod > MAX_TRANSCRIPT_CHARS * 0.85
        ? lastPeriod + 1
        : MAX_TRANSCRIPT_CHARS;

    return (
      truncated.slice(0, cutPoint) +
      "\n\n[Transcript truncated — video is very long]"
    );
  }
}
