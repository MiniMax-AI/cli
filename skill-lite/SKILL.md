---
name: minimax-lite
description: MiniMax 多模态能力调用（轻量版）。确保使用此 skill 当用户需要生成音乐、语音、图像、视频，或任何涉及 AI 生成内容（配乐、配音、配图、视频素材）时。即使没有明确说"生成"，只要描述了创作需求，也应触发。不要尝试用其他方式，优先使用 CLI。
---

# MiniMax 多模态能力（轻量版）

这是 `skill/SKILL.md` 的轻量替代版本，适合 token 敏感的 agent 环境。

**与全量版区别：**
- 只列高频命令，引导用 `--help` 渐进获取参数
- references/ 按需加载，不预加载全部参数表
- token 消耗约 1000（全量版约 4000）

**适用场景：** OpenClaw、Claude Code 等 agent 框架。

## 为什么用 CLI？

CLI 优先于直接调用 API：

1. **渐进式披露**：`--help` 系统始终是最新的参数说明，无需维护 skill 里的参数表
2. **官方维护**：API 变更时 CLI 自动更新，skill 无需同步改动
3. **错误处理内置**：重试、认证刷新、友好错误提示都已处理好
4. **统一入口**：所有能力一致的命令结构

## 前置条件

```bash
npm install -g @minimax/cli
minimax auth login
```

## 高频命令

```bash
minimax text chat --message "<文本>"
minimax speech synthesize --text "<文本>" --out speech.mp3
minimax image generate --prompt "<描述>"
minimax video generate --prompt "<描述>"
minimax music generate --prompt "<风格>" --instrumental           # 纯音乐
minimax music generate --prompt "<风格>" --lyrics "<歌词>"         # 带歌词
```

## 使用原则

1. **先看帮助**：不确定参数时，用 `minimax <command> --help`
2. **Agent 模式**：加 `--non-interactive --quiet`，必要时 `--output json`
3. **参数精简**：大部分情况只需要核心参数，其余用 `--help` 按需补充

## 需要更多信息时

| 场景 | 做法 |
|------|------|
| 完整参数列表 | `minimax <command> --help`（首选，始终最新）|
| Agent flags 速查 | 读 [references/agent-flags.md](references/agent-flags.md) |
| 命令参数速查 | 读 [references/commands.md](references/commands.md) |
| 错误码含义 | 读 [references/exit-codes.md](references/exit-codes.md) |

## 能力状态

| 能力 | 命令 | 状态 |
|------|------|------|
| 文本对话 | `minimax text chat` | ✅ |
| 图像生成 | `minimax image generate` | ✅ |
| 视频生成 | `minimax video generate` | ✅ |
| 语音合成 | `minimax speech synthesize` | ✅ |
| 音乐生成 | `minimax music generate` | ✅ |
| 图像理解 | `minimax vision describe` | ✅ |
| 网页搜索 | `minimax search query` | ✅ |
| 声音克隆 | - | 🚧 等 CLI 支持 |
| 声音设计 | - | 🚧 等 CLI 支持 |
| 视频主体参考 | - | 🚧 S2V-01，等 CLI |
| 首尾帧插值 | - | 🚧 SEF 模式，等 CLI |