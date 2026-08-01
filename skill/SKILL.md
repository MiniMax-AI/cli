---
name: mmx-h3-video
description: Generate, monitor, and download MiniMax-H3 videos through the mmx CLI. Use for H3 text-to-video, first/last-frame video, multimodal reference image/video/audio generation, H3 prompt improvement, media preflight, Pay-as-you-go API key selection, task waiting, downloads, and H3 failure handling.
---

# MiniMax-H3 Video With MMX

Use this skill only for `MiniMax-H3` video generation. Do not handle text, image generation, speech, music, search, legacy Hailuo models, or unrelated MMX commands.

Before a paid request, read `references/h3-video.md` for prompt construction, media constraints, waiting behavior, and failure handling.

## Required Rules

1. Use a Pay-as-you-go/Credit API Key. H3 does not use OAuth or Token Plan Subscription Keys.
2. Reuse a saved MMX API key when available. Never print, repeat, or place a literal API key in a command transcript.
3. Always pass `--model MiniMax-H3`; never rely on the configured default model.
4. For a completed video, run one direct blocking `mmx video generate` command. Do not use Bash wrappers or hand-written polling loops.
5. If the terminal command remains active, wait on that exact execution session. Do not run `ps`, scrape process arguments, inspect the output repeatedly, kill the process, or submit another task.
6. Treat `Detecting region... cn` or `Detecting region... global` as normal stderr progress, not a submission failure.
7. Never submit a replacement paid task because terminal waiting, status polling, or downloading was interrupted.
8. Retry the alternate region at most once, and only when the first command clearly failed before task creation because of region detection, endpoint, or authentication routing.
9. Use `--async` only when the user explicitly wants a task ID without waiting or downloading.

## Resolve The CLI

Inside the `minimax-cli` repository, build changes and use the local artifact:

```bash
bun run build
node ./dist/mmx.mjs video generate --help
```

Outside the repository, use the installed `mmx` executable. Do not install or update MMX unless the user asks.

In commands below, replace `mmx` with `node ./dist/mmx.mjs` when testing the local repository build.

## Resolve And Save The API Key

Before the first paid H3 request, inspect the active credential without exposing it:

```bash
mmx auth status --output json --quiet
```

- If `method` is `api-key`, reuse it from MMX config. Do not add `--api-key` to generation commands.
- If the user already supplied a key and the runtime holds it securely as `MINIMAX_API_KEY`, save it once, then use MMX config:

```bash
mmx config set --key api_key --value "$MINIMAX_API_KEY" --quiet
```

- Saving `api_key` replaces stale OAuth credentials, clears the cached region, and stores the key in `~/.mmx/config.json` with owner-only permissions.
- Never reconstruct a previously supplied key into visible shell text. Use the runtime's secret/environment injection when available.
- If no saved API key or securely injected variable is available, ask the user to run `mmx auth login` and choose API key. Do not ask them to paste the key into chat again.
- After saving, future Agent commands must omit both the literal key and `--api-key`.

## Default Completed-Video Path

Use this path when the user wants the final file:

```bash
mmx video generate \
  --model MiniMax-H3 \
  --prompt "<video prompt>" \
  --duration <4-15> \
  --download <output.mp4> \
  --poll-interval 10 \
  --timeout 1800 \
  --non-interactive
```

This one CLI process submits exactly one task, waits internally between status checks, and downloads the completed video. When the execution tool returns a running session or cell ID, continue waiting on that same session until it exits.

Do not add `--async` to this command. Async mode returns before download handling.

## Input Modes

Use exactly one mode per request.

### Text-To-Video

```bash
mmx video generate \
  --model MiniMax-H3 \
  --prompt "A cinematic coastal sunset, slow dolly forward" \
  --duration 15 \
  --ratio 16:9 \
  --download ./result.mp4 \
  --poll-interval 10 \
  --timeout 1800 \
  --non-interactive
```

### First/Last-Frame Video

`--image` is the first frame. It may be combined with one `--last-frame`.

```bash
mmx video generate \
  --model MiniMax-H3 \
  --prompt "The subject walks naturally from the starting pose to the ending pose" \
  --image ./start.png \
  --last-frame ./end.png \
  --duration 15 \
  --download ./result.mp4 \
  --poll-interval 10 \
  --timeout 1800 \
  --non-interactive
```

Do not use the hidden `--first-frame` compatibility alias in new commands.

### Multimodal Reference Video

Repeat each reference flag to pass multiple inputs. Do not comma-separate paths.

```bash
mmx video generate \
  --model MiniMax-H3 \
  --prompt "Preserve the referenced character, follow the motion and audio rhythm" \
  --reference-image ./character-1.png \
  --reference-image ./character-2.png \
  --reference-video ./motion.mp4 \
  --reference-audio ./rhythm.mp3 \
  --duration 15 \
  --download ./result.mp4 \
  --poll-interval 10 \
  --timeout 1800 \
  --non-interactive
```

Frame mode cannot be mixed with reference mode. Reference audio requires at least one reference image or reference video.

## Region Recovery

Omit `--region` on the first request so MMX can use or detect the key's region. If that command fails, retry the same request once with the alternate region only when all of these are true:

1. No `taskId` was returned.
2. `[Model: MiniMax-H3]` was not printed, so the CLI did not confirm task creation.
3. The error explicitly concerns region detection, a regional endpoint, or a pre-submission 401/403 authentication-routing mismatch.

Use `--region global` after a failed `cn` attempt, or `--region cn` after a failed `global` attempt. Keep every generation argument unchanged. If the alternate region succeeds, persist it without exposing credentials:

```bash
mmx config set --key region --value <global-or-cn> --quiet
```

Do not perform region fallback for validation errors, error `2013`, billing, rate limits, sensitive content, generic service errors, or an ambiguous timeout. Never region-retry after task creation, during polling, or during download.

## Core Limits

- Prompt: at most 7000 characters.
- Output duration: integer from 4 through 15 seconds.
- Resolution: 2K.
- Reference images: at most 9.
- Reference videos: at most 3.
- Reference audios: at most 3.
- Mixed reference items: at most 12 total.
- Local image: at most 30 MB each.
- Local video: MP4, at most 50 MB each.
- Local audio: MP3 or WAV, at most 15 MB each.
- Complete local Base64 request body: at most 64 MB.

Use URLs or `mm_file://<file-id>` for large or numerous assets. Read `references/h3-video.md` for official duration, codec, frame-rate, dimension, and aspect-ratio limits that are not fully validated by the CLI.

## Async Task-ID Path

Use this only when the user wants immediate submission and a task ID:

```bash
mmx video generate \
  --model MiniMax-H3 \
  --prompt "<video prompt>" \
  --duration <4-15> \
  --async \
  --output json \
  --non-interactive
```

Return and retain the `taskId`, then stop. Do not automatically monitor or download it. MMX does not provide a task-list command or persist local task history.

## Prompt Handling

Preserve the user's intent. Write the prompt in the user's language. When a prompt is too short, expand it once using:

1. Duration, ratio, and use case.
2. Subjects and reference mapping.
3. Chronological actions.
4. Scene, lighting, weather, and background.
5. Shot size, angle, camera motion, focus, and cuts.
6. Style, color, mood, and pacing.
7. Dialogue, ambience, music, and audio synchronization.
8. Elements to preserve and artifacts to avoid.

For two or more ordered reference images, use a structured storyboard prompt instead of one prose paragraph:

1. Output specification and ordered reference count.
2. Global visual style and continuity rules.
3. Locked character identity, wardrobe, position, and props.
4. A contiguous master timeline mapped to `reference image 1`, `reference image 2`, and so on.
5. A micro-timeline inside each shot: establish, prepare, execute, settle/hold, and end-state lock.
6. Explicit action and object-state transitions for handoffs or other precise motion.
7. Sound requirements and a final negative-constraint block.

Use two timeline levels. The master timeline divides the full clip into shots. Each shot then divides its own interval into timestamped micro-beats. A shot may contain several phases, but they must form one causal action beat. Every shot must state its exact range, duration, reference image, initial state, camera behavior, micro-beats, and locked end state. The next shot's initial state must equal the previous locked end state.

Master and micro intervals must cover their parent duration without gaps or overlaps, and reference numbering must match the repeated `--reference-image` flag order. Keep the action achievable within 4-15 seconds. Do not silently add brands, celebrities, dialogue, text overlays, or unsafe content. Use the detailed Chinese and English templates in `references/h3-video.md`.

If the user already provides a complete structured storyboard prompt, do not summarize, shorten, translate, or stylistically rewrite it. Check only the 7000-character limit, duration coverage, reference count/order, media-mode compatibility, and contradictory constraints; preserve the original wording unless a correction is required.

## Failure Handling

- Wrong Token Plan/OAuth credential or H3 error `2013`: stop and request a compatible Pay-as-you-go API Key.
- Clear pre-submission region-routing failure: retry the unchanged command once with the alternate `--region`; never retry after task creation.
- Authentication, balance, or sensitive-content errors: stop and report the exact error without retrying or silently changing the request.
- A running terminal session: keep waiting on the same session; absence of a final path is not failure.
- Terminal task status `failed`, `cancelled`, or `expired`: report the status and task error; require approval before another paid submission.
- Polling timeout: report the task ID when available; do not submit a duplicate.
- Download failure after success: retry the same result download only; never regenerate the video.

Read the complete failure matrix in `references/h3-video.md` before recovery.
