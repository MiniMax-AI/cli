<img src="https://file.cdn.minimax.io/public/MMX.png" alt="MiniMax" width="100%" />

<p align="center">
  <strong>MiniMax AI 开放平台官方命令行工具</strong><br>
  专为 AI Agent 打造。在任意 Agent 或终端中生成文字、图像、视频、语音和音乐。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/mmx-cli"><img src="https://img.shields.io/npm/v/mmx-cli.svg" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js >= 18" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="https://platform.minimax.io">国际版平台</a> · <a href="https://platform.minimaxi.com">国内版平台</a> · <a href="https://platform.minimaxi.com/docs/token-plan/minimax-cli">例子</a>
</p>

## 功能特性

- **文本对话** — 多轮对话、流式输出、系统提示词、JSON 格式输出
- **图像生成** — 文生图，支持比例和批量控制
- **视频生成** — 异步生成，进度追踪
- **语音合成** — 30+ 音色、语速调节、流式播放
- **音乐生成** — 文生音乐，支持自定义歌词、纯音乐、自动生词，以及基于参考音频的 Cover 生成
- **图像理解** — 图片描述与识别
- **网络搜索** — MiniMax 搜索引擎
- **双区域** — 国际版（`api.minimax.io`）和国内版（`api.minimaxi.com`）自动切换

<img src="https://file.cdn.minimax.io/public/MMX-CLI.png" alt="MiniMax" width="100%" />

## 安装

```bash
# AI Agent 使用（OpenClaw、Cursor、Claude Code 等）：添加 Skill 到你的 Agent
npx skills add MiniMax-AI/cli -y -g

# 或全局安装 CLI 在终端中使用
npm install -g mmx-cli
```

> 需要 [Node.js](https://nodejs.org) 18+

> **需要 MiniMax Token 套餐** — [国际版](https://platform.minimax.io/subscribe/token-plan) · [国内版](https://platform.minimaxi.com/subscribe/token-plan)

## 快速开始

```bash
# 认证
mmx auth login --api-key sk-xxxxx

# 开始创作
mmx text chat --message "你好，MiniMax！"
mmx image "一只穿宇航服的猫"
mmx speech synthesize --text "你好！" --out hello.mp3
mmx video generate --prompt "海浪拍打礁石"
mmx music generate --prompt "欢快的流行乐" --lyrics "[主歌] 啦啦啦，阳光照"
mmx search "MiniMax AI 最新动态"
mmx vision photo.jpg
mmx quota
```

## 命令参考

### `mmx text`

```bash
mmx text chat --message "写一首诗"
mmx text chat --model MiniMax-M2.7-highspeed --message "你好" --stream
mmx text chat --system "你是编程助手" --message "用 Go 写 Fizzbuzz"
mmx text chat --message "user:你好" --message "assistant:嗨！" --message "你叫什么名字？"
cat messages.json | mmx text chat --messages-file - --output json
```

### `mmx image`

```bash
mmx image "一只穿宇航服的猫"
mmx image generate --prompt "科技感 Logo" --n 3 --aspect-ratio 16:9
mmx image generate --prompt "山水画" --out-dir ./output/
```

### `mmx video`

```bash
mmx video generate --prompt "海浪拍打礁石" --download sunset.mp4
mmx video generate --prompt "机器人作画" --async
mmx video task get --task-id 123456
mmx video download --file-id 176844028768320 --out video.mp4
```

### `mmx speech`

```bash
mmx speech synthesize --text "你好！" --out hello.mp3
mmx speech synthesize --text "流式输出" --stream | mpv -
mmx speech synthesize --text "Hi" --voice English_magnetic_voiced_man --speed 1.2
echo "头条新闻" | mmx speech synthesize --text-file - --out news.mp3
mmx speech voices
```

### `mmx music`

```bash
# 带歌词生成
mmx music generate --prompt "欢快的流行乐" --lyrics "[主歌] 啦啦啦，阳光照" --out song.mp3
# 自动生成歌词
mmx music generate --prompt "忧郁的独立民谣，雨夜" --lyrics-optimizer --out song.mp3
# 纯音乐（无人声）
mmx music generate --prompt "史诗管弦乐" --instrumental --out bgm.mp3
# Cover — 基于参考音频生成翻唱版本
mmx music cover --prompt "爵士钢琴，慵懒女声" --audio-file original.mp3 --out cover.mp3
mmx music cover --prompt "民谣吉他" --audio https://example.com/song.mp3 --out cover.mp3
```

### `mmx vision`

```bash
mmx vision photo.jpg
mmx vision describe --image https://example.com/img.jpg --prompt "这是什么品种的狗？"
mmx vision describe --file-id file-123
```

### `mmx search`

```bash
mmx search "MiniMax AI"
mmx search query --q "最新动态" --output json
```

### `mmx auth`

```bash
mmx auth login --api-key sk-xxxxx
mmx auth login                    # OAuth 浏览器授权
mmx auth status
mmx auth refresh
mmx auth logout
```

请使用 `mmx auth status` 作为认证状态的权威检查方式。`~/.mmx/credentials.json`
只在 OAuth 登录时存在；API Key 登录会写入 `~/.mmx/config.json`（也可每次通过
`--api-key` 直接传入）。

### `mmx config` · `mmx quota`

```bash
mmx quota
mmx config show
mmx config set --key region --value cn
mmx config set --key default-text-model --value MiniMax-M2.7-highspeed
mmx config export-schema | jq .
```

### `mmx update`

```bash
mmx update
mmx update latest
```

## SDK 使用

你也可以通过 TypeScript SDK 以编程方式使用 MiniMax。

### 安装

```bash
npm install mmx-cli
```

### 基础用法

```typescript
import { MiniMaxSDK } from 'mmx-cli/sdk';

const sdk = new MiniMaxSDK({
  apiKey: 'sk-xxxxx',
  region: 'global', // 或 'cn'
});
```

### 文本对话

```typescript
// 非流式
const response = await sdk.text.chat({
  model: 'MiniMax-M2.7',
  messages: [{ role: 'user', content: '你好！' }],
  max_tokens: 4096,
});

// 流式
const stream = await sdk.text.chat({
  model: 'MiniMax-M2.7',
  messages: [{ role: 'user', content: '写一首诗' }],
  stream: true,
});

for await (const event of stream) {
  console.log(event.choices[0]?.delta?.content);
}
```

### 图像生成

```typescript
const result = await sdk.image.generate({
  model: 'image-01',
  prompt: '一只穿宇航服的猫',
  width: 1024,
  height: 1024,
  n: 1,
});
```

### 视频生成

```typescript
// 同步（等待完成）
const video = await sdk.video.generate({
  model: 'MiniMax-Hailuo-2.3',
  prompt: '海浪拍打礁石',
});

// 异步（立即返回任务 ID）
const { taskId } = await sdk.video.generate({
  prompt: '机器人作画',
  async: true,
});

// 查询任务状态
const task = await sdk.video.getTask({ taskId });

// 下载视频
const { size, save, downloadUrl } = await sdk.video.download({
  fileId: '176844028768320',
  outPath: './video.mp4',
});
```

### 语音合成

```typescript
// 非流式
const speech = await sdk.speech.synthesize({
  model: 'speech-2.8-hd',
  text: '你好，世界！',
  voice_setting: { voice_id: 'English_expressive_narrator' },
  audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 },
});

// 流式
const stream = await sdk.speech.synthesize({
  text: '流式输出',
  stream: true,
});

for await (const chunk of stream) {
  // 处理音频块
}

// 获取可用音色列表
const voices = await sdk.speech.voices();
const chineseVoices = await sdk.speech.voices('zh');
```

### 音乐生成

```typescript
// 带歌词
const music = await sdk.music.generate({
  model: 'music-2.6',
  prompt: '欢快的流行乐',
  lyrics: '[主歌] 啦啦啦，阳光照',
  output_format: 'hex',
});

// 纯音乐
const instrumental = await sdk.music.generate({
  prompt: '史诗管弦乐',
  instrumental: true,
});

// 自动生词
const autoLyrics = await sdk.music.generate({
  prompt: '忧郁的独立民谣，雨夜',
  lyrics_optimizer: true,
});

// 流式
const stream = await sdk.music.generate({
  prompt: '欢快的流行乐',
  lyrics: '[主歌] 你好世界',
  stream: true,
});

for await (const chunk of stream) {
  // 处理音频块
}

// 结构化提示词
const structured = await sdk.music.generate({
  prompt: '一首优美的歌曲',
  vocals: '温暖的男中音',
  genre: '爵士',
  mood: '放松',
  instruments: '钢琴，萨克斯',
  bpm: 120,
  key: 'C 大调',
});
```

### 图像理解

```typescript
const result = await sdk.vision.describe({
  image: 'https://example.com/photo.jpg',
  prompt: '这是什么品种的狗？',
});

console.log(result.content);
```

### 网络搜索

```typescript
const results = await sdk.search.query('MiniMax AI 最新动态');

for (const item of results.organic) {
  console.log(item.title, item.link, item.snippet);
}
```

### 配额信息

```typescript
const quota = await sdk.quota.info();
console.log(quota);
```

### 自定义基础 URL

```typescript
const sdk = new MiniMaxSDK({
  apiKey: 'sk-xxxxx',
  baseUrl: 'https://api.minimax.io', // 自定义端点
});
```

## 贡献者

<a href="https://github.com/MiniMax-AI/cli/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=MiniMax-AI/cli" />
</a>

## 许可证

[MIT](LICENSE)
