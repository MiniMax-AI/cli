# MiniMax CLI Error Reference

This document lists all error scenarios and the messages users will see.

## Auth Commands

### `minimax auth login`

| Scenario | Error Message |
|---|---|
| `--method api-key` without `--api-key` | `--api-key is required when using --method api-key.` |
| API key validation failed | `API key validation failed.` |
| OAuth callback timeout (120s) | `OAuth callback timed out.` |
| OAuth state mismatch | `Invalid OAuth callback.` |
| OAuth error in callback | `OAuth error: ${error}` |
| OAuth token exchange failed | `OAuth token exchange failed: ${body}` |
| `MINIMAX_API_KEY` already set (non-interactive) | `Warning: MINIMAX_API_KEY is already set in environment.` |

### `minimax auth logout`

| Scenario | Error Message |
|---|---|
| No credentials to clear | `No credentials to clear.` |

### `minimax auth refresh`

| Scenario | Error Message |
|---|---|
| No OAuth credentials (api-key mode) | `Not applicable: not authenticated via OAuth.` |
| Refresh token expired | `OAuth session expired and could not be refreshed.` |

### `minimax auth status`

| Scenario | Error Message |
|---|---|
| No credentials | `authenticated: false` + `Not authenticated.` |
| Quota request failed | `Failed to fetch quota: ${err.message}` |

---

## Text Commands

### `minimax text chat`

| Scenario | Error Message |
|---|---|
| No `--message` in non-interactive mode | `Missing required argument: --message` |
| `--messages-file` file not found | `File not found: ${filePath}` |
| `--messages-file` content is not valid JSON | `--messages-file content is not valid JSON.` |
| `--tool` not valid JSON (not a file path) | `--tool argument "${t}" is not valid JSON.` |
| `--tool` file not found | `Tool definition file not found: ${t}` |
| `--tool` file exists but invalid JSON | `Tool definition file "${t}" contains invalid JSON.` |
| Stream disconnected mid-response | `Stream disconnected before response completed.` |

---

## Image Commands

### `minimax image generate`

| Scenario | Error Message |
|---|---|
| No `--prompt` in non-interactive mode | `Missing required argument: --prompt` |
| `--subject-ref` local image not found | `Subject reference image not found: ${params.image}` |
| `--subject-ref` image unreadable | `Cannot read image file: ${e.message}` |
| `--out-dir` no write permission | `Permission denied: cannot create directory "${outDir}".` |
| `--out-dir` other error | `Cannot create directory "${outDir}": ${e.message}` |
| `success_count === 0` (all rejected) | `Image generation failed: all images were rejected (content policy or model error).` |

---

## Video Commands

### `minimax video generate`

| Scenario | Error Message |
|---|---|
| No `--prompt` in non-interactive mode | `Missing required argument: --prompt` |
| `--first-frame` file not found | `First-frame image not found: ${framePath}` |
| `--first-frame` file unreadable | `Cannot read image file: ${e.message}` |
| Task status `Failed` | `Task Failed: ${status_msg}` (when `base_resp.status_code` is 0 or absent); otherwise [API Errors](#api-errors) apply |
| Task status `Unknown` | `Task Unknown: ${status_msg}` (when `base_resp.status_code` is 0 or absent); otherwise [API Errors](#api-errors) apply |
| Success but no `file_id` | `Task completed but no file_id returned.` |
| `file_id` has no `download_url` | `No download URL available for this file.` |
| Polling timeout | `Polling timed out.` |
| Download network interrupted | `Network request failed.` |
| Disk full | `Disk full — cannot write video file.` |
| `--download` path no write permission | `Cannot write file: ${e.message}` |

### `minimax video task get`

| Scenario | Error Message |
|---|---|
| No `--task-id` | `--task-id is required.` |

### `minimax video download`

| Scenario | Error Message |
|---|---|
| No `--file-id` | `--file-id is required.` |
| No `--out` | `--out is required.` |
| `download_url` is empty | `No download URL available for this file.` |
| Download failed (HTTP error) | `Download failed: HTTP ${res.status}` |
| Disk full | `Disk full — cannot write video file.` |
| Output path no write permission | `Cannot write file: ${e.message}` |

---

## Speech Commands

### `minimax speech synthesize`

| Scenario | Error Message |
|---|---|
| No `--text` and no `--text-file` | `--text or --text-file is required.` |
| `--text-file` not found | `File not found: ${flags.textFile}` |
| `--text-file` unreadable | `Cannot read file: ${e.message}` |
| `--out` path no write permission | `Permission denied: cannot write to "${outPath}".` |
| Disk full | `Disk full — cannot write audio file.` |

### `minimax speech voices`

All errors fall under [Network Errors](#networkerrors).

---

## Music Commands

### `minimax music generate`

| Scenario | Error Message |
|---|---|
| Neither `--prompt` nor `--lyrics` provided | `At least one of --prompt or --lyrics is required.` |
| `--lyrics-file` not found | `File not found: ${flags.lyricsFile}` |
| `--lyrics-file` unreadable | `Cannot read file: ${e.message}` |
| `--out` path no write permission | `Permission denied: cannot write to "${outPath}".` |
| Disk full | `Disk full — cannot write audio file.` |

---

## Vision Commands

### `minimax vision describe`

| Scenario | Error Message |
|---|---|
| Neither `--image` nor `--file-id` in non-interactive mode | `Missing required argument. Must provide either --image or --file-id.` |
| Both `--image` and `--file-id` provided | `Conflicting arguments: cannot provide both --image and --file-id.` |
| Local image file not found | `File not found: ${image}` |
| Image format not supported | `Unsupported image format "${ext}". Supported: jpg, jpeg, png, webp` |
| Remote image URL download failed | `Failed to download image: HTTP ${res.status}` |

---

## Search Commands

### `minimax search query`

| Scenario | Error Message |
|---|---|
| No `--q` in non-interactive mode | `--q is required.` |

---

## Quota Commands

### `minimax quota show`

All errors fall under [Network Errors](#networkerrors).

---

## Config Commands

### `minimax config set`

| Scenario | Error Message |
|---|---|
| `--key` or `--value` missing | `--key and --value are required.` |
| `key` not in valid list | `Invalid config key "${key}". Valid keys: region, base_url, output, timeout, api_key` |
| `region` value invalid | `Invalid region "${value}". Valid values: global, cn` |
| `output` value invalid | `Invalid output format "${value}". Valid values: text, json` |
| `timeout` not a positive number | `Invalid timeout "${value}". Must be a positive number.` |

### `minimax config export-schema`

| Scenario | Error Message |
|---|---|
| `--command` specifies non-existent command | `Command "${targetCommand}" not found.` |

---

## Update Commands

### `minimax update`

No error scenarios — prints a message directing users to run `npm update -g minimax-cli` manually.

---

## File Commands

### `minimax file upload`

| Scenario | Error Message |
|---|---|
| `--file` local file not found | `File not found: ${fullPath}` |
| API error (size limit, unsupported type, etc.) | [API Errors](#api-errors) apply |

### `minimax file delete`

| Scenario | Error Message |
|---|---|
| No `--file-id` in non-interactive mode | `Missing required argument: --file-id` |

### `minimax file list`

| Scenario | Error Message |
|---|---|
| All errors fall under [Network Errors](#networkerrors) | |

---

## Global Errors (All Commands)

### Network Errors

| Scenario | Error Message |
|---|---|
| Network/connection failure | `Network request failed.` + hint: `Check your network connection and proxy settings.` |
| Proxy error detected | `Network request failed.` + hint: `Proxy error — check HTTP_PROXY / HTTPS_PROXY environment variables and proxy authentication.` |
| Request timeout (AbortSignal) | `Request timed out.` |
| HTTP 408 / 504 | `Request timed out (HTTP ${status}).` |

### API Errors

| Scenario | Error Message |
|---|---|
| HTTP 401 / 403 | `API key rejected (HTTP ${status}).` |
| HTTP 429 | `Rate limit or quota exceeded. ${apiMsg}` |
| `status_code` 1002 / 1039 (content filter) | `Input content flagged by sensitivity filter (${filterType}).` |
| `status_code` 1028 / 1030 (quota exhausted) | `Quota exhausted. ${apiMsg}` |
| `status_code` 2061 (model not on plan) | `This model is not available on your current Token Plan. ${apiMsg}` |
| Other API errors | `API error: ${apiMsg} (HTTP ${status})` |
| Non-JSON response body (e.g., gateway 502) | `API returned non-JSON response (${contentType}). Server may be experiencing issues.` |

### File System Errors

| Scenario | Error Message |
|---|---|
| File not found | `File system error: ENOENT: no such file or directory...` + hint |
| Permission denied | `File system error: EACCES: permission denied...` + hint |
| Disk full | `File system error: ENOSPC: no space left on device...` + hint |
| Other FS errors | `File system error: ${err.message}` + hint |

### Process Signals

| Scenario | Error Message |
|---|---|
| Ctrl+C / SIGINT | `Interrupted. Exiting.` (exit code 130) |

### Config / Credentials File Corruption

| Scenario | Behavior |
|---|---|
| `~/.minimax/credentials.json` corrupted | Warning written to stderr; treated as no credentials |
| `~/.minimax/config.json` corrupted | Warning written to stderr; treated as empty config |

### Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Usage error (invalid arguments) |
| 3 | Authentication error |
| 4 | Quota error |
| 5 | Timeout |
| 6 | Network error |
| 10 | Content filter |
| 130 | Interrupted (Ctrl+C / SIGINT) |
