# 记忆稳态引擎 / agent-passport / openneed 分层纠偏结果

更新时间：2026-05-05

属性：本体边界说明 + 桥接/兼容归类。

## 底层事实

本线程从现在开始固定两条事实：

1. `OpenNeed / gemma4:e4b / Ollama` 相关的大语言模型能力，概念归属在 `记忆稳态引擎` 里面；记忆稳态引擎才是模型底座、本地推理、记忆压缩和稳态维持的本体。
2. `openneed` 只是基于 `记忆稳态引擎 + agent-passport` 构建出来的 app；它只负责调用、编排和业务闭环，不拥有底层模型 runtime、本地推理引擎或连续身份层本体。

## 三层边界

| 层 | 属性 | 负责什么 | 不负责什么 |
|---|---|---|---|
| 记忆稳态引擎 | 本体 | 模型底座、本地推理、`gemma4:e4b` / Ollama 接入、记忆压缩、稳态维持、上下文坍缩风险纠偏。 | 不拥有 agent 身份、授权、长期审计语义，也不做 app 业务闭环。 |
| `agent-passport` | 本体 | 连续身份、长期偏好、恢复、长期记忆、本地参考层、审计、受限执行边界。 | 不把 app 名改写成底层模型名，不把历史 OpenNeed 兼容名当正式 runtime 主体。 |
| `openneed` | 桥接 / app | 调用记忆稳态引擎和 `agent-passport`，做业务编排、adapter ingest、replay、recover、journal 和业务闭环。 | 不拥有底层模型、不拥有本地推理本体、不拥有连续身份本体。 |

## 合并方向

这次纠偏不是把记忆稳态引擎放到 `agent-passport` 外面，也不是把它降级成普通插件；线程目标是把记忆稳态引擎作为底层本体并入 `agent-passport` 运行栈。

合并后的关系是：

- `记忆稳态引擎` 提供模型底座、本地推理、压缩、稳态判断和纠偏策略。
- `agent-passport` 承载这套底层能力，并把它接到连续身份、长期记忆、恢复、审计和受限执行上。
- `openneed` 作为 app，只能调用这个运行栈，不能把调用关系改写成“OpenNeed 拥有底层模型”。

## 本体能力

- `src/memory-engine-branding.js`
  - 属性：本体。
  - 规范定义 `记忆稳态引擎`、`记忆稳态引擎本地推理`、`gemma4:e4b` 与本地 Ollama 模型 ID。
  - 旧 `OpenNeed` / `agent-passport` 展示名只在这里被解析到 canonical 模型 ID，不改变本体归属。
- `scripts/memory-stability-local-reasoner.mjs`
  - 属性：本体 + 兼容读取。
  - 正式 reasoner 入口归属记忆稳态引擎；读取 legacy env 只是迁移容错。
- `src/ledger-device-runtime.js`、`src/local-model-assets/registry.js`
  - 属性：本体消费方。
  - 只消费记忆稳态引擎的 canonical model / asset / provider 配置。
- 记忆分层、source monitoring、consolidation、replay、context builder、memory compactor、稳态风险指标
  - 属性：本体能力。
  - 这些属于记忆稳态引擎提供给 `agent-passport` runtime 的底层能力。

## agent-passport 本体能力

- DID / VC / wallet / multisig / local ledger / audit evidence。
- 连续身份、长期偏好、长期记忆、恢复、冷启动包、compact boundary、正式恢复 SOP。
- 本地参考层、受限执行、安全门禁、管理令牌、恢复审计。
- 对外产品叙事统一为 `agent-passport`；它消费记忆稳态引擎，但不拥有模型底座。

## 桥接能力

- `src/offline-chat-runtime-compat.js`
  - 属性：桥接。
  - 把历史 env / protocol alias 收口到兼容边界，再输出 canonical offline runtime 配置。
- `src/openneed-memory-engine-compat.js`
  - 属性：兼容桥接。
  - 保留旧 OpenNeed 命名、标题和 reasoner alias，输出统一归到记忆稳态引擎。
- `adapter ingest / replay / recover / journal`
  - 属性：桥接。
  - 可为 `openneed` app 服务，但不改变底层能力归属。
- `openneed` UI、H5、业务闭环、增长前端、业务场景 orchestration
  - 属性：app 层。
  - 只能调用底层能力，不可声明自己拥有底层模型 runtime。

## 兼容残留

- 文件名残留：
  - `docs/openneed-memory-homeostasis-engine-*.md`
  - `src/openneed-memory-engine.js`
  - `scripts/openneed-local-reasoner.mjs`
  - `npm run demo:openneed-reasoner`
- 环境变量残留：
  - `OPENNEED_LOCAL_LLM_*`
  - `OPENNEED_LOCAL_GEMMA_*`
  - `OPENNEED_OFFLINE_*`
  - `OPENNEED_CHAIN_ID`
- 协议 / 数据残留：
  - `did:openneed:`
  - `agent_openneed_agents`
  - historical Render resource names such as `openneed-memory-homeostasis-engine`

这些残留只允许出现在兼容、迁移、旧数据读取、历史资源绑定和测试夹具里。任何公开叙事、正式架构判断、prompt 或新接口默认值，都必须回到 `记忆稳态引擎 + agent-passport + openneed app` 的三层边界。

## 已标出的误读风险

- `OpenNeed 记忆稳态引擎`
  - 属性：历史兼容名。
  - 处理：只允许作为 legacy alias 被解析，不允许作为正式公开产品名或底层模型名。
- `OpenNeed / gemma4:e4b / Ollama`
  - 属性：本体能力在记忆稳态引擎，OpenNeed 名称只是兼容输入。
  - 处理：canonical env 使用 `MEMORY_STABILITY_OLLAMA_*`。
- `openneed-memory-homeostasis-engine-*`
  - 属性：文件名 / 部署名兼容残留。
  - 处理：文档正文必须声明文件名不代表本体归属。
- `openneed` bridge adapter
  - 属性：桥接 / app。
  - 处理：只能执行业务侧调用、纠偏执行和审计回写，不能拥有模型底座。

## 需要继续迁移或清理

1. 后续新增文档默认使用 `memory-stability-*` 或 `agent-passport-*` 命名，不再新增 `openneed-memory-homeostasis-engine-*` 文件。
2. 逐步把 `OPENNEED_LOCAL_*` env 的文档入口降级为 legacy fallback，并在新部署模板中只推荐 `MEMORY_STABILITY_OLLAMA_*`。
3. 若历史 Render 资源允许改名，再把 `openneed-memory-homeostasis-*` 资源名迁移到 `agent-passport` 或 `memory-stability` 命名；迁移前保持兼容注释。
4. 继续把 `did:openneed:`、`agent_openneed_agents`、OpenNeed display text 限制在显式 compatibility expansion 和旧数据读取路径内。
5. 后续 prompt / UI 文案 / release note 禁止出现“OpenNeed 拥有底层模型、本地推理、连续身份本体”这类表达。
