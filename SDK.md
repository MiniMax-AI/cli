# MiniMax SDK

TypeScript SDK for the [MiniMax](https://www.minimaxi.com) AI platform.

## Installation

```bash
npm install mmx-cli
```

## Quick Start

```typescript
import { MiniMaxSDK } from 'mmx-cli/sdk';

const sdk = new MiniMaxSDK({
  apiKey: 'sk-xxxxx',
  region: 'global', // or 'cn'
});
```

You can also omit `apiKey` if it's already configured via `mmx config set api-key <key>`.

## Modules

### Text

```typescript
const response = await sdk.text.chat({
  model: 'MiniMax-M3',
  messages: [{ role: 'user', content: 'Hello!' }],
  max_tokens: 4096,
});

// Streaming
const stream = await sdk.text.chat({
  model: 'MiniMax-M3',
  messages: [{ role: 'user', content: 'Write a poem' }],
  stream: true,
});

for await (const event of stream) {
  console.log(event.choices[0]?.delta?.content);
}
```

### Image

```typescript
const result = await sdk.image.generate({
  model: 'image-01',
  prompt: 'A cat in a spacesuit',
  width: 1024,
  height: 1024,
  n: 1,
});
```

### Video

```typescript
// Synchronous — waits for completion
const video = await sdk.video.generate({
  model: 'MiniMax-Hailuo-2.3',
  prompt: 'Ocean waves at sunset',
});

// MiniMax-H3 — Video Generation V2 with request defaults
const h3Video = await sdk.video.generate({
  model: 'MiniMax-H3',
  prompt: 'Ocean waves at sunset',
});

// Asynchronous — returns task ID immediately
const { taskId } = await sdk.video.generate({
  prompt: 'A robot painting',
  async: true,
});

const { taskId: h3TaskId } = await sdk.video.generate({
  model: 'MiniMax-H3',
  prompt: 'Ocean waves at sunset',
  async: true,
});

const h3Task = await sdk.video.getTask({
  taskId: h3TaskId,
  model: 'MiniMax-H3',
});

const task = await sdk.video.getTask({ taskId });

// Download
const { size, save, downloadUrl } = await sdk.video.download({
  fileId: '176844028768320',
  outPath: './video.mp4',
});
```

### Speech

```typescript
const speech = await sdk.speech.synthesize({
  model: 'speech-2.8-hd',
  text: 'Hello, world!',
  voice_setting: { voice_id: 'English_expressive_narrator' },
  audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
});

// Streaming
const stream = await sdk.speech.synthesize({
  text: 'Stream me',
  stream: true,
});

for await (const chunk of stream) {
  // process audio chunks
}

// List voices
const voices = await sdk.speech.voices();
const englishVoices = await sdk.speech.voices('en');
```

### Music

```typescript
const music = await sdk.music.generate({
  model: 'music-3.0',
  prompt: 'Upbeat pop song',
  lyrics: '[verse] La da dee, sunny day',
  output_format: 'hex',
});

// Instrumental
const instrumental = await sdk.music.generate({
  prompt: 'Cinematic orchestral',
  is_instrumental: true,
});

// Auto-generate lyrics
const autoLyrics = await sdk.music.generate({
  prompt: 'Indie folk, melancholic, rainy night',
  lyrics_optimizer: true,
});

// Streaming
const stream = await sdk.music.generate({
  prompt: 'Upbeat pop',
  lyrics: '[verse] Hello world',
  stream: true,
});

for await (const chunk of stream) {
  // chunk contains decoded audio bytes
}

// One-step cover — lyrics are extracted from the reference audio when omitted
const cover = await sdk.music.generate({
  model: 'music-cover-free',
  prompt: 'Jazz piano trio with a warm intimate vocal',
  audio_url: 'https://example.com/reference.mp3',
  output_format: 'url',
});

// Two-step cover — use a feature ID returned by the cover preprocess API
const rewrittenCover = await sdk.music.generate({
  model: 'music-cover',
  prompt: 'Acoustic folk with gentle strings and soft vocals',
  cover_feature_id: 'feature-id-from-preprocess',
  lyrics: '[Verse]\nThese are the rewritten lyrics for the cover',
});

// Structured prompt
const structured = await sdk.music.generate({
  prompt: 'A beautiful song',
  vocals: 'warm male baritone',
  genre: 'jazz',
  mood: 'relaxing',
  instruments: 'piano, saxophone',
  bpm: 120,
  key: 'C major',
});
```

### Vision

```typescript
const result = await sdk.vision.describe({
  image: 'https://example.com/photo.jpg',
  prompt: 'What breed is this dog?',
});

console.log(result.content);
```

### Search

```typescript
const results = await sdk.search.query('MiniMax AI latest news');

for (const item of results.organic) {
  console.log(item.title, item.link, item.snippet);
}
```

> The underlying `/v1/coding_plan/search` API returns at most 10 results per call and does not currently expose a pagination parameter (see #107). Refine your query if you need different results.

### Quota

```typescript
import {
  isAccountBalanceResponse,
  isQuotaResponse,
} from 'mmx-cli/sdk';

const quota = await sdk.quota.info();

if (isQuotaResponse(quota)) {
  console.log(quota.model_remains);
} else if (isAccountBalanceResponse(quota)) {
  console.log(quota.available_amount);
}
```

Token Plan credentials and OAuth return `QuotaResponse`. API secret keys with
the `sk-api-` prefix return `AccountBalanceResponse`. The type guards above
narrow the `QuotaInfoResponse` union without changing the raw API response.

## Custom Base URL

```typescript
const sdk = new MiniMaxSDK({
  apiKey: 'sk-xxxxx',
  baseUrl: 'https://api.minimax.io',
});
```
