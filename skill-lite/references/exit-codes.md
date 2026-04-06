# Exit Codes

| Code | 含义 |
|------|------|
| 0 | 成功 |
| 1 | 通用错误 / 服务端错误 |
| 2 | 用法错误（参数错误、缺少必填项） |
| 3 | 认证错误 |
| 4 | 配额超限 |
| 5 | 超时 |
| 10 | 内容安全过滤触发 |

## 在 agent 中处理

```bash
minimax image generate --prompt "..." --quiet
EXIT=$?

case $EXIT in
  0) echo "成功" ;;
  3) minimax auth login ;;   # 重新认证
  4) echo "配额不足，检查账户" ;;
  10) echo "内容被过滤，修改 prompt" ;;
  *) echo "错误: $EXIT" ;;
esac
```
