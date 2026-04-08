# OpenNeed 对接 Agent Passport 本地 Gemma Reasoner

这个脚本用于让 `Agent Passport` 保持独立，同时可以被 `OpenNeed` 的本地优先架构复用。

## 目标

- 不依赖 Google 在线 API
- 优先本地下载、本地运行、离线可用
- 让 Passport 继续做身份、记忆、资产和连续性
- 让本地 Gemma 负责 Passport 侧的身份助手与记忆上下文回答

## 新增脚本

- [scripts/openneed-local-reasoner.mjs](/Users/kane/Documents/agent-passport/scripts/openneed-local-reasoner.mjs)

它兼容 Passport 已有的 `local_command` reasoner 形态：

- stdin 输入 JSON
- stdout 输出 `json_reasoner_v1`
- 优先尝试本地 `Ollama`
- 失败时回退到最小身份摘要

## 推荐环境变量

```bash
OPENNEED_LOCAL_GEMMA_BASE_URL=http://127.0.0.1:11434
OPENNEED_LOCAL_GEMMA_MODEL=gemma4:e4b
```

## 直接本地验证

```bash
npm run demo:openneed-reasoner
```

这个脚本本身不会自动启动 Passport 服务，它的作用是提供一个可被 `local_command` 选中的本地 reasoner 入口。
