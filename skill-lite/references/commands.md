# 完整命令参考

> 这里是各命令关键参数速查。完整参数列表始终以 `minimax <command> --help` 为准。

---

## text chat

文本对话，默认模型 `MiniMax-M2.7`。

```bash
minimax text chat --message "<文本>" [flags]
```

| Flag | 说明 |
|------|------|
| `--message <text>` | 消息文本，前缀 `role:` 设置角色，如 `"system:You are helpful"` |
| `--messages-file <path>` | 从 JSON 文件读取消息，`-` 读 stdin |
| `--system <text>` | 系统提示 |
| `--model <model>` | 模型 ID，默认 `MiniMax-M2.7` |
| `--stream` | 流式输出 |

---

## image generate

图像生成，模型 `image-01`。

```bash
minimax image generate --prompt <text> [flags]
```

| Flag | 说明 |
|------|------|
| `--prompt` | 图像描述（必填） |
| `--aspect-ratio` | 比例，如 `16:9`、`1:1` |
| `--n` | 生成数量，默认 1 |
| `--subject-ref` | 主体参考：`type=character,image=path-or-url` |
| `--out-dir` | 下载图片到目录 |
| `--out-prefix` | 文件名前缀，默认 `image` |

---

## video generate

视频生成，默认模型 `MiniMax-Hailuo-2.3`。异步任务，默认轮询至完成。

```bash
minimax video generate --prompt <text> [flags]
```

| Flag | 说明 |
|------|------|
| `--prompt` | 视频描述（必填） |
| `--model` | `MiniMax-Hailuo-2.3`（默认）或 `MiniMax-Hailuo-2.3-Fast` |
| `--first-frame` | 首帧图片路径或 URL（图生视频） |
| `--download <path>` | 完成后下载到指定文件 |
| `--async` | 立即返回 task ID，不等待 |
| `--poll-interval` | 轮询间隔（秒），默认 5 |

### 配套命令

```bash
# 查询任务状态
minimax video task get --task-id <id> [--output json]

# 下载已完成视频
minimax video download --file-id <id> [--out <path>]
```

---

## speech synthesize

文字转语音，默认模型 `speech-2.8-hd`，最大 10k 字符。

```bash
minimax speech synthesize --text <text> [flags]
```

| Flag | 说明 |
|------|------|
| `--text` | 要合成的文本 |
| `--text-file <path>` | 从文件读取，`-` 读 stdin |
| `--model` | `speech-2.8-hd`（默认）、`speech-2.6`、`speech-02` |
| `--voice <id>` | 音色 ID，默认 `English_expressive_narrator` |
| `--speed` | 语速倍率 |
| `--pitch` | 音高调整 |
| `--format` | 格式，默认 `mp3` |
| `--out <path>` | 保存到文件 |
| `--stream` | 流式输出原始音频到 stdout |

**查询可用音色：**
```bash
minimax speech voices
```

---

## music generate

音乐生成，模型 `music-2.5`。

```bash
minimax music generate --prompt "<风格描述>" --lyrics "<歌词>" [flags]
```

| Flag | 说明 |
|------|------|
| `--prompt` | 音乐风格描述（可详细描述） |
| `--lyrics` | 歌词（含结构标签），用 `无歌词` 表示纯音乐。不能与 `--instrumental` 同时使用 |
| `--lyrics-file` | 从文件读取歌词，`-` 读 stdin |
| `--vocals` | 人声风格，如 `"warm male baritone"`、`"bright female soprano"`、`"duet with harmonies"` |
| `--genre` | 流派，如 folk、pop、jazz |
| `--mood` | 情绪，如 warm、melancholic、uplifting |
| `--instruments` | 乐器，如 `"acoustic guitar, piano"` |
| `--tempo` | 节奏描述，如 fast、slow、moderate |
| `--bpm` | 精确 BPM（数字） |
| `--key` | 调式，如 `C major`、`A minor`、`G sharp` |
| `--avoid` | 要避免的元素 |
| `--use-case` | 使用场景，如 `"background music for video"`、`"theme song"` |
| `--structure` | 歌曲结构，如 `"verse-chorus-verse-bridge-chorus"` |
| `--references` | 参考曲目或艺术家，如 `"similar to Ed Sheeran"` |
| `--extra` | 其他未覆盖的细节要求 |
| `--instrumental` | 纯音乐模式（无人声）。不能与 `--lyrics`/`--lyrics-file` 同时使用 |
| `--aigc-watermark` | 嵌入 AI 内容水印（用于内容溯源） |
| `--format` | 音频格式，默认 `mp3` |
| `--sample-rate` | 采样率，默认 44100 |
| `--bitrate` | 比特率，默认 256000 |
| `--stream` | 流式输出原始音频到 stdout |
| `--out <path>` | 保存到文件 |

---

## vision describe

图像理解。

```bash
minimax vision describe --image <path-or-url> [--prompt "<问题>"] [flags]
```

| Flag | 说明 |
|------|------|
| `--image` | 本地路径或 URL（自动 base64） |
| `--file-id` | 预上传的文件 ID |
| `--prompt` | 提问，默认 `"Describe the image."` |

---

## search query

网页搜索。

```bash
minimax search query --q "<查询>" [--output json]
```

---

## quota show

查看配额使用情况。

```bash
minimax quota show [--output json]
```

---

## config export-schema

导出 Anthropic/OpenAI 兼容的工具 schema，用于 agent 框架注册。

```bash
# 所有命令
minimax config export-schema

# 单个命令
minimax config export-schema --command "video generate"
```

---

## 管道用法

```bash
# stdout 始终是纯数据，可安全管道
minimax text chat --message "Hi" --output json | jq '.content'

# 链式：生成图片 → 描述图片
URL=$(minimax image generate --prompt "A sunset" --quiet)
minimax vision describe --image "$URL" --quiet

# 异步视频工作流
TASK=$(minimax video generate --prompt "A robot" --async --quiet | jq -r '.taskId')
minimax video task get --task-id "$TASK" --output json
minimax video download --task-id "$TASK" --out robot.mp4
```
