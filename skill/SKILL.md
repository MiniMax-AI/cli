---
name: mmx-cli
description: Use mmx to generate text, images, video, and speech via the MiniMax AI platform. Use when the user wants to create media content, chat with MiniMax models, perform web search, or manage MiniMax API resources from the terminal.
---

# MiniMax CLI — Agent Skill Guide

Use `mmx` to generate text, images, video, speech, and perform web search via the MiniMax AI platform.

## Prerequisites

```bash
# Install
npm install -g mmx-cli

# Auth (OAuth persists to ~/.mmx/credentials.json, API key persists to ~/.mmx/config.json)
mmx auth login --api-key sk-xxxxx

# Verify active auth source
mmx auth status

# Or pass per-call
mmx text chat --api-key sk-xxxxx --message "Hello"
```

Region is auto-detected. Override with `--region global` or `--region cn`.

---

## Agent Flags

Always use these flags in non-interactive (agent/CI) contexts:

| Flag | Purpose |
|---|---|
| `--non-interactive` | Fail fast on missing args instead of prompting |
| `--quiet` | Suppress spinners/progress; stdout is pure data |
| `--output json` | Machine-readable JSON output |
| `--async` | Return task ID immediately (video generation) |
| `--dry-run` | Preview the API request without executing |
| `--yes` | Skip confirmation prompts |

---

## Commands

### text chat

Chat completion. Default model: `MiniMax-M3`.

```bash
mmx text chat --message <text> [flags]
```

| Flag | Type | Description |
|---|---|---|
| `--message <text>` | string, **required**, repeatable | Message text. Prefix with `role:` to set role (e.g. `"system:You are helpful"`, `"user:Hello"`) |
| `--messages-file <path>` | string | JSON file with messages array. Use `-` for stdin |
| `--system <text>` | string | System prompt |
| `--model <model>` | string | Model ID (default: `MiniMax-M3`) |
| `--max-tokens <n>` | number | Max tokens (default: 4096) |
| `--temperature <n>` | number | Sampling temperature (0.0, 1.0] |
| `--top-p <n>` | number | Nucleus sampling threshold |
| `--stream` | boolean | Stream tokens (default: on in TTY) |
| `--tool <json-or-path>` | string, repeatable | Tool definition JSON or file path |

```bash
# Single message
mmx text chat --message "user:What is MiniMax?" --output json --quiet

# Multi-turn
mmx text chat \
  --system "You are a coding assistant." \
  --message "user:Write fizzbuzz in Python" \
  --output json

# From file
cat conversation.json | mmx text chat --messages-file - --output json
```

**stdout**: response text (text mode) or full response object (json mode).

---

### image generate

Generate images. Model: `image-01`.

```bash
mmx image generate --prompt <text> [flags]
```

| Flag | Type | Description |
|---|---|---|
| `--prompt <text>` | string, **required** | Image description |
| `--aspect-ratio <ratio>` | string | e.g. `16:9`, `1:1`. Ignored if `--width` and `--height` are both set |
| `--n <count>` | number | Number of images (default: 1) |
| `--seed <n>` | number | Random seed for reproducible generation |
| `--width <px>` | number | Width in pixels (512–2048, multiple of 8). Requires `--height` |
| `--height <px>` | number | Height in pixels (512–2048, multiple of 8). Requires `--width` |
| `--prompt-optimizer` | boolean | Optimize prompt before generation |
| `--aigc-watermark` | boolean | Embed AI-generated content watermark |
| `--subject-ref <params>` | string | Subject reference: `type=character,image=path-or-url` |
| `--response-format <format>` | string | `url` (default) or `base64`. Base64 bypasses CDN download |
| `--out-dir <dir>` | string | Download images to directory |
| `--out-prefix <prefix>` | string | Filename prefix (default: `image`) |

```bash
mmx image generate --prompt "A cat in a spacesuit" --output json --quiet
# stdout: image URLs (one per line in quiet mode)

mmx image generate --prompt "Logo" --n 3 --out-dir ./gen/ --quiet
# stdout: saved file paths (one per line)
```

---

### video generate

Generate video. Default model: `MiniMax-Hailuo-2.3` (or `MiniMax-Hailuo-2.3-Fast` for fast mode with `--image`). This is an async task — by default it polls until completion.

For `MiniMax-H3` — text-to-video, first/last-frame, multimodal reference image/video/audio generation, prompt construction, and failure handling — use the dedicated [mmx-h3-video skill](h3-video/SKILL.md) instead.

```bash
mmx video generate --prompt <text> [flags]
```

| Flag | Type | Description |
|---|---|---|
| `--prompt <text>` | string, **required** | Video description |
| `--model <model>` | string | `MiniMax-Hailuo-2.3` (default) or `MiniMax-Hailuo-2.3-Fast` |
| `--image <path-or-url>` | string | Input image for image-to-video |
| `--last-frame <path-or-url>` | string | Optional ending image for frame interpolation (used with `--image`) |
| `--callback-url <url>` | string | Webhook URL for completion |
| `--download <path>` | string | Save video to specific file |
| `--async` | boolean | Return task ID immediately |
| `--no-wait` | boolean | Same as `--async` |
| `--poll-interval <seconds>` | number | Polling interval (default: 5) |

```bash
# Non-blocking: get task ID
mmx video generate --prompt "A robot." --async --quiet
# stdout: {"taskId":"..."}

# Blocking: wait and get file path
mmx video generate --prompt "Ocean waves." --download ocean.mp4 --quiet
# stdout: ocean.mp4
```

### video task get

Query status of a video generation task.

```bash
mmx video task get --task-id <id> [--output json]
```

### video download

Download a completed video by task ID.

```bash
mmx video download --file-id <id> [--out <path>]
```

---

### speech synthesize

Text-to-speech. Default model: `speech-2.8-hd`. Max 10k chars.

```bash
mmx speech synthesize --text <text> [flags]
```

| Flag | Type | Description |
|---|---|---|
| `--text <text>` | string | Text to synthesize |
| `--text-file <path>` | string | Read text from file. Use `-` for stdin |
| `--model <model>` | string | `speech-2.8-hd` (default), `speech-2.6`, `speech-02` |
| `--voice <id>` | string | Voice ID (default: `English_expressive_narrator`) |
| `--speed <n>` | number | Speed multiplier |
| `--volume <n>` | number | Volume level |
| `--pitch <n>` | number | Pitch adjustment |
| `--format <fmt>` | string | Audio format (default: `mp3`) |
| `--sample-rate <hz>` | number | Sample rate (default: 32000) |
| `--bitrate <bps>` | number | Bitrate (default: 128000) |
| `--channels <n>` | number | Audio channels (default: 1) |
| `--language <code>` | string | Language boost |
| `--subtitles` | boolean | Download and save subtitles as `.srt` file (alongside `--out` audio file). API must support subtitles for the selected model.
| `--pronunciation <from/to>` | string, repeatable | Custom pronunciation |
| `--sound-effect <effect>` | string | Add sound effect |
| `--out <path>` | string | Save audio to file |
| `--stream` | boolean | Stream raw audio to stdout |

```bash
mmx speech synthesize --text "Hello world" --out hello.mp3 --quiet
# stdout: hello.mp3

mmx speech synthesize --text "Hello" --subtitles --out hello.mp3
# saves hello.mp3 + hello.srt (SRT subtitle file)

echo "Breaking news." | mmx speech synthesize --text-file - --out news.mp3
```

---

### vision describe

Image understanding via VLM. Provide either `--image` or `--file-id`, not both.

```bash
mmx vision describe (--image <path-or-url> | --file-id <id>) [flags]
```

| Flag | Type | Description |
|---|---|---|
| `--image <path-or-url>` | string | Local path or URL (auto base64-encoded) |
| `--file-id <id>` | string | Pre-uploaded file ID (skips base64) |
| `--prompt <text>` | string | Question about the image (default: `"Describe the image."`) |

```bash
mmx vision describe --image photo.jpg --prompt "What breed?" --output json
```

**stdout**: description text (text mode) or full response (json mode).

---

### search query

Web search via MiniMax.

```bash
mmx search query --q <query>
```

| Flag | Type | Description |
|---|---|---|
| `--q <query>` | string, **required** | Search query |

```bash
mmx search query --q "MiniMax AI" --output json --quiet
```

---

### quota show

Display Token Plan usage and remaining quotas.

```bash
mmx quota show [--output json]
```

---

## Tool Schema Export

Export all commands as Anthropic/OpenAI-compatible JSON tool schemas:

```bash
# All tool-worthy commands (excludes auth/config/update)
mmx config export-schema

# Single command
mmx config export-schema --command "video generate"
```

Use this to dynamically register mmx commands as tools in your agent framework.

---

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Usage error (bad flags, missing args) |
| 3 | Authentication error |
| 4 | Quota exceeded |
| 5 | Timeout |
| 10 | Content filter triggered |

---

## Piping Patterns

```bash
# stdout is always clean data — safe to pipe
mmx text chat --message "Hi" --output json | jq '.content'

# stderr has progress/spinners — discard if needed
mmx video generate --prompt "Waves" 2>/dev/null

# Chain: generate image → describe it
URL=$(mmx image generate --prompt "A sunset" --quiet)
mmx vision describe --image "$URL" --quiet

# Async video workflow
TASK=$(mmx video generate --prompt "A robot" --async --quiet | jq -r '.taskId')
mmx video task get --task-id "$TASK" --output json
mmx video download --task-id "$TASK" --out robot.mp4
```

---

## Configuration Precedence

CLI flags → environment variables → `~/.mmx/config.json` → defaults.

```bash
# Persistent config
mmx config set --key region --value cn
mmx config show

# Environment
export MINIMAX_API_KEY=sk-xxxxx
export MINIMAX_REGION=cn
```

### Default Model Configuration

Set per-modality defaults so you don't need `--model` every time:

```bash
# Set defaults
mmx config set --key default-text-model --value MiniMax-M3
mmx config set --key default-speech-model --value speech-2.8-hd
mmx config set --key default-video-model --value MiniMax-Hailuo-2.3

# Use without --model
mmx text chat --message "Hello"
mmx speech synthesize --text "Hello" --out hello.mp3
mmx video generate --prompt "Ocean waves"

# --model still overrides per-call
mmx text chat --model MiniMax-M3 --message "Hello"
```

**Resolution priority**: `--model` flag > config default > hardcoded fallback.
