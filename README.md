<img src="https://file.cdn.minimax.io/public/MMX-capabilities.png" alt="MiniMax" width="100%" />

<p align="center">
  <strong>The official CLI for the MiniMax AI Platform</strong><br>
  Built for AI agents. Generate text, images, video, and speech — from any agent or terminal.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/mmx-cli"><img src="https://img.shields.io/npm/v/mmx-cli.svg" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js >= 18" /></a>
</p>

<p align="center">
  <a href="README_CN.md">中文文档</a> · <a href="https://platform.minimax.io">Global Platform</a> · <a href="https://platform.minimaxi.com">CN Platform</a> · <a href="https://platform.minimax.io/docs/token-plan/minimax-cli">Example</a>
</p>

## Features

- **Text** — Multi-turn chat, streaming, system prompts, JSON output
- **Image** — Text-to-image with aspect ratio and batch controls
- **Video** — Async video generation with progress tracking
- **Speech** — TTS with 30+ voices, speed control, streaming playback
- **Vision** — Image understanding and description
- **Search** — Web search powered by MiniMax
- **Dual Region** — Seamless Global (`api.minimax.io`) and CN (`api.minimaxi.com`) support

<img src="https://file.cdn.minimax.io/public/MMX-CLI-help.png" alt="MiniMax" width="100%" />

## Install

```bash
# For AI agents (OpenClaw, Cursor, Claude Code, etc.): add skill to your agent
npx skills add MiniMax-AI/cli -y -g

# Or install CLI globally for terminal use
npm install -g mmx-cli
```

> Requires [Node.js](https://nodejs.org) 18+

> **Requires a MiniMax Token Plan** — [Global](https://platform.minimax.io/subscribe/token-plan) · [CN](https://platform.minimaxi.com/subscribe/token-plan)

## Quick Start

```bash
# Authenticate (interactive — choose MiniMax OAuth or paste an API key)
mmx auth login

# Or non-interactive
mmx auth login --api-key sk-xxxxx

# Start creating
mmx text chat --message "What is MiniMax?"
mmx image "A cat in a spacesuit"
mmx speech synthesize --text "Hello!" --out hello.mp3
mmx video generate --prompt "Ocean waves at sunset"
mmx search "MiniMax AI latest news"
mmx vision photo.jpg
mmx quota
```

## Releasing

Maintainers publish releases by pushing a SemVer Git tag; the release workflow
derives the npm package version from that tag. See [the release guide](docs/releasing.md).

## Commands

### `mmx text`

```bash
mmx text chat --message "Write a poem"
mmx text chat --model MiniMax-M3 --message "Hello" --stream
mmx text chat --system "You are a coding assistant" --message "Fizzbuzz in Go"
mmx text chat --message "user:Hi" --message "assistant:Hey!" --message "How are you?"
cat messages.json | mmx text chat --messages-file - --output json
```

### `mmx image`

```bash
mmx image "A cat in a spacesuit"
mmx image generate --prompt "A cat" --n 3 --aspect-ratio 16:9
mmx image generate --prompt "Logo" --out-dir ./out/
```

### `mmx video`

```bash
# Hailuo-2.3 (Video Generation V1)
mmx video generate --prompt "Ocean waves at sunset" --download sunset.mp4
mmx video generate --prompt "A robot painting" --async

# MiniMax-H3 (Video Generation V2)
mmx video generate --api-key "$MINIMAX_API_KEY" --model MiniMax-H3 --prompt "Ocean waves at sunset"
mmx video generate --api-key "$MINIMAX_API_KEY" --model MiniMax-H3 --prompt "The subject walks forward" --image start.jpg
mmx video generate --api-key "$MINIMAX_API_KEY" --model MiniMax-H3 --prompt "Keep the same character" --reference-image character.png --reference-video motion.mp4

mmx video task get --task-id 123456
mmx video task get --task-id 424010985738629 --model MiniMax-H3
mmx video download --file-id 176844028768320 --out video.mp4
```

For MiniMax-H3, local files and Base64 data URIs are preflight-checked against the documented limits: image 30 MB, reference video 50 MB, reference audio 15 MB, and total JSON request body 64 MB. The API validates dimensions, aspect ratio, duration, frame rate, and codecs for all media.

`--region` is an existing global CLI option, not an H3 parameter. Normal video generation does not need it; the CLI uses the saved or automatically detected region. H3 defaults to 2K, 5 seconds, and 16:9 for text-to-video.

### `mmx speech`

```bash
mmx speech synthesize --text "Hello!" --out hello.mp3
mmx speech synthesize --text "Stream me" --stream | mpv -
mmx speech synthesize --text "Hi" --voice English_magnetic_voiced_man --speed 1.2
echo "Breaking news" | mmx speech synthesize --text-file - --out news.mp3
mmx speech voices
```

### `mmx vision`

```bash
mmx vision photo.jpg
mmx vision describe --image https://example.com/img.jpg --prompt "What breed?"
mmx vision describe --file-id file-123
```

### `mmx search`

```bash
mmx search "MiniMax AI"
mmx search query --q "latest news" --output json
```

> The `/v1/coding_plan/search` API returns at most 10 results per call and does not currently expose a pagination parameter (see #107). Refine your query if you need different results.

### `mmx auth`

```bash
mmx auth login                              # interactive: pick OAuth (Global / China) or paste an API key
mmx auth login --api-key sk-xxxxx           # save an API key directly
mmx auth login --recommend                  # skip the menu, pick OAuth region interactively
mmx auth login --recommend --region=global  # OAuth → api.minimax.io
mmx auth login --recommend --region=cn      # OAuth → api.minimaxi.com
mmx auth status
mmx auth refresh
mmx auth logout
```

`mmx auth status` is the canonical way to verify active authentication.

**OAuth** uses the [Device Authorization Grant (RFC 8628)](https://tools.ietf.org/html/rfc8628) with PKCE —
the CLI opens your browser, you enter a code, and `access_token` + `refresh_token`
are saved to `~/.mmx/config.json`. Tokens refresh automatically (5-min buffer);
manual refresh via `mmx auth refresh`.

**API key** auth auto-detects the correct region by probing both Global and CN.
Useful for CI/CD (`mmx auth login --api-key sk-xxxxx`), or pass per-command via `--api-key`.

OAuth and API key are mutually exclusive — logging in with one clears the other.
Credential priority: `--api-key` flag > `MINIMAX_API_KEY` > OAuth (config) > `api_key` (config).

### Environment variables

| Variable | Description |
|---|---|
| `MINIMAX_API_KEY` | API key for non-interactive use. Overridden by `--api-key`; overrides saved credentials. |
| `MINIMAX_REGION` | `global` or `cn`. |
| `MINIMAX_BASE_URL` | Override the API base URL. |
| `MINIMAX_OUTPUT` | `text` or `json`. |
| `MINIMAX_TIMEOUT` | Request timeout in seconds. |
| `MINIMAX_VERBOSE` | `1` to enable verbose HTTP logging. |
| `MMX_CONFIG_DIR` | Directory containing the `config.json` file (default: `~/.mmx`). Set this when `mmx` runs from a subprocess, service, or CI job whose home directory differs from where you logged in. |

### `mmx config` · `mmx quota`

```bash
mmx quota
mmx config show
mmx config set --key region --value cn
mmx config set --key default-text-model --value MiniMax-M3
mmx config export-schema | jq .
```

### `mmx agent setup`

Configure MiniMax for Claude Code, Codex, Grok Build, OpenCode, Hermes, or Pi while preserving unrelated settings. Run without options for the interactive wizard; supplying options makes the command non-interactive and suitable for scripts.

```bash
mmx agent setup
mmx agent setup --agent codex --agent claude-code --api-key "$MINIMAX_API_KEY" --region global
mmx agent setup --all --api-key "$MINIMAX_API_KEY" --region cn --output json
```

The command verifies the key and selected region before writing. Existing files are backed up when changed; use `--dry-run` to preview without a live request. In the interactive wizard, compatible agents that are missing from `PATH` can be installed from a second multi-select list using their official packages or installer scripts. The Hermes install uses its official core CLI stages and skips optional system packages, Node workspace, browser, computer-use, setup, and gateway stages. After installation, mmx applies the MiniMax configuration while preserving installer settings. Agents that fail a platform or prerequisite check are explained and left configuration-only. Non-interactive invocations remain configuration-only, and the command never launches an agent.

### `mmx update`

```bash
mmx update
mmx update latest
```

## Thanks to

<a href="https://github.com/MiniMax-AI/cli/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=MiniMax-AI/cli" />
</a>

## License

[MIT](LICENSE)
