# YT Knowledge Base

Transform YouTube videos into structured, searchable Obsidian knowledge notes using AI — without leaving your vault.

## What it does

Paste a YouTube URL → the plugin fetches the transcript → sends it through a configurable AI prompt → creates a fully-tagged Obsidian note with extracted insights, key concepts, steps, quotes, and actionable takeaways.

Built for developers, students, and knowledge workers who watch a lot of YouTube but want a system to actually retain and connect what they learn.

## Features

- **One-click extraction** — paste a URL and get a structured note in seconds
- **Five AI providers** — Anthropic Claude, OpenAI, Google Gemini, Cerebras (world's fastest inference), or Ollama (local, offline)
- **Six prompt presets** — Universal, AI/Tech, Career, TED/BigThink, Mindset, and Cross-video Synthesis
- **Auto-categorization** — AI detects the video type and picks the best prompt
- **Smart vault organization** — routes notes to category folders, updates Maps of Content, and maintains a master index
- **Tag taxonomy** — consistent tagging with Dataview-compatible frontmatter
- **Batch processing** — queue multiple URLs and process them sequentially
- **Duplicate detection** — warns before overwriting an existing note
- **Manual transcript fallback** — paste transcript manually if auto-fetch fails

## Installation

### From the community plugin directory (recommended)

1. Open Obsidian Settings → Community plugins → Browse
2. Search for "YT Knowledge Base"
3. Install and enable

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/your-username/yt-knowledge-base/releases/latest)
2. Create folder `.obsidian/plugins/yt-knowledge-base/` in your vault
3. Copy the three files into that folder
4. Enable the plugin in Obsidian Settings → Community plugins

## Setup

1. Open Settings → YT Knowledge Base
2. Select your preferred AI provider
3. Paste your API key for that provider
4. Click **Test connection** to verify it works
5. Optionally configure your vault organization preferences

### Getting API keys

| Provider | Where to get it |
|----------|----------------|
| Anthropic Claude | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com) |
| Cerebras | [cloud.cerebras.ai](https://cloud.cerebras.ai) — free tier available |
| Ollama | No key needed — [install Ollama locally](https://ollama.com) |

## Usage

### Process a single video

- Click the **YouTube icon** in the left ribbon
- Or use command palette (`Ctrl/Cmd+P`) → **Process YouTube URL**
- Or use **Process URL from clipboard** to auto-read a copied YouTube URL

### Batch process multiple videos

Command palette → **Batch process URLs** → paste one URL per line → Start.

### Advanced options

In the URL input modal, expand **Show options** to:
- Choose a specific extraction prompt
- Override the auto-detected category
- Paste a transcript manually (for videos without captions)

## Vault structure

The plugin creates and maintains:

```
YouTube Knowledge Base/
├── _INDEX.md               ← master table of all notes (Dataview-compatible)
├── _SEARCH_GUIDE.md        ← ready-to-use Dataview queries
├── 01-AI-Agents/
├── 02-Programming-Tools/
├── 03-Career/
├── 04-Mindset-Productivity/
├── 05-Interests-Society/
├── 06-Uncategorized/
└── 99-MOC/
    ├── MOC-AI & LLM.md
    ├── MOC-Career.md
    └── ...
```

## Note format

Each generated note includes:

- **YAML frontmatter** with `title`, `channel`, `url`, `video_id`, `category`, `type`, `status`, `tags`, `key_person`, `date_watched`
- **Core idea** — single-sentence thesis
- **Key concepts** — defined terms with plain explanations
- **Steps / workflow** — numbered process (if applicable)
- **Insights & surprises** — counterintuitive or noteworthy findings
- **Actionable takeaways** — what to actually do
- **Quotes** — memorable statements
- **Connections** — links to other ideas and fields
- **Raw notes** — blank area for your own additions

## Privacy & security

- API keys are stored locally in Obsidian's plugin data — never sent anywhere except to the AI provider you've selected
- No telemetry or analytics of any kind
- All processing happens directly between your Obsidian client and your chosen AI provider
- Transcripts are only sent to the AI provider; they are not stored externally

## Limitations

- Videos must have captions enabled (auto-generated or manual)
- Private and age-restricted videos cannot be processed
- Very long videos (3+ hours) have their transcripts truncated before processing
- YouTube occasionally changes their page format which may temporarily break transcript fetching — use the manual transcript fallback in that case

## Contributing

Issues and pull requests are welcome at [github.com/your-username/yt-knowledge-base](https://github.com/your-username/yt-knowledge-base).

## License

MIT — see [LICENSE](LICENSE).
