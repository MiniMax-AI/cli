<p align="center">
  <img src="assets/logo.png" alt="MiniMax" width="320" />
</p>

<p align="center">
  <strong>MiniMax AI 开放平台官方命令行工具</strong><br>
  在终端生成文字、图像、视频、语音和音乐。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/minimax-cli"><img src="https://img.shields.io/npm/v/minimax-cli.svg" alt="npm version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js >= 18" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="https://platform.minimaxi.com">开放平台</a>
</p>

## 功能特性

- **文本对话** — 多轮对话、流式输出、系统提示词、JSON 格式输出
- **图像生成** — 文生图，支持比例和批量控制
- **视频生成** — 异步生成，进度追踪
- **语音合成** — 30+ 音色、语速调节、流式播放
- **音乐生成** — 文生音乐，支持自定义歌词
- **图像理解** — 图片描述与识别
- **网络搜索** — MiniMax 搜索引擎
- **双区域** — 国际版（`api.minimax.io`）和国内版（`api.minimaxi.com`）自动切换

## 安装

```bash
npm install -g minimax-cli
```

> 需要 [Node.js](https://nodejs.org) 18+

## 快速开始

```bash
# 认证
minimax auth login --api-key sk-xxxxx

# 开始创作
minimax text chat --message "你好，MiniMax！"
minimax image "一只穿宇航服的猫"
minimax speech synthesize --text "你好！" --out hello.mp3
minimax video generate --prompt "海浪拍打礁石"
minimax music "欢快的流行乐"
minimax search "MiniMax AI 最新动态"
minimax vision photo.jpg
minimax quota
```

## 命令参考

### `minimax text`

```bash
minimax text chat --message "写一首诗"
minimax text chat --model MiniMax-M2.7-highspeed --message "你好" --stream
minimax text chat --system "你是编程助手" --message "用 Go 写 Fizzbuzz"
minimax text chat --message "user:你好" --message "assistant:嗨！" --message "你叫什么名字？"
cat messages.json | minimax text chat --messages-file - --output json
```

### `minimax image`

```bash
minimax image "一只穿宇航服的猫"
minimax image generate --prompt "科技感 Logo" --n 3 --aspect-ratio 16:9
minimax image generate --prompt "山水画" --out-dir ./output/
```

### `minimax video`

```bash
minimax video generate --prompt "海浪拍打礁石" --async
minimax video generate --prompt "机器人作画" --download sunset.mp4
minimax video task get --task-id 123456
minimax video download --file-id 176844028768320 --out video.mp4
```

### `minimax speech`

```bash
minimax speech synthesize --text "你好！" --out hello.mp3
minimax speech synthesize --text "流式输出" --stream | mpv -
minimax speech synthesize --text "Hi" --voice Boyan_new_hailuo --speed 1.2
echo "头条新闻" | minimax speech synthesize --text-file - --out news.mp3
minimax speech voices
```

### `minimax music`

```bash
minimax music "欢快的流行乐"
minimax music generate --prompt "爵士风" --lyrics "啦啦啦" --out song.mp3
```

### `minimax vision`

```bash
minimax vision photo.jpg
minimax vision describe --image https://example.com/img.jpg --prompt "这是什么品种的狗？"
minimax vision describe --file-id file-123
```

### `minimax search`

```bash
minimax search "MiniMax AI"
minimax search query --q "最新动态" --output json
```

### `minimax auth`

```bash
minimax auth login --api-key sk-xxxxx
minimax auth login                    # OAuth 浏览器授权
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

## 许可证

[MIT](LICENSE)
