# agent-passport 记忆稳态引擎本地 Reasoner 接入

这个脚本用于让 agent-passport 底层记忆稳态 runtime 保持独立，同时继续兼容旧的 OpenNeed 本地优先 reasoner 入口。

## 目标

- 不依赖 Google 在线 API
- 优先本地下载、本地运行、离线可用
- 让记忆稳态引擎继续做身份、记忆、资产和连续性
- 让本地 reasoner 回答栈负责引擎侧的身份助手与记忆上下文回答

## 新增脚本

- [scripts/openneed-local-reasoner.mjs](../scripts/openneed-local-reasoner.mjs)

它兼容现有 `local_command` reasoner 形态：

- stdin 输入 JSON
- stdout 输出 `json_reasoner_v1`
- 优先尝试本地 `Ollama`
- 失败时回退到最小身份摘要

## 推荐环境变量

```bash
OPENNEED_LOCAL_GEMMA_BASE_URL=http://127.0.0.1:11434
AGENT_PASSPORT_OLLAMA_MODEL=gemma4:e4b
```

`OPENNEED_LOCAL_GEMMA_MODEL` 仍可作为历史兼容变量使用，但它代表的是本地 Ollama 模型 ID，不是公开产品名。不要把 `agent-passport` 填成模型名；`agent-passport` 是对外产品和运行时名称。

## 直接本地验证

```bash
npm run demo:openneed-reasoner
```

这个脚本本身不会自动启动记忆稳态引擎服务，它的作用是提供一个可被 `local_command` 选中的本地 reasoner 入口。
脚本会继续兼容旧的 `OpenNeed` 展示名并解析到默认本地 Ollama 模型；新配置优先使用 `AGENT_PASSPORT_OLLAMA_MODEL`，把产品名和模型 ID 分开，避免操作员误把公开名称当成底层模型。
