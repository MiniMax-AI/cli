# Agent Flags

在非交互（agent/CI）环境下始终加这些 flags：

| Flag | 作用 |
|------|------|
| `--non-interactive` | 缺少参数时直接报错，不弹出交互提示 |
| `--quiet` | 关闭 spinner/进度条，stdout 输出纯数据 |
| `--output json` | 机器可读的 JSON 输出 |
| `--async` | 立即返回 task ID（视频生成适用） |
| `--dry-run` | 预览 API 请求，不实际执行 |
| `--yes` | 跳过确认提示 |

## 典型 agent 调用模板

```bash
# 图像生成（同步，直接得到 URL）
minimax image generate --prompt "..." --non-interactive --quiet --output json

# 视频生成（异步，先拿 task ID）
TASK=$(minimax video generate --prompt "..." --async --non-interactive --quiet | jq -r '.taskId')
minimax video task get --task-id "$TASK" --output json
minimax video download --task-id "$TASK" --out video.mp4

# 语音合成（输出到文件）
minimax speech synthesize --text "..." --out speech.mp3 --non-interactive --quiet
```
