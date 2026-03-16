import { requestUrl } from "obsidian";

// ─── YouTube Internal API constants ──────────────────────────────────────────
//
// The /youtubei/v1/player endpoint is YouTube's own internal API, used by
// every official YouTube client. The API key below is the public IOS InnerTube
// key — it does not rotate and can be safely hardcoded.
// NOTE: The ANDROID client no longer returns captions (early 2026).
//       The IOS client returns caption track URLs that work without PO tokens.

const INNERTUBE_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const PLAYER_ENDPOINT = `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}&prettyPrint=false`;

// ─── Response shape types ─────────────────────────────────────────────────────

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  name?: { simpleText?: string };
  // "asr" = auto-generated, absent = manually created
  kind?: string;
  isTranslatable?: boolean;
}

export interface PlayerResponse {
  videoDetails: {
    videoId: string;
    title: string;
    author: string;
    lengthSeconds?: string;
    isLiveContent?: boolean;
    isPrivate?: boolean;
  };
  playabilityStatus: {
    status: "OK" | "UNPLAYABLE" | "LOGIN_REQUIRED" | "ERROR" | "LIVE_STREAM_OFFLINE" | string;
    reason?: string;
    // age-gate specific
    desktopLegacyAgeGateReason?: number;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
      audioTracks?: unknown[];
    };
  };
}

// ─── Client identities ────────────────────────────────────────────────────────

/**
 * IOS client — primary path.
 * Works for the vast majority of public videos.
 * Returns plain baseUrl on caption tracks (no PO token needed).
 * Replaced ANDROID client which stopped returning captions in early 2026.
 */
const IOS_CLIENT_CONTEXT = {
  client: {
    clientName: "IOS",
    clientVersion: "20.10.38",
    hl: "en",
    gl: "US",
  },
};

const IOS_USER_AGENT =
  "com.google.ios.youtube/20.10.38 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)";

/**
 * TV Embedded client — age-gated fallback.
 * Bypasses age-gate without requiring user credentials or cookies.
 * Caption track baseUrls remain plain (no cipher) — only video stream
 * URLs use signatureCipher with this client, which we never touch.
 */
const TV_EMBEDDED_CLIENT_CONTEXT = {
  client: {
    clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    clientVersion: "2.0",
    hl: "en",
    gl: "US",
  },
  thirdParty: {
    embedUrl: "https://www.youtube.com",
  },
};

// ─── YouTubeClient ────────────────────────────────────────────────────────────

export class YouTubeClient {
  // ─── Video ID extraction (static — used by modals + pipeline) ────────────────

  static extractVideoId(url: string): string | null {
    // Strip any version hash appended by the duplicate-handling logic
    const cleanUrl = url.split("#v")[0];

    const patterns = [
      /[?&]v=([a-zA-Z0-9_-]{11})/,           // youtube.com/watch?v=ID
      /youtu\.be\/([a-zA-Z0-9_-]{11})/,        // youtu.be/ID
      /\/embed\/([a-zA-Z0-9_-]{11})/,          // youtube.com/embed/ID
      /\/shorts\/([a-zA-Z0-9_-]{11})/,          // youtube.com/shorts/ID
      /\/live\/([a-zA-Z0-9_-]{11})/,            // youtube.com/live/ID
    ];

    for (const pattern of patterns) {
      const match = cleanUrl.match(pattern);
      if (match?.[1]) return match[1];
    }
    return null;
  }

  // ─── Primary fetch — IOS client ─────────────────────────────────────────────

  async fetchWithIOS(videoId: string): Promise<PlayerResponse> {
    return this.callPlayerEndpoint(videoId, IOS_CLIENT_CONTEXT);
  }

  // ─── Fallback fetch — TV Embedded client (age-gated) ─────────────────────────

  async fetchWithTVEmbedded(videoId: string): Promise<PlayerResponse> {
    return this.callPlayerEndpoint(videoId, TV_EMBEDDED_CLIENT_CONTEXT);
  }

  // ─── Shared API call ──────────────────────────────────────────────────────────

  private async callPlayerEndpoint(
    videoId: string,
    context: Record<string, unknown>
  ): Promise<PlayerResponse> {
    const body = JSON.stringify({
      videoId,
      context,
    });

    const resp = await requestUrl({
      url: PLAYER_ENDPOINT,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": IOS_USER_AGENT,
      },
      body,
      throw: false,
    });

    if (resp.status !== 200) {
      throw new YouTubeAPIError(
        `YouTube API returned HTTP ${resp.status}. The video may be unavailable.`,
        "HTTP_ERROR"
      );
    }

    let data: unknown;
    try {
      data = resp.json;
    } catch {
      throw new YouTubeAPIError(
        "YouTube returned an unexpected response. Please try again.",
        "PARSE_ERROR"
      );
    }

    // Basic shape validation
    const d = data as Partial<PlayerResponse>;
    if (!d.playabilityStatus) {
      throw new YouTubeAPIError(
        "YouTube response was malformed. Please try again.",
        "PARSE_ERROR"
      );
    }

    return data as PlayerResponse;
  }

}

// ─── Custom errors ────────────────────────────────────────────────────────────

export type TranscriptUnavailableReason =
  | "NO_CAPTIONS"        // Video exists but has no caption tracks
  | "AGE_RESTRICTED"     // Requires sign-in, both clients exhausted
  | "REGION_BLOCKED"     // Not available in this region
  | "PRIVATE"            // Private video
  | "DELETED"            // Video doesn't exist
  | "LIVE_STREAM"        // Live stream — no transcript yet
  | "HTTP_ERROR"         // Unexpected HTTP error
  | "PARSE_ERROR";       // Response couldn't be parsed

export class YouTubeAPIError extends Error {
  reason: TranscriptUnavailableReason;
  constructor(message: string, reason: TranscriptUnavailableReason) {
    super(message);
    this.name = "YouTubeAPIError";
    this.reason = reason;
  }
}

export class NoTranscriptError extends Error {
  reason: TranscriptUnavailableReason;
  constructor(message: string, reason: TranscriptUnavailableReason) {
    super(message);
    this.name = "NoTranscriptError";
    this.reason = reason;
  }
}
