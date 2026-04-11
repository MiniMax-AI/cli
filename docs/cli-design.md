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
│   └── chat               Send a chat completion (M2.7 / M2.7-highspeed)
├── speech
│   └── synthesize         Synchronous TTS, ≤10k chars
├── image
│   └── generate           Generate images (image-01)
├── video
│   ├── generate           Create a video generation task
│   ├── task
│   │   └── get            Query video task status
│   └── download           Download a completed video by file ID
├── music
│   └── generate           Generate a song (music-2.5)
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
1. `--api-key` flag (highest priority)
2. `~/.mmx/credentials.json` (OAuth token — only created by `mmx auth login` without `--api-key`)
3. `fileApiKey` in `~/.mmx/config.json` (persisted API key from a previous `mmx auth login --api-key`)

If none are found, the CLI returns `No credentials found`. The `~/.mmx/credentials.json` file
is **not required** when using API key auth — it is only created during OAuth login.

## Configuration

Config precedence: flag > env var > config file > default.

Config file: `~/.mmx/config.yaml`
