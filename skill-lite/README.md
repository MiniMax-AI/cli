# skill-lite

轻量版 MiniMax CLI skill，适合 token 敏感的 agent 环境。

## 设计理念：复用 CLI 原生渐进式披露

**MiniMax CLI 的核心设计是渐进式披露（Progressive Disclosure）：**

```
minimax --help           # 第一层：所有资源
minimax music --help     # 第二层：该资源下的所有动词
minimax music generate --help  # 第三层：该命令的完整参数表
```

用户从顶层逐步深入，按需获取信息，不需要记忆复杂文档。

**skill-lite 的设计复用这个理念：**

- 不在 skill 里复制完整参数表（那样会重复 CLI 的功能，且需同步维护）
- 只列高频命令，引导 agent 用 `--help` 获取完整参数
- references/ 提供关键信息速查（agent flags、exit codes），但不是完整参数表

**为什么这样更合理：**

| 方案 | 问题 |
|------|------|
| 在 skill 里复制完整参数表 | 1. 重复 CLI 功能；2. 每次 CLI 更新参数都要同步改 skill；3. token 消耗高 |
| 引导用 `--help` | 1. 参数始终最新（CLI 自己维护）；2. skill 几乎不需要维护；3. token 消耗低 |

**Token 节省：**

| 版本 | Token 消耗 |
|------|------------|
| skill/SKILL.md（全量） | ~4000 |
| skill-lite/（轻量） | ~1000 |

节省约 75%，对于 token 受限的 agent 框架意义重大。

## 与 skill/SKILL.md 的区别

| 项目 | skill/SKILL.md（全量） | skill-lite/（轻量） |
|------|------------------------|---------------------|
| Token 消耗 | ~4000 | ~1000 |
| 参数表 | 完整列出 | 引导用 `--help` |
| 分层 | 单层 | 三层（references 按需加载） |
| 维护成本 | 高（需同步 CLI 更新） | 低（引导而非复制） |
| 设计理念 | 人类参考文档 | 复用 CLI 渐进式披露 |

## 适用场景

- **skill/SKILL.md**：IDE 集成、人类参考、需要完整离线文档
- **skill-lite/**：OpenClaw、Claude Code、其他 token 受限的 agent 框架

## 使用方式

将 `skill-lite/` 复制到你的 agent skill 目录，或让 agent 框架加载 `SKILL.md`。

Agent 触发时会：
1. 只加载 `SKILL.md`（轻量，~60 行）
2. 需要更多信息时读 `references/`
3. 需要完整参数时用 `minimax <command> --help`

## 两个版本并存

`skill/SKILL.md` 和 `skill-lite/` 都是官方支持的版本，用户可根据场景选择。