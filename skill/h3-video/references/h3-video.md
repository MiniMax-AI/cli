# MiniMax-H3 Video Agent Guide

Read this reference before submitting a `MiniMax-H3` request. It covers rules that are not fully exposed by CLI flags.

## Credential Rule

- Use a standard Pay-as-you-go/Credit API Key for H3.
- Do not use an OAuth credential or Token Plan Subscription Key for H3.
- Run `mmx auth status --output json --quiet` before the first paid request. It reports the credential method and only a masked key.
- Prefer an API key already saved in MMX config. Generation commands should not contain `--api-key`.
- If the runtime securely holds a previously supplied key as `MINIMAX_API_KEY`, save it once with `mmx config set --key api_key --value "$MINIMAX_API_KEY" --quiet`.
- Never print, repeat, or reconstruct a literal key in shell text. If secure injection is unavailable, ask the user to run interactive `mmx auth login` instead of pasting the key into chat again.
- MMX stores config with owner-only permissions. Saving `api_key` removes stale OAuth credentials and clears the cached region for fresh detection.
- If error `2013` says TokenPlan or Credit does not support H3, stop. Select a compatible Pay-as-you-go API Key instead of changing the prompt or media.

## Region Selection And Fallback

- Omit `--region` initially. MMX uses the saved region or detects it after a new API key is saved.
- `Detecting region... cn` and `Detecting region... global` are normal progress messages.
- Retry the alternate region at most once only when the command clearly failed before task creation because of region detection, a regional endpoint, or a pre-submission 401/403 routing mismatch.
- Absence of both a `taskId` and `[Model: MiniMax-H3]` is required before retrying creation. If either appeared, assume a paid task may exist and do not resubmit.
- Keep the request identical and add only `--region global` after `cn`, or `--region cn` after `global`.
- After a successful alternate-region request, persist it with `mmx config set --key region --value <global-or-cn> --quiet`.
- Do not region-retry validation, `2013`, balance, rate-limit, sensitive-content, generic 5xx, terminal task failure, polling, download, or ambiguous timeout errors.

## Waiting And Progress

- The API does not publish a fixed completion ETA or progress percentage for each video.
- Total time varies with queue load, requested duration, and reference-media complexity. Never promise that a task will finish in a specific number of minutes.
- Poll no more frequently than once every 10 seconds.
- Valid lifecycle statuses include `queued`, `running`, `succeeded`, `failed`, `cancelled`, and `expired`.
- For a completed file, use one blocking `mmx video generate` command with `--download`, `--poll-interval 10`, and `--timeout 1800`. The CLI performs status polling internally.
- If the terminal command remains active, wait on the same execution session. Do not start another command or infer failure from missing output while it is still running.
- After 30 minutes, the CLI timeout may stop local polling. Preserve and report `taskId` when available; do not submit a duplicate task automatically.
- MMX has no task-list command and does not persist local task history. Retain the returned task ID.

## Prompt Construction

Preserve the user's intent. When the prompt is underspecified, expand it into one production-oriented prompt in this order:

1. Output goal: duration, aspect ratio, use case, and whether the clip should feel continuous or edited.
2. Subjects and assets: identify people, products, locations, and how each reference image/video/audio should be used.
3. Timeline: describe actions in chronological order with clear transitions.
4. Scene: environment, time of day, lighting, weather, and important background details.
5. Camera: shot size, angle, movement, focus behavior, and cuts.
6. Look: visual style, color, texture, mood, and pacing.
7. Sound: dialogue, ambience, music, sound effects, and synchronization to reference audio.
8. Constraints: elements to preserve and artifacts to avoid, such as identity drift, flicker, text, logos, or abrupt cuts.

When the user already supplies a complete structured storyboard, keep it intact. Do not condense, translate, or replace it with a generic prompt. Only check prompt length, timestamp coverage, reference numbering, media compatibility, and direct contradictions before submission.

Operational heuristics for better results:

- Keep actions physically achievable within the selected 4-15 second duration.
- Prefer one clear action beat per shot instead of packing unrelated events into one block.
- For multiple references, describe them in the same order as the repeated CLI flags: `reference image 1`, `reference image 2`, and so on.
- Make timestamp ranges contiguous, with no gaps or overlaps, and make their final end time equal the requested duration.
- Use a two-level timeline: a master shot range for every reference image, then micro-ranges inside that shot for preparation, execution, settling, and the final hold.
- Use 0.5-second precision by default. Use finer timing only when a short, precise physical transition needs it.
- Every shot must declare: exact range and duration, reference image number, initial state, shot/camera, micro-timeline, and locked end state.
- The locked end state of shot N must be the initial state of shot N+1. Check character pose, gaze, occupied hand, prop owner/location, prop connections, and camera side.
- State what must remain consistent and what may change. Example: preserve face, clothing, and product shape; change pose, camera angle, and background motion.
- Lock persistent spatial relationships explicitly when important: left/right seat, foreground/background, screen direction, and which hand holds an object.
- For handoffs and precise object motion, describe state transitions in causal order: initial owner and location, release condition, transfer, new owner, and final state. Do not compress these into one vague action.
- Separate hard continuity constraints from aesthetic preferences and negative constraints. Repeat a critical invariant in the relevant timeline block when its failure would break the scene.
- Use explicit camera language such as static shot, close-up, tracking shot, dolly in, pan, tilt, handheld, or aerial view.
- Specify audio timing only when audio is supplied. State whether motion, cuts, lip movement, or effects should follow the beat or spoken words.
- Do not silently add brands, dialogue, text overlays, or unsafe content that the user did not request.

Timeline planning procedure:

1. Read total duration `D` and ordered storyboard count `N`.
2. Preserve user-supplied timestamps. Otherwise start with `D / N` seconds per storyboard; for example, 15 seconds with 6 images starts as six 2.5-second shots.
3. Reallocate time by action complexity while keeping all ranges contiguous and totaling exactly `D`. Give precise handoffs or multi-stage physical actions more time; give static establishing or reaction shots less.
4. Split each shot into 3-5 readable micro-beats: establish/hold, preparation, core action, settle/recovery, and optional final hold.
5. Maintain a state ledger at every boundary: character position and pose, gaze, left/right hand state, prop owner and location, physical connections, and camera side.
6. Verify that every reference is used exactly once in input order unless the user explicitly requests reuse, and that shot N's locked end state exactly matches shot N+1's initial state.
7. If the requested actions cannot fit without becoming rushed or ambiguous, simplify the action plan or tell the user before making a paid request. Do not silently compress causal steps.

For two or more ordered storyboard images, use the following structure. Do not flatten it into a single paragraph.

English structured storyboard template:

```text
[OUTPUT SPECIFICATION]
Create a {duration}-second, {ratio} {use case} video using {N} storyboard reference images in their exact input order as consecutive shot references. Follow the timeline without skipping shots or changing locked characters, wardrobe, positions, or key props.

[OVERALL LOOK]
{Live action/animation/product medium}; {cinematic or visual style}; {lighting, color, texture, depth of field, pacing, and camera baseline}. Scene: {environment, time, weather, and background motion}. Sound: {dialogue, ambience, music, reference-audio synchronization, or silence}.

[CHARACTER AND SPATIAL CONTINUITY]
Character 1: {appearance, wardrobe, demeanor}; always at {fixed position}.
Character 2: {appearance, wardrobe, demeanor}; always at {fixed position}.
Preserve {faces, hair, wardrobe, seats, screen direction, proportions, and scene layout} throughout.

[PROP STATE CONTINUITY]
The entire video contains exactly {prop count and names}. Initial state: {owner, hand, location, and connection}. Preserve {shape, count, connection, visibility, and physical behavior}; never duplicate, remove, teleport, disconnect, or silently change ownership.

[TWO-LEVEL TIMELINE AND REFERENCE MAPPING]
Shot 1 | 0:00-{T1} | Duration {D1}s | Reference image 1
Shot and camera: {framing, angle, movement, and focus}.
Initial state: {poses, gazes, both-hand states, prop owner/location/connections}.
In-shot micro-timeline:
- 0:00-{t1a}: Establish the frame with {visible state and subtle environment motion}.
- {t1a}-{t1b}: Preparation: {gaze, weight, hand, or prop begins to change}.
- {t1b}-{t1c}: Core action: {perform only this shot's main action}.
- {t1c}-{T1}: Settle and hold the completed action; do not begin the next shot's action early.
Locked end state: {explicit character, hand, prop, and connection state inherited by shot 2}.

Shot 2 | {T1}-{T2} | Duration {D2}s | Reference image 2
Shot and camera: {framing, angle, movement, and focus}.
Initial state: exactly match shot 1's locked end state.
In-shot micro-timeline:
- {T1}-{t2a}: Hold the inherited state long enough to remain readable.
- {t2a}-{t2b}: {preparation}.
- {t2b}-{t2c}: {core action}.
- {t2c}-{T2}: {completion, recovery, or hold}.
Locked end state: {explicit state}.

{Continue with one complete shot block per reference image. Both the master timeline and every in-shot micro-timeline must be contiguous; the final timestamp must equal duration.}

[STRICT ACTION ORDER]
{Action A} -> {Action B} -> {Action C} -> {Action D}. Do not merge, reorder, or omit steps. Each shot completes one clear action. For a handoff, state who remains still, who establishes and secures contact, and only then when the original holder releases.

[NEGATIVE CONSTRAINTS]
No {unwanted visual genre, editing style, or performance}. No {subtitles, watermarks, extra people, or extra props}. Avoid {identity drift, wardrobe changes, position swaps, flicker, malformed fingers, extra limbs, prop teleportation, broken connections, and abrupt cuts}.
```

For a single text-to-video request or one loose reference, a concise paragraph is acceptable. Use the full storyboard structure when continuity, multiple ordered images, or precise physical interactions matter.

### Detailed Timing Example: Earbud Removal And Handoff

English:

```text
Shot 2 | 0:02.5-0:05.0 | Duration 2.5s | Reference image 2
Initial state: the girl looks at her phone with both earbuds in her ears; she holds the phone; the boy still holds his bag with both hands.
0:02.5-0:03.0: The girl lowers the phone slightly and briefly looks at the boy; all other states remain unchanged.
0:03.0-0:04.1: With the hand closer to the boy, she pinches one earbud stem between thumb and index finger and slowly removes it from her ear.
0:04.1-0:05.0: She holds the earbud at chest height between them; the boy has not reached for it; a visible gap remains between the earbud and his face and ear.
Locked end state: the girl still holds the earbud stem; the other earbud remains in her ear; the cable remains connected to her phone; both of the boy's hands remain on his bag.

Shot 3 | 0:05.0-0:07.5 | Duration 2.5s | Reference image 3
Initial state: exactly inherit shot 2's locked end state.
0:05.0-0:05.5: The girl keeps her hand and the earbud still; the boy pauses.
0:05.5-0:06.4: The boy raises the hand closer to the girl and approaches the earbud stem with thumb and index finger; she does not release it.
0:06.4-0:07.0: The boy grips and secures the earbud stem; only after his grip is stable does the girl release it.
0:07.0-0:07.5: The girl withdraws her hand; the boy holds the earbud but does not move it toward his ear yet.
Locked end state: ownership has transferred to the boy; the earbud remains between them; the girl's hand has left the handoff area; the cable still connects naturally to the girl's phone.
```

## Media Preflight

Frame mode and reference mode cannot be mixed. Reference audio requires at least one reference image or reference video.

| Input | Official count/technical limits | Current local CLI handling |
|---|---|---|
| First frame | At most 1 image | `--image`; at most 30 MB |
| Last frame | At most 1 image | `--last-frame`; at most 30 MB |
| Reference image | At most 9; JPEG/JPG/PNG/WebP; 256-5760 px sides; aspect ratio 0.4-2.5 | JPG/JPEG/PNG/WebP/HEIC/HEIF; at most 30 MB each |
| Reference video | At most 3; MP4/MOV; H.264/H.265; 23.976-60 FPS; each 2-15 seconds; total at most 15 seconds | Local MP4 only; at most 50 MB each. Use URL or `mm_file://` for other supported API inputs |
| Reference audio | At most 3; MP3/WAV; each 2-15 seconds; total at most 15 seconds | Local MP3/WAV; at most 15 MB each |

The total number of reference images, videos, and audios in a mixed-reference request must not exceed 12. Local media is Base64-encoded, and MMX limits the complete request body to 64 MB. Use public URLs or `mm_file://<file-id>` for large or numerous media inputs.

Before a paid request, inspect local video/audio duration and codec once when they are unknown. Do not transcode media unless it violates an actual format or duration rule.

## Failure Handling

Use the shortest non-duplicating response:

| Failure | Action |
|---|---|
| Region detection/endpoint or pre-submission 401/403, with no `taskId` and no model marker | Retry the unchanged request once with the alternate `--region`; if it succeeds, save that region |
| No `taskId` and validation/HTTP 400 | Correct the reported field once; do not alter unrelated parameters |
| `2013` mentioning TokenPlan/Credit and H3 | Stop and use a compatible Pay-as-you-go API Key |
| Authentication error (`1004`, `2049`, HTTP 401/403) | Stop and request a valid key; do not retry |
| Insufficient balance (`1008`, HTTP 402) | Stop and report the billing problem |
| Rate limit (`1002`, HTTP 429) | Wait 60 seconds using the agent runtime's wait capability, then retry the same safe query once. Retry creation only when the response clearly confirms no task was created |
| Sensitive prompt/media (`1026`, `1027`, HTTP 422) | Report the rejected input and ask the user to revise it; do not silently rewrite |
| Temporary service/query error (`1000`, `1001`, `1024`, `1033`, HTTP 5xx) | For an existing task, wait 10 seconds using the agent runtime's wait capability and retry the same status query up to 3 times. Do not submit a replacement task automatically |
| Terminal `failed`, `cancelled`, or `expired` | Report `taskId`, status, and task error; require user approval before creating another paid task |
| Polling exceeds 30 minutes | Let the direct CLI command return its timeout, preserve `taskId` when available, and report that the task may still complete later |
| Download fails after `succeeded` | Retry the same result URL up to 3 times; never regenerate the video |

Once a task ID exists, all recovery must operate on that task ID. Never create a second paid task merely because terminal-session handling, polling, or downloading failed.
