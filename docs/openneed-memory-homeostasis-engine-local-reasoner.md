# 记忆稳态引擎本地 Reasoner 接入

属性：本体 + 兼容（文件名为历史兼容残留；`OpenNeed` 只保留 legacy alias，不拥有本地推理本体）

这个文档描述的是记忆稳态引擎的本地 reasoner 本体，以及它为了兼容历史入口而保留的 bridge / demo 路径。

## 目标

- 不依赖 Google 在线 API
- 优先本地下载、本地运行、离线可用
- 让记忆稳态引擎负责模型底座、本地推理、记忆压缩和稳态维持
- 让 agent-passport 继续负责连续身份、长期记忆、恢复和审计
- 让本地 reasoner 回答栈负责引擎侧的上下文回答，不把 app 名误写成模型本体

## 新增脚本

- 正式入口：[scripts/memory-stability-local-reasoner.mjs](../scripts/memory-stability-local-reasoner.mjs)
- 历史兼容入口：[scripts/openneed-local-reasoner.mjs](../scripts/openneed-local-reasoner.mjs)

正式入口兼容现有 `local_command` reasoner 形态：

- stdin 输入 JSON
- stdout 输出 `json_reasoner_v1`
- 优先尝试本地 `Ollama`
- 失败时回退到最小身份摘要

## 推荐环境变量

```bash
MEMORY_STABILITY_OLLAMA_BASE_URL=http://127.0.0.1:11434
MEMORY_STABILITY_OLLAMA_MODEL=gemma4:e4b
```

`AGENT_PASSPORT_OLLAMA_MODEL`、`OPENNEED_LOCAL_GEMMA_BASE_URL` 和 `OPENNEED_LOCAL_GEMMA_MODEL` 仍可作为历史兼容变量使用，但它们代表的都只是本地 Ollama 连接参数或模型 ID，不是公开产品名，更不是架构归属。不要把 `agent-passport` 或 `OpenNeed` 填成模型名；最终都会解析到记忆稳态引擎的 local reasoner / Ollama 模型。

## 直接本地验证

```bash
npm run demo:memory-stability-reasoner
```

如果需要验证历史兼容入口，才使用：

```bash
npm run demo:openneed-reasoner
```

这些脚本本身都不会自动启动记忆稳态引擎服务；它们的作用是提供一个可被 `local_command` 选中的本地 reasoner 入口。历史 `OpenNeed` 脚本只保留为兼容 / demo 路径，不代表当前正式主入口，更不代表 `openneed` 拥有本地推理本体。
