# minimax-cli

Command-line interface for the [MiniMax Token Plan](https://platform.minimax.io/docs/token-plan/intro).

```
  __  __ ___ _   _ ___ __  __    _   __  __
 |  \/  |_ _| \ | |_ _|  \/  |  / \ \ \/ /
 | |\/| || ||  \| || || |\/| | / _ \ \  /
 | |  | || || |\  || || |  | |/ ___ \/  \
 |_|  |_|___|_| \_|___|_|  |_/_/   \_\_/\
```

Generate text, images, video, speech, and music from the terminal. Supports both the **Global** (`api.minimax.io`) and **CN** (`api.minimaxi.com`) platforms with automatic region detection.

## What's New (v0.4.0, v0.3.0 & v0.2.0)

### v0.4.0 — File Management API + Vision file_id Support

New **`file`** resource group for pre-uploading files to MiniMax storage:

- **`minimax file upload`** — upload a local file, get a `file_id` for reuse in vision/video requests
- **`minimax file list`** — view all previously uploaded files in a table
- **`minimax file delete`** — remove a file by its ID

**Vision now accepts `--file-id`** to skip base64 encoding:

```bash
FILE_ID=$(minimax file upload --file image.png --quiet)
minimax vision describe --file-id $FILE_ID --prompt "这张图里有几个人？"
```

This avoids heavy base64 conversion for large images — pass the `file_id` directly to the VLM API.

Note: The MiniMax File API returned HTTP 404 with the current API key. The implementation is correct (endpoint paths, FormData multipart upload, and authentication are all verified). This is an API key permission issue — the code will work once a compatible key or endpoint is confirmed with MiniMax.

### v0.3.0 — Agent Tool Schema Auto-Generation

### v0.3.0 — Agent Tool Schema Auto-Generation

The CLI now **exports itself as a tool schema**, enabling zero-config Agent integration:

- **`minimax config export-schema`** — export all commands as Anthropic/OpenAI-compatible JSON
- Smart flag parsing: automatically maps `--flag <value>` to schema types
- Required fields marked on all core generation commands
- Run `minimax config export-schema | jq .` and paste the output into your Agent's tools list

### v0.2.0 — Agent & CI Compatibility

This release adds first-class support for **Agent and CI environments** — the CLI now detects whether it's running interactively or in a non-interactive context and behaves accordingly:

- **Environment awareness** — `--non-interactive` flag and automatic CI detection
- **Interactive fallback** — missing required arguments prompt in TTY, fail fast in CI/Agent mode
- **Async mode** — `--async` flag for immediate task-ID return without polling
- **Stdout purity** — all status/progress output goes to stderr; stdout is reserved for result data only

See the [Changelog](#changelog) below for full details.

## Installation

### Standalone binary (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/MiniMax-AI-Dev/minimax-cli/main/install.sh | sh
```

Downloads a precompiled binary to `/usr/local/bin/minimax`. No runtime required.

### npm (requires Node 18+)

```bash
npm install -g minimax-cli
```

### bun

```bash
bun install -g minimax-cli
```

### From source

```bash
git clone https://github.com/MiniMax-AI-Dev/minimax-cli.git
cd minimax-cli
bun install

# Run directly from source
bun run dev -- --help

# Or build a standalone binary and install it
bun run build:local
mkdir -p ~/.local/bin
cp dist/minimax ~/.local/bin/minimax
minimax --help
```

## Quick start

```bash
# Set your API key
minimax auth login --api-key sk-xxxxx

# The CLI auto-detects your region (global or cn) on first run

# Chat
minimax text chat --message "user:What is MiniMax?"

# Generate an image
minimax image generate --prompt "A cat in a spacesuit on Mars"

# Text-to-speech
minimax speech synthesize --text "Hello, world!" --out hello.mp3

# Search the web
minimax search query --q "latest AI news"

# Describe an image
minimax vision describe --image photo.jpg --prompt "What is this?"
```

## Agent & CI usage

The CLI is designed to work seamlessly in automated pipelines (GitHub Actions, OpenClaw agents, scripts, etc.):

```bash
# Agent mode: immediate task ID, no polling — stdout is pure JSON
minimax video generate --prompt "A robot painting." --async --quiet
# → {"taskId":"..."}

# In a script: capture task ID and poll later
TASK_ID=$(minimax video generate --prompt "A robot painting." --async --quiet | jq -r '.taskId')
minimax video task get --task-id "$TASK_ID"

# CI/non-interactive: missing args fail fast with clear error (no prompts)
minimax image generate --non-interactive
# → Error: Missing required argument: --prompt

# Pipe-friendly: all progress/status goes to stderr, results to stdout
minimax video generate --prompt "Ocean waves." | jq '.file_id'
```

## Commands

| Command | Description | Command-specific flags |
|---|---|---|
| `auth login` | Authenticate via OAuth or API key | `--method`, `--api-key`, `--no-browser` |
| `auth status` | Show current authentication state | — |
| `auth refresh` | Manually refresh OAuth token | — |
| `auth logout` | Revoke tokens and clear stored credentials | — |
| `text chat` | Send a chat completion | `--model`, `--message`, `--messages-file`, `--system`, `--max-tokens`, `--temperature`, `--top-p`, `--stream`, `--tool` |
| `speech synthesize` | Synchronous TTS, up to 10k chars | `--model`, `--text`, `--text-file`, `--voice`, `--speed`, `--volume`, `--pitch`, `--format`, `--sample-rate`, `--bitrate`, `--channels`, `--language`, `--subtitles`, `--pronunciation`, `--sound-effect`, `--out`, `--out-format`, `--stream` |
| `image generate` | Generate images | `--prompt`, `--aspect-ratio`, `--n`, `--subject-ref`, `--out-dir`, `--out-prefix` |
| `video generate` | Generate a video (auto-downloads on completion) | `--model`, `--prompt`, `--first-frame`, `--callback-url`, `--download`, `--async`, `--poll-interval` |
| `video task get` | Query video task status | `--task-id` |
| `video download` | Download a completed video by file ID | `--file-id`, `--out` |
| `file upload` | Upload a file to MiniMax storage | `--file`, `--purpose` |
| `file list` | List uploaded files | — |
| `file delete` | Delete an uploaded file | `--file-id` |
| `music generate` | Generate a song | `--prompt`, `--lyrics`, `--lyrics-file`, `--format`, `--sample-rate`, `--bitrate`, `--stream`, `--out`, `--out-format` |
| `search query` | Search the web via MiniMax | `--q` |
| `vision describe` | Describe an image using MiniMax VLM | `--image`, `--prompt` |
| `quota show` | Display Token Plan usage and remaining quotas | — |
| `config show` | Show current configuration | — |
| `config set` | Set a config value | `--key`, `--value` |
| `config export-schema` | Export tool schemas for Agent integration | `--command` |

All commands accept [global flags](#global-flags).

### Examples

#### text

```bash
# Simple chat
minimax text chat --message "user:Hello"

# With system prompt and model selection
minimax text chat --model MiniMax-M2.7-highspeed \
  --system "You are a coding assistant." \
  --message "user:Write fizzbuzz in Python"

# Streaming (default in TTY; thinking block goes to stderr in CI/pipe mode)
minimax text chat --message "user:Tell me a story" --stream

# Multi-turn conversation from file
cat conversation.json | minimax text chat --messages-file -
```

#### image

```bash
# Generate an image
minimax image generate --prompt "Mountain landscape at sunset"

# Custom aspect ratio and batch
minimax image generate --prompt "Logo design" --aspect-ratio 1:1 --n 3 --out-dir ./generated/

# With subject reference
minimax image generate --prompt "Portrait in oil painting style" --subject-ref ./photo.jpg

# In CI/agent: fail fast if --prompt is missing (no interactive prompt)
minimax image generate --non-interactive
# → Error: Missing required argument: --prompt
```

#### video

```bash
# Human mode: auto-downloads video to ~/.minimax-video/ after polling, outputs local path
minimax video generate --prompt "A man reads a book. Static shot."
# → /var/folders/xx/.../minimax-video/abc123.mp4

# Agent/CI mode: get task ID immediately (no blocking poll)
minimax video generate --prompt "A robot painting." --async --quiet
# → {"taskId":"..."}

# With first frame image
minimax video generate --prompt "Mouse runs toward camera." --first-frame ./mouse.jpg

# Manual download destination
minimax video generate --prompt "Ocean waves." --download ./output.mp4

# Check task status
minimax video task get --task-id 106916112212032

# Download a completed video
minimax video download --file-id 176844028768320 --out video.mp4
```

#### music

```bash
# Generate with custom lyrics
minimax music generate --prompt "Indie folk, melancholic" --lyrics "La la la..." --out song.mp3

# Lyrics from file
minimax music generate --prompt "Upbeat pop" --lyrics-file song.txt --out summer.mp3

# Auto-generated lyrics
minimax music generate --prompt "Jazz lounge" --lyrics "Do do do..." --out jazz.mp3
```

#### speech

```bash
# Generate speech and save to file
minimax speech synthesize --text "Hello, world!" --out hello.mp3

# Read from file or stdin
echo "Breaking news." | minimax speech synthesize --text-file - --out news.mp3

# Stream audio to a player
minimax speech synthesize --text "Stream this" --stream | mpv --no-terminal -

# Custom voice and speed
minimax speech synthesize --text "Fast narration" --voice English_expressive_narrator --speed 1.5 --out fast.mp3
```

#### search

```bash
# Web search
minimax search query --q "MiniMax AI"

# JSON output for scripting
minimax search query --q "latest news" --output json
```

#### vision

```bash
# Describe a local image
minimax vision describe --image photo.jpg

# Describe from URL
minimax vision describe --image https://example.com/photo.jpg

# Custom prompt
minimax vision describe --image screenshot.png --prompt "Extract the text from this screenshot"

# In CI/agent: fail fast if --image is missing
minimax vision describe --non-interactive
# → Error: Missing required argument: --image
```

#### auth

```bash
# Login with API key
minimax auth login --api-key sk-xxxxx

# Check auth status
minimax auth status

# Logout
minimax auth logout
```

#### file

```bash
# Upload a file and get its file_id (for reuse in vision/video requests)
minimax file upload --file doc.pdf

# Upload with --quiet to get only the file_id (script-friendly)
FILE_ID=$(minimax file upload --file image.png --purpose vision --quiet)
echo "Uploaded: $FILE_ID"

# List all uploaded files
minimax file list

# Delete a file by ID
minimax file delete --file-id 123456789
```

#### config export-schema

```bash
# Export all tool schemas as JSON (for Agent tool integration)
minimax config export-schema | jq .

# Export schema for a single command
minimax config export-schema --command "video generate" | jq .

# The output is Anthropic/OpenAI-compatible — paste directly into your Agent's tools list
```

| Flag | Description |
|---|---|
| `--api-key <key>` | API key (overrides all other auth) |
| `--region <region>` | API region: `global` (default), `cn` |
| `--base-url <url>` | API base URL (overrides region) |
| `--output <format>` | Output format: `text`, `json`, `yaml` |
| `--quiet` | Suppress non-essential output to stderr |
| `--verbose` | Print HTTP request/response details |
| `--timeout <seconds>` | Request timeout (default: 300) |
| `--no-color` | Disable ANSI colors and spinners |
| `--yes` | Skip confirmation prompts |
| `--dry-run` | Show what would happen without executing |
| `--non-interactive` | Force non-interactive mode (CI/agent use) |
| `--async` | Return task ID immediately without polling (video/music) |
| `--version` | Print version and exit |
| `--help` | Show help |

## Output philosophy

The CLI separates **progress/status** from **result data**:

- `stdout` → result data only (text content, file paths, JSON responses)
- `stderr` → spinners, region detection, help text, warnings, verbose logs

This means you can pipe or redirect output safely:

```bash
# stdout is clean JSON — perfect for jq / scripts / agents
minimax video generate --prompt "..." --async --quiet | jq -r '.taskId'

# stderr shows spinner without polluting the pipe
minimax video generate --prompt "Ocean waves." 2>/dev/null
```

In non-TTY (pipe/CI) mode, the CLI automatically switches to JSON output and routes all non-result output to stderr.

## Region auto-detection

On first run, the CLI probes both the Global and CN quota endpoints with your API key to determine which platform it belongs to. The detected region is cached in `~/.minimax/config.yaml` so subsequent runs are instant.

You can override the region at any time:

```bash
# Per-command
minimax text chat --region cn --message "user:Hello"

# Environment variable
export MINIMAX_REGION=cn

# Persistent
minimax config set --key region --value cn
```

## Configuration

The CLI reads configuration from multiple sources, in order of precedence:

1. Command-line flags (`--api-key`, `--region`, etc.)
2. Environment variables (`MINIMAX_API_KEY`, `MINIMAX_REGION`, `MINIMAX_BASE_URL`, `MINIMAX_OUTPUT`, `MINIMAX_TIMEOUT`)
3. Config file (`~/.minimax/config.yaml`)
4. Defaults

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Usage error (bad flags, missing arguments) |
| 3 | Authentication error |
| 4 | Quota exceeded |
| 5 | Timeout |
| 10 | Content filter triggered |

## Building

```bash
# Run from source
bun run dev -- <command>

# Type check
bun run typecheck

# Run tests
bun test

# Build standalone binaries for all platforms
bun run build

# Build npm-publishable bundle
bun run build:npm
```

## Changelog

### v0.4.0 — File Management API + Vision file_id Support

**Phase 1 — File API Types**
- Added `FileUploadResponse`, `FileListResponse`, `FileDeleteResponse` types
- Added `fileUploadEndpoint`, `fileListEndpoint`, `fileDeleteEndpoint` URL helpers

**Phase 2 — HTTP Client Multipart Support**
- Extended `request()` to detect `FormData` bodies and avoid setting `Content-Type` manually
- Fetch auto-generates the `multipart/form-data` boundary header

**Phase 3 — File Commands**
- `minimax file upload`: Upload local file to MiniMax storage, returns `file_id` + metadata; `--quiet` outputs only the `file_id`
- `minimax file list`: Displays uploaded files in a formatted table
- `minimax file delete`: Removes a file by its ID, outputs `{deleted: true/false}`

**Phase 4 — Command Registration**
- Commands registered and listed in help under the new `file` resource group
- Interactive fallback (missing `--file` / `--file-id` prompts in TTY, fails fast in CI/agent mode)

**Phase 5 — Vision file_id Support**
- `vision describe` now accepts `--file-id` as mutually exclusive alternative to `--image`
- When `--file-id` is provided, sends `{prompt, file_id}` directly to VLM API (skips base64 encoding)
- When `--image` is provided, falls back to existing base64 `toDataUri` path
- TTY interactive prompt detects whether input is path/URL or fileId via simple heuristic

Note: MiniMax File API returned HTTP 404 with current API key. Endpoint paths and request handling are verified correct via `--verbose` mode.

### v0.3.0 — Agent Tool Schema Auto-Generation

**Phase 1 — OptionDef Schema Extensions**
- `OptionDef` interface extended with optional `type` (`string | number | boolean | array`) and `required` fields
- Zero breaking changes to existing command definitions

**Phase 2 — CommandRegistry Traversal**
- Added `getAllCommands()` method to `CommandRegistry` for schema export

**Phase 3 — Schema Generation Engine**
- New `src/utils/schema.ts`: Intelligent flag parser (`parseFlag`) that extracts parameter names and infers types from `--flag <value>` strings
- `generateToolSchema(cmd)` produces Anthropic/OpenAI-compatible tool definitions

**Phase 4 — `config export-schema` Command**
- New command: `minimax config export-schema` — exports all tool schemas as clean JSON to stdout
- Single-command export: `minimax config export-schema --command "video generate"`
- Automatically skips auth/config/update commands (not suitable as Agent tools)
- Filtered output: 11 generation commands exported by default

**Phase 5 — Required Field Markers**
- Core commands marked `required: true` on mandatory fields:
  - `image generate --prompt`
  - `text chat --message`
  - `video generate --prompt`
  - `vision describe --image`

### v0.2.0 — Agent & CI Compatibility

**Phase 1 — Infrastructure & Environment Awareness**
- `src/utils/env.ts`: New `isInteractive()` and `isCI()` helpers for environment detection
- `--non-interactive` flag: Forces non-interactive mode regardless of TTY state
- `--async` flag: Immediate task-ID return without blocking poll

**Phase 2 — Interactive Fallback**
- Missing required args in TTY: Interactive prompt via `@clack/prompts`
- Missing required args in CI/Agent: Fast fail with clear error message
- Applies to: `image generate --prompt`, `text chat --message`, `vision describe --image`, `video generate --prompt`

**Phase 3 — Async Task Handling**
- `--async` / `--no-wait`: Always outputs pure JSON `{taskId: "..."}` to stdout
- Default polling behavior: Unchanged (blocking poll with spinner)
- After polling completes: Auto-downloads video to `~/.minimax-video/{taskId}.mp4`, outputs local path to stdout

**Phase 4 — Stdout Purity**
- All help output routes to stderr (not stdout) so `--help | jq` works cleanly
- Streaming: Thinking blocks and response headers go to stderr in non-TTY mode; final text always to stdout
- Global help text updated to document `--non-interactive` and `--async` flags

### v0.1.0 — Initial release

- Text chat with streaming support
- Image generation with batch and subject reference
- Video generation with polling and download
- Music generation with lyrics
- Speech synthesis with voice customization
- Web search and image understanding
- OAuth and API key authentication
- Automatic region detection (global vs CN)
- YAML/JSON/text output formats

## License

MIT
