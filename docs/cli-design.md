# mmx CLI Design

## Command Grammar

All commands follow `resource + verb`:

```
mmx <resource> <verb> [flags]
```

## Command Tree

```
mmx
├── auth
│   ├── login              Authenticate via OAuth or API key
│   ├── status             Show current authentication state
│   ├── refresh            Manually refresh OAuth token
│   └── logout             Revoke tokens and clear stored credentials
├── text
│   └── chat               Send a chat completion (M3)
├── speech
│   ├── synthesize         Synchronous TTS over HTTP, ≤10k chars
│   ├── websocket          Synchronous TTS over WebSocket (streaming)
│   ├── async              Create an asynchronous TTS task (long-form)
│   ├── task
│   │   └── get            Query an asynchronous TTS task status
│   └── voices             List system voices
├── image
│   └── generate           Generate images (image-01)
├── video
│   ├── generate           Create a video generation task
│   ├── task
│   │   └── get            Query video task status
│   └── download           Download a completed video by file ID
├── music
│   └── generate           Generate a song (music-3.0)
├── quota
│   └── show               Display Token Plan usage and remaining quotas
└── config
    ├── show               Display current configuration
    └── set                Set a config value
```

## Exit Codes

| Code | Meaning                          |
|------|----------------------------------|
| 0    | Success                          |
| 1    | General / server error           |
| 2    | Usage error (bad flags)          |
| 3    | Authentication error             |
| 4    | Rate limit or quota exceeded     |
| 5    | Timeout                          |
| 10   | Content sensitivity filter       |

## Authentication

Credential resolution order:
1. `--api-key` flag
2. `$MINIMAX_API_KEY` env var
3. `~/.mmx/credentials.json` (OAuth)
4. `api_key` in `~/.mmx/config.yaml`

## Configuration

Config precedence: flag > env var > config file > default.

Config file: `~/.mmx/config.yaml`
