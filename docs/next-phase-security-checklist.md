# Agent Passport 下一阶段实施清单

## 目标

下一阶段不继续横向扩概念，而是优先补三件事：

1. 安全架构
2. 本地存储加密
3. 受限执行层

这三件事不是“锦上添花”，而是让单机 single-agent runtime 真正可发布的底线。

## 1. 安全架构

### 为什么先做

`Agent Passport` 汇聚的是身份、记忆、权限、证据和关键回执。

如果没有明确的安全架构，所有“主权”和“恢复能力”都会变成集中风险。

### 下一阶段输出物

- threat model
- trust boundary diagram
- key lifecycle
- incident response flow
- backup / restore / revoke plan

### 验收标准

- 能明确区分热路径、本地路径、联网增强路径、受控冷路径
- 能明确区分用户责任、运营责任、平台责任
- 能明确高风险动作的默认阻断和确认机制

## 2. 本地存储加密

### 为什么先做

当前已经有一版加密 envelope。

但密钥仍然在同机侧，备份 / 导出 / 恢复也还没形成正式流程，所以这条线还不能算真正完成。

### 下一阶段输出物

- ledger at-rest encryption
- machine-bound key / passphrase mode
- store integrity check
- export / import / unwrap flow

### 验收标准

- 默认不能直接明文读取 Passport store
- 篡改或解密失败时 runtime 明确拒绝启动
- 备份与恢复不依赖手工拼装 JSON

## 3. 受限执行层

### 为什么先做

Agent 的风险不在“会不会回答错一句话”，而在“会不会拿着错误理解去操作系统和外部世界”。

### 下一阶段输出物

- tool capability tiers
- filesystem allowlist
- network allowlist
- budgeted command execution
- confirmation hooks for high-risk actions

### 验收标准

- 高风险动作默认无法直达宿主系统
- 执行前能给出策略判定、确认需求和审计记录
- 即使模型漂移，也不容易越权放大损害

## 4. 配套能力

为了让上面三件事真正可用，下一阶段还要顺手补：

- 显式 transcript / state model
- QueryState + SessionState 状态迁移
- 本地检索栈
- backup / restore / migration tooling

## 实施优先级

### P0

- 安全架构
- 本地存储加密
- 受限执行层

### P1

- transcript / state model
- 本地检索增强
- 备份恢复工具

## 发布门槛

### 可以继续内部 Alpha 的条件

- 当前已有 resident lock、runtime bootstrap、rehydrate、回复校验、local runtime search

### 进入私测 Beta 前必须完成

- 至少一版安全架构
- 一版本地存储加密
- 一版受限执行层

### 对外 Preview 前必须完成

- 备份 / 恢复 / 迁移
- 高风险动作审计与回滚
- 更稳定的 transcript / state model

## 一句话收口

下一阶段不是继续把概念讲大，而是先把这台电脑里的那个 Agent 保护好、关好、救得回来。
