<img src="https://file.cdn.minimax.io/public/MMX-capabilities.png" alt="MiniMax" width="100%" />

<p align="center">
  <strong>MiniMax AI 开放平台官方命令行工具</strong><br>
  专为 AI Agent 打造。在任意 Agent 或终端中生成文字、图像、视频和语音。
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
- **图像理解** — 图片描述与识别
- **网络搜索** — MiniMax 搜索引擎
- **双区域** — 国际版（`api.minimax.io`）和国内版（`api.minimaxi.com`）自动切换

<img src="https://file.cdn.minimax.io/public/MMX-CLI-help.png" alt="MiniMax" width="100%" />

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
# 认证（交互式 — 选 MiniMax OAuth 或粘 API Key）
mmx auth login

# 或者非交互
mmx auth login --api-key sk-xxxxx

# 开始创作
mmx text chat --message "你好，MiniMax！"
mmx image "一只穿宇航服的猫"
mmx speech synthesize --text "你好！" --out hello.mp3
mmx video generate --prompt "海浪拍打礁石"
mmx search "MiniMax AI 最新动态"
mmx vision photo.jpg
mmx quota
```

## 命令参考

### `mmx text`

```bash
mmx text chat --message "写一首诗"
mmx text chat --model MiniMax-M3 --message "你好" --stream
mmx text chat --system "你是编程助手" --message "用 Go 写 Fizzbuzz"
mmx text chat --message "user:你好" --message "assistant:嗨！" --message "你叫什么名字？"
cat messages.json | mmx text chat --messages-file - --output json
mmx text chat --image photo.jpg --message "这是什么品种的狗？"
mmx text chat --image before.png --image after.png --message "这两张图有什么不同？"
```

### `mmx image`

```bash
mmx image "一只穿宇航服的猫"
mmx image generate --prompt "科技感 Logo" --n 3 --aspect-ratio 16:9
mmx image generate --prompt "山水画" --out-dir ./output/
```

### `mmx video`

```bash
# Hailuo-2.3（视频生成 V1）
mmx video generate --prompt "海浪拍打礁石" --download sunset.mp4
mmx video generate --prompt "机器人作画" --async

# MiniMax-H3（视频生成 V2）
mmx video generate --api-key "$MINIMAX_API_KEY" --model MiniMax-H3 --prompt "夕阳下的海浪"
mmx video generate --api-key "$MINIMAX_API_KEY" --model MiniMax-H3 --prompt "主体向前行走" --image start.jpg
mmx video generate --api-key "$MINIMAX_API_KEY" --model MiniMax-H3 --prompt "保持相同角色和动作" --reference-image character.png --reference-video motion.mp4

mmx video task get --task-id 123456
mmx video task get --task-id 424010985738629 --model MiniMax-H3
mmx video download --file-id 176844028768320 --out video.mp4
```

MiniMax-H3 会在发送前检查本地文件和 Base64 数据：图片不超过 30 MB、参考视频不超过 50 MB、参考音频不超过 15 MB、JSON 请求体总计不超过 64 MB。所有素材的尺寸、宽高比、时长、帧率和编码格式仍由 API 服务端校验。

`--region` 是 CLI 原有的全局选项，不是 H3 参数。正常生成视频无需填写，CLI 会使用已保存或自动识别的区域。H3 默认使用 2K、5 秒，文生视频默认比例为 16:9。

### `mmx speech`

```bash
mmx speech synthesize --text "你好！" --out hello.mp3
mmx speech synthesize --text "流式输出" --stream | mpv -
mmx speech synthesize --text "Hi" --voice English_magnetic_voiced_man --speed 1.2
echo "头条新闻" | mmx speech synthesize --text-file - --out news.mp3
mmx speech voices
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

> `/v1/coding_plan/search` 接口单次最多返回 10 条结果，目前不支持翻页参数（参见 #107）。如需不同结果，请调整查询关键词。

### `mmx auth`

```bash
mmx auth login                              # 交互式：选 OAuth (Global / 中国) 或粘 API Key
mmx auth login --api-key sk-xxxxx           # 直接保存 API Key
mmx auth login --recommend                  # 跳过 3 选 1 菜单，弹出 region 选择器
mmx auth login --recommend --region=global  # 直接 OAuth → api.minimax.io
mmx auth login --recommend --region=cn      # 直接 OAuth → api.minimaxi.com
mmx auth status
mmx auth refresh
mmx auth logout
```

请使用 `mmx auth status` 作为认证状态的权威检查方式。OAuth 与 API Key 凭据
都保存在 `~/.mmx/config.json` 里，**两者互斥** —— 用一种登录会清掉另一种。
也可以每次通过 `--api-key` 直接传入。使用 API Key 登录时，会自动同时探测
Global 与中国两个 region，选用能通过的那个。

### `mmx config` · `mmx quota`

```bash
mmx quota
mmx config show
mmx config set --key region --value cn
mmx config set --key default-text-model --value MiniMax-M3
mmx config export-schema | jq .
```

### `mmx agent setup`

一键为 Claude Code、Codex、Grok Build、OpenCode、Hermes 或 Pi 配置 MiniMax，并保留配置文件中的其他设置。不带选项时进入交互式向导；带选项时自动使用非交互模式，便于脚本调用。

```bash
mmx agent setup
mmx agent setup --agent codex --agent claude-code --api-key "$MINIMAX_API_KEY" --region global
mmx agent setup --all --api-key "$MINIMAX_API_KEY" --region cn --output json
```

写入前会验证 Key 和所选区域；修改已有文件时会创建备份。可用 `--dry-run` 预览且不会发起联网请求。在交互式向导中，兼容且未在 `PATH` 中检测到的 Agent 会出现在第二个安装多选列表，并通过官方软件包或安装脚本安装。Hermes 仅执行官方核心 CLI 安装阶段，跳过可选系统软件包、Node 工作区、浏览器、计算机控制、初始化和网关阶段。安装完成后，mmx 会保留安装器生成的其他设置并写入 MiniMax 配置。平台或依赖检查不通过的 Agent 会说明原因并保持仅配置。非交互调用仍只写配置，且该命令不会启动 Agent。

### `mmx update`

```bash
mmx update
mmx update latest
```

## 贡献者

<a href="https://github.com/MiniMax-AI/cli/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=MiniMax-AI/cli" />
</a>

## 许可证

[MIT](LICENSE)
