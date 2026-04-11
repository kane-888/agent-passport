# OpenNeed 记忆稳态引擎跨机器恢复演练

## 目标

这份流程只验证一件事：

同一个本地 Agent 能不能从源机器，按固定顺序，在目标机器上被完整接回。

不是口头证明。是一次可重复的演练。

## 固定顺序

1. 在源机器确认正式恢复主线已尽量补齐
2. 导出最新恢复包
3. 导出最新初始化包
4. 在目标机器导入恢复包
5. 在目标机器导入初始化包
6. 在目标机器做一致性核验
7. 记录结果并决定是否具备真实切机资格

不要改顺序。初始化包不能替代恢复包，恢复包也不能替代初始化包。

## 角色

- 源机器操作员：负责导出、保全、记录
- 目标机器操作员：负责导入、验证、回滚
- 持有者 / 委托主体：决定这次演练是否通过、是否允许真实切机

## 开始前条件

### 源机器

- `/api/security` 没有进入 `panic`
- `/api/device/setup` 可用
- 最近一次恢复演练不是明显过期状态；如果已过期，先补跑
- 现有恢复包、初始化包都可列举

### 目标机器

- 新环境或干净环境
- 本地服务可启动
- 不复用不明来源的旧账本目录
- 明确这次是 rehearsal，不直接替换正式生产环境

## 源机器动作

### 1. 固定现场

- 如有写入污染风险，先切到 `read_only`
- 如有执行风险，先切到 `disable_exec`
- 如有密钥或扩散风险，先 `panic`

### 2. 记录源机器基线

至少保存：

- `/api/security`
- `/api/device/setup`
- 当前 resident agent
- 当前 active DID method
- 当前正式恢复下一步
- 最近恢复包、恢复演练、初始化包时间

### 3. 导出恢复包

要求：

- 使用新的备注
- 记录 bundle id / createdAt / 是否包含 ledger envelope
- 单独保存恢复口令

### 4. 导出初始化包

要求：

- 在恢复包导出后立刻导出
- 记录 package id / createdAt / resident agent / did method

## 目标机器动作

### 1. 导入恢复包

目标：

- 恢复 store key
- 必要时恢复 ledger envelope
- 不绕过导入策略直接手工拼装文件
- 先跑 dry-run；如果目标机器已经有 store key 或 ledger envelope，必须显式传 `overwrite=true`，否则导入应直接拒绝

### 2. 导入初始化包

目标：

- 恢复 resident agent、did method、runtime 配置
- 恢复 local reasoner / retrieval / constrained execution 配置

### 3. 运行核验

至少检查：

- `/api/health`
- `/api/security`
- `/api/device/setup`
- resident agent 是否一致
- chainId 是否一致
- formalRecoveryFlow.status 是否合理
- constrained execution 是否仍处于受控状态
- local reasoner 是否可探测 / 可预热

## 通过标准

这次演练通过，至少要同时满足：

- 目标机器能正常启动本地服务
- resident agent 与源机器一致
- chainId 一致
- 恢复包成功导入
- 初始化包成功导入
- 正式恢复流程没有出现新的关键缺口
- 目标机器没有因为导入导致受限执行层静默退化

## 失败标准

任何一条成立都算失败：

- 需要人工拼装 JSON 或手工补路径才能导入
- 导入后 resident agent 不一致
- 导入后链路能启动，但关键边界退化且未被显式暴露
- 恢复结果依赖“看起来差不多”，而不是明确核验项

## 失败后怎么做

- 目标机器环境回滚，不把失败结果当半成品继续用
- 保留失败时的 `/api/security` 和 `/api/device/setup`
- 记录失败发生在：
  - 恢复包导入
  - 初始化包导入
  - 本地 reasoner 恢复
  - 受限执行边界恢复
  - resident/runtime 一致性核验

## 演练记录模板

每次都至少记录：

- 源机器时间
- 目标机器时间
- bundle id
- setup package id
- resident agent
- chainId
- 是否通过
- 唯一阻塞原因
- 后续动作

## 一句话收口

跨机器恢复演练不是“证明大概能迁机”，而是证明在不靠手工救火的前提下，另一台机器能按固定顺序把同一个 Agent 接回来。
