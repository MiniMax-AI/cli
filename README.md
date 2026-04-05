<p align="center">
  <img src="assets/logo.png" alt="MiniMax" width="320" />
</p>

<p align="center">
  <strong>The official CLI for the MiniMax AI Platform</strong><br>
  Generate text, images, video, speech, and music — all from your terminal.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/minimax-cli"><img src="https://img.shields.io/npm/v/minimax-cli.svg" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js >= 18" /></a>
</p>

<p align="center">
  <a href="README_CN.md">中文文档</a> · <a href="https://platform.minimax.io">Platform</a>
</p>

## Features

- **Text** — Multi-turn chat, streaming, system prompts, JSON output
- **Image** — Text-to-image with aspect ratio and batch controls
- **Video** — Async video generation with progress tracking
- **Speech** — TTS with 30+ voices, speed control, streaming playback
- **Music** — Text-to-music with optional lyrics
- **Vision** — Image understanding and description
- **Search** — Web search powered by MiniMax
- **Dual Region** — Seamless Global (`api.minimax.io`) and CN (`api.minimaxi.com`) support

## Install

```bash
npm install -g minimax-cli
```

> Requires [Node.js](https://nodejs.org) 18+

## Quick Start

```bash
# Authenticate
minimax auth login --api-key sk-xxxxx

# Start creating
minimax text chat --message "What is MiniMax?"
minimax image "A cat in a spacesuit"
minimax speech synthesize --text "Hello!" --out hello.mp3
minimax video generate --prompt "Ocean waves at sunset"
minimax music "Upbeat pop"
minimax search "MiniMax AI latest news"
minimax vision photo.jpg
minimax quota
```

## Commands

### `minimax text`

```bash
minimax text chat --message "Write a poem"
minimax text chat --model MiniMax-M2.7-highspeed --message "Hello" --stream
minimax text chat --system "You are a coding assistant" --message "Fizzbuzz in Go"
minimax text chat --message "user:Hi" --message "assistant:Hey!" --message "How are you?"
cat messages.json | minimax text chat --messages-file - --output json
```

### `minimax image`

```bash
minimax image "A cat in a spacesuit"
minimax image generate --prompt "A cat" --n 3 --aspect-ratio 16:9
minimax image generate --prompt "Logo" --out-dir ./out/
```

### `minimax video`

```bash
minimax video generate --prompt "Ocean waves at sunset" --async
minimax video generate --prompt "A robot painting" --download sunset.mp4
minimax video task get --task-id 123456
minimax video download --file-id 176844028768320 --out video.mp4
```

### `minimax speech`

```bash
minimax speech synthesize --text "Hello!" --out hello.mp3
minimax speech synthesize --text "Stream me" --stream | mpv -
minimax speech synthesize --text "Hi" --voice Boyan_new_hailuo --speed 1.2
echo "Breaking news" | minimax speech synthesize --text-file - --out news.mp3
minimax speech voices
```

### `minimax music`

```bash
minimax music "Upbeat pop"
minimax music generate --prompt "Jazz" --lyrics "La la la" --out song.mp3
```

### `minimax vision`

```bash
minimax vision photo.jpg
minimax vision describe --image https://example.com/img.jpg --prompt "What breed?"
minimax vision describe --file-id file-123
```

### `minimax search`

```bash
minimax search "MiniMax AI"
minimax search query --q "latest news" --output json
```

### `minimax auth`

```bash
minimax auth login --api-key sk-xxxxx
minimax auth login                    # OAuth browser flow
minimax auth status
minimax auth refresh
minimax auth logout
```

### `minimax config` · `minimax quota`

```bash
minimax quota
minimax config show
minimax config set --key region --value cn
minimax config export-schema | jq .
```

### `minimax update`

```bash
minimax update
minimax update latest
```

## License

[MIT](LICENSE)
