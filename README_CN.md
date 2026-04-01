# minimax-cli

[MiniMax AI 开放平台](https://platform.minimaxi.com) 的命令行工具——在终端生成文字、图像、视频、语音和音乐。

支持**国际版**（`api.minimax.io`）和**国内版**（`api.minimaxi.com`），自动识别区域。

[English](README.md)

---

## 安装

需要 [Node.js](https://nodejs.org) 18+。

```bash
npm install -g minimax-cli
```

---

## 快速开始

```bash
minimax auth login --api-key sk-xxxxx

minimax text chat --message "你好，MiniMax！"
minimax image "一只穿宇航服的猫"
minimax speech synthesize --text "你好！" --out hello.mp3
minimax search "MiniMax AI 最新动态"
minimax vision photo.jpg
minimax quota
```

---

## 命令参考

### 文本对话

```bash
minimax text chat --message "写一首诗"
minimax text chat --model MiniMax-M2.7-highspeed --message "你好" --stream
minimax text chat --system "你是编程助手" --message "用 Go 写 Fizzbuzz"
minimax text chat --message "user:你好" --message "assistant:嗨！" --message "你叫什么名字？"
cat messages.json | minimax text chat --messages-file - --output json
```

### 图像生成

```bash
minimax image "一只穿宇航服的猫"                    # 简写
minimax image generate --prompt "科技感 Logo" --n 3 --aspect-ratio 16:9
minimax image generate --prompt "山水画" --out-dir ./output/
```

### 视频生成

```bash
minimax video generate --prompt "海浪拍打礁石" --async
minimax video generate --prompt "机器人作画" --download sunset.mp4
minimax video task get --task-id 123456
minimax video download --file-id 176844028768320 --out video.mp4
```

### 语音合成

```bash
minimax speech synthesize --text "你好！" --out hello.mp3
minimax speech synthesize --text "流式输出" --stream | mpv -
minimax speech synthesize --text "Hi" --voice Boyan_new_hailuo --speed 1.2
echo "头条新闻" | minimax speech synthesize --text-file - --out news.mp3
minimax speech voices                             # 列出可用音色
```

### 音乐生成

```bash
minimax music "欢快的流行乐"                         # 简写
minimax music generate --prompt "爵士风" --lyrics "啦啦啦" --out song.mp3
```

### 图像理解

```bash
minimax vision photo.jpg                          # 简写
minimax vision describe --image https://example.com/img.jpg --prompt "这是什么品种的狗？"
minimax vision describe --file-id file-123
```

### 网络搜索

```bash
minimax search "MiniMax AI"                       # 简写
minimax search query --q "最新动态" --output json
```

### 配额与配置

```bash
minimax quota                                     # 查看配额用量
minimax config show
minimax config set --key region --value cn
minimax config export-schema | jq .
```

### 认证

```bash
minimax auth login --api-key sk-xxxxx             # API Key 登录
minimax auth login                                # OAuth 浏览器授权
minimax auth status
minimax auth refresh
minimax auth logout
```

### 更新

```bash
minimax update
minimax update latest
```

---

## 许可证

MIT
