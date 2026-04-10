# OpenNeed 记忆稳态引擎安全架构

## 安全目标

`OpenNeed 记忆稳态引擎` 第一阶段的安全目标，不是“绝对自治”，而是：

- 把 blast radius 压小
- 把关键动作挡住
- 把错误恢复做出来
- 把责任链说清楚

值班处置动作见：

- [docs/operator-security-handbook.md](/Users/kane/Documents/agent-passport/docs/operator-security-handbook.md)

## 信任模型

### 本地参考源

本地参考层是本地参考源，但不是“万能控制器”。

它负责：

- 身份
- 记忆
- decision
- evidence
- compact boundary
- 运行时记录

它不负责：

- 让 LLM 永远不幻觉
- 让模型自动变成完美逻辑机

### 推理器

LLM 只是 candidate generator。

它的输出必须经过：

- context builder 的槽位约束
- 回复校验器的事实反证
- 风险分级策略
- 必要时的人工确认或 multisig

### 执行层

执行层必须按风险分级：

- low：可本地快速执行
- medium：先讨论
- high：先确认
- critical：升级到 multisig / dual control / 受限执行

## 安全边界

### 热路径

热路径默认本地运行：

- 本地参考层读取
- 本地 minutes / decision / evidence 检索
- context builder
- 回复校验
- checkpoint / resume

设计原则：

- 低延迟
- 不依赖外网
- 不把原始隐私默认送出本机

### 温路径

温路径用于增强：

- 在线 reasoner
- 在线 connector
- 在线知识更新

设计原则：

- 可以增强，不替代本地参考源
- 失联时本地仍能工作
- 进入温路径前先过本地策略

### 冷路径

冷路径只处理关键动作：

- 身份注册
- 权限变更
- 关键执行记录
- 多签升级
- 审计证明

设计原则：

- 低频
- 可校验
- 可追溯
- 不承载热路径延迟

## 关键控制项

### 1. resident lock

当前单个本地参考层默认只绑定一个 resident agent。

作用：

- 降低主体混淆
- 防止同机多 Agent 互相污染上下文
- 为本地参考层建立单一 canonical identity

### 2. local-first retrieval

默认先查本地：

- conversation minutes
- task snapshots
- decision logs
- evidence refs
- passport memories
- compact boundaries

默认策略：

- local-first
- non-vector-first
- lexical scorer
- structure-aware weighting

### 3. 回复校验器

至少要拦住这些错误：

- agent_id 错
- DID 错
- wallet 错
- parent / fork 关系错
- profile name / role 错
- 授权阈值错

### 4. encrypted local store / recovery bundle

当前已经具备：

- 加密 envelope 落盘
- 敏感读接口与写接口默认都要求本机 admin token
- 敏感读接口支持按 scope 的短时 read session
- read session 已支持 role presets、parent/child lineage 与资源绑定，父链撤销或过期会级联失效
- 资源绑定当前已经覆盖 agent / window / credential / authorization / migration repair / status list 这些敏感读面
- 核心敏感读面现在也支持 endpoint-family 级别的细 scope，与 broad scope 兼容
- `recovery` 已从 `device_runtime` scope 里拆出，降低恢复链被过度暴露的风险
- admin token 优先走系统 Keychain，文件只做回退
- store key 优先走系统 Keychain，文件只做回退
- signing master secret 优先走系统 Keychain，文件只做回退
- 显式 Keychain migration dry-run / import 路径
- 独立 store key 记录
- passphrase 包装的 recovery bundle
- dry-run 导出 / 导入链
- recovery rehearsal 校验链
- device setup 检查 resident agent / profile / task snapshot / local reasoner / recovery export 是否齐备
- 不含秘密的 device setup package 导出 / 导入链
- saved device setup package 的读取 / 删除链
- saved device setup package 的批量清理链，可按 resident / note 过滤
- device setup package 现在也会带 local reasoner profiles 摘要，迁机和重装前可以一起核对离线推理配置
- local reasoner 诊断链，可显式检查本地 provider 是否真的可达
- local reasoner catalog / probe 链，可把单机可用 provider 与模型可见性独立检查出来
- local reasoner select / prewarm 链，可把探针通过的 provider 正式切成当前 runtime，并记录最近一次预热状态
- local reasoner profile save / activate / delete 链，可把单机可用配置固化成可回放的 runtime profile
- local reasoner profile 现在会保留 health 摘要，区分 `ready / reachable / degraded / unconfigured`
- local reasoner restore-candidates / restore 链，可从最近健康 profile 推荐并回放当前离线推理配置
- sandbox action audit 历史链，可回放最近的 runtime_search / filesystem / network / process 等受限动作

目标不是让单机绝对无风险，而是：

- 默认不再明文落盘
- 默认不再把关键密钥只锁死在项目目录里
- 发生损坏或迁移时有显式恢复路径
- 恢复动作本身可审计、可演练
- resident/runtime 配置能在不携带密钥的前提下迁机预演
- 单机 setup package 可以单独列举，便于重装前确认最近的可迁移配置快照
- 单机 setup package 可以按保留策略清理，不会无限堆积

### 5. execution policy / constrained action layer

这里的 `sandbox` 只是现有字段名；当前实现本质上是受限动作执行层，不等同于 OS 级容器或系统沙箱。

不是所有动作都多签。

安全来自：

- 风险分级
- 最小权限
- 高风险动作确认
- critical 动作升级
- capability allowlist
- filesystem allowlist
- filesystem allowlist 在真实执行时按 canonical `realpath` 校验，拒绝 symlink 逃逸
- network allowlist 精确匹配
- process allowlist 精确匹配
- process_exec 默认要求绝对路径命令
- process_exec 在真实执行时会 canonicalize 到真实二进制路径再比对白名单
- process_exec 支持 `绝对路径|sha256=<digest>` 的命令摘要 pinning
- process_exec 参数预算约束
- process_exec 输入正文预算约束
- subprocess worker 独立 HOME/TMPDIR
- network worker 默认拒绝重定向
- local_command reasoner 也走受限 worker，而不是直接在主进程里起本地命令
- local_command reasoner 输入也受独立 worker 输入预算限制
- local_command 输入超限时会显式失败，不会把 JSON 从中间截断后继续执行
- read/list budget
- worker backend 分层
- read_session 访问 `/api/security` 与 recovery 列表时默认 redacted，不回本地敏感路径
- read_session 访问 saved setup package detail 与 local reasoner catalog 时也会 redaction 本地绝对路径
- read_session 访问 saved setup package detail 时，embedded local reasoner profiles 里的 `command / args / cwd` 也会 redaction
- read_session 访问 local reasoner 运行态时，也不会拿到 command/cwd 或预热响应正文
- read_session 访问 sandbox action audit 时，也不会直接拿到路径、命令路径、URL、stdout/stderr、preview 等敏感字段
- read_session 访问 `agents/context/runtime/messages/memories/credentials/rehydrate/search` 时默认走 field-level redaction，不再直接透传自由文本、raw credential proof 或 rehydrate prompt

### 6. compact boundary / resume

安全不仅是防止出错，也是出错后能恢复。

所以：

- working memory 要 checkpoint
- 历史要压缩成 boundary
- runner 要能从 boundary 后 resume
- 不靠无限长聊天续命

## 当前已知缺口

第一阶段现在仍然缺：

1. 系统级密钥隔离
- 本地账本已经进入加密 envelope 模式，admin/store/signing key 也都支持 Keychain-first，但仍需继续推进更强的系统级密钥隔离/HSM

2. 受限执行层
- 高风险执行已经有风险分级、capability 阻断、allowlist、参数预算和 isolated worker env，但还没有真正收口到 OS 级独立隔离环境

3. 读权限细化
- 敏感 GET 已经支持 admin token、role-scoped read session、parent/child session hierarchy、资源绑定、endpoint-family 细 scope 与 field-level redaction，且已覆盖 agent/window/credential/authorization/migration repair/status list 等核心敏感读面，但仍缺更细的角色层级、按字段/按对象模板化授权

4. 备份 / 恢复 / 灾备
- 已有 recovery bundle 导出/导入雏形，也支持优先恢复到 Keychain，但还缺系统级备份、恢复演练和灾备流程

## 下一阶段 P0

### 本地存储加密

- at-rest encryption
- machine-bound key / passphrase mode
- tamper check
- recovery bundle hardening

### 受限执行层

- capability tiers
- filesystem allowlist
- network allowlist
- budgeted execution
- isolated execution backend

### 安全架构基线

- threat model
- trust boundary diagram
- incident response
- recovery playbook

## 责任边界

第一阶段不把 Agent 定义成法律主体。

更现实的责任链是：

- 委托主体 / 持有者：谁授权谁负责
- 运营主体：谁部署谁负责
- 平台 / 开发方：对软件缺陷和严重安全漏洞负责

记忆稳态引擎的作用不是替责任“消失”，而是让责任链更清楚。

## 一句话收口

`OpenNeed 记忆稳态引擎` 的安全目标，不是让 LLM 永远正确，而是让错误更难污染本地参考层、更难越权执行、也更容易被恢复和追责。
