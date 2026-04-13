# OpenNeed 记忆稳态引擎本地 Reasoner 接入

这个脚本用于让底层记忆稳态引擎 runtime 保持独立，同时可以被 `OpenNeed` 的本地优先架构复用。

## 目标

- 不依赖 Google 在线 API
- 优先本地下载、本地运行、离线可用
- 让记忆稳态引擎继续做身份、记忆、资产和连续性
- 让本地 OpenNeed 回答栈负责引擎侧的身份助手与记忆上下文回答

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
OPENNEED_LOCAL_GEMMA_MODEL=OpenNeed
```

## 直接本地验证

```bash
npm run demo:openneed-reasoner
```

这个脚本本身不会自动启动记忆稳态引擎服务，它的作用是提供一个可被 `local_command` 选中的本地 reasoner 入口。
脚本会把展示名 `OpenNeed` 自动解析到默认本地 Ollama 模型，因此界面和配置里不需要继续裸露底层模型 ID。
