# minimax-cli

CLI for the [MiniMax AI Platform](https://platform.minimax.io) — generate text, images, video, speech, and music from the terminal.

Supports **Global** (`api.minimax.io`) and **CN** (`api.minimaxi.com`) with automatic region detection.

[中文文档](README_CN.md)

---

## Install

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install -g minimax-cli
```

---

## Quick Start

```bash
minimax auth login --api-key sk-xxxxx

minimax text chat --message "What is MiniMax?"
minimax image "A cat in a spacesuit"
minimax speech synthesize --text "Hello!" --out hello.mp3
minimax search "MiniMax AI latest news"
minimax vision photo.jpg
minimax quota
```

---

## Commands

### Text

```bash
minimax text chat --message "Write a poem"
minimax text chat --model MiniMax-M2.7-highspeed --message "Hello" --stream
minimax text chat --system "You are a coding assistant" --message "Fizzbuzz in Go"
minimax text chat --message "user:Hi" --message "assistant:Hey!" --message "How are you?"
cat messages.json | minimax text chat --messages-file - --output json
```

### Image

```bash
minimax image "A cat in a spacesuit"              # shorthand
minimax image generate --prompt "A cat" --n 3 --aspect-ratio 16:9
minimax image generate --prompt "Logo" --out-dir ./out/
```

### Video

```bash
minimax video generate --prompt "Ocean waves at sunset" --async
minimax video generate --prompt "A robot painting" --download sunset.mp4
minimax video task get --task-id 123456
minimax video download --file-id 176844028768320 --out video.mp4
```

### Speech

```bash
minimax speech synthesize --text "Hello!" --out hello.mp3
minimax speech synthesize --text "Stream me" --stream | mpv -
minimax speech synthesize --text "Hi" --voice Boyan_new_hailuo --speed 1.2
echo "Breaking news" | minimax speech synthesize --text-file - --out news.mp3
minimax speech voices
```

### Music

```bash
minimax music "Upbeat pop"                        # shorthand
minimax music generate --prompt "Jazz" --lyrics "La la la" --out song.mp3
```

### Vision

```bash
minimax vision photo.jpg                          # shorthand
minimax vision describe --image https://example.com/img.jpg --prompt "What breed?"
minimax vision describe --file-id file-123
```

### Search

```bash
minimax search "MiniMax AI"                       # shorthand
minimax search query --q "latest news" --output json
```

### Quota & Config

```bash
minimax quota
minimax config show
minimax config set --key region --value cn
minimax config export-schema | jq .
```

### Auth

```bash
minimax auth login --api-key sk-xxxxx
minimax auth login                    # OAuth browser flow
minimax auth status
minimax auth refresh
minimax auth logout
```

### Update

```bash
minimax update
minimax update latest
```

---

## License

MIT
