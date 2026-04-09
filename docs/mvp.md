# OpenNeed 记忆稳态引擎 MVP

## 第一阶段目标

第一阶段只做一件事：

`把一个 Agent 稳定住进一台电脑里。`

这意味着：

- 当前单个本地参考层默认只绑定一个 resident agent
- 本地参考层本地优先
- 对话不是身份
- 忘了时先查本地纪要和结构化记忆
- 高风险动作先协商、再确认、必要时升级到多签

## MVP 范围

### 必须有

1. resident agent binding
- 当前本地参考层默认只绑定一个 canonical agent

2. local-first local reference store
- 身份、记忆、decision、evidence、compact boundary 默认存在本机
- 本地参考层默认加密落盘，不再直接明文回写

3. four-layer memory
- ledger
- profile
- episodic
- working

4. context builder
- 每轮按槽位重建，而不是拼整段聊天历史

5. 回复校验器
- 错误身份、角色、钱包、授权阈值不能静默写回本地参考层

6. runner loop
- build context
- reason
- verify
- compact
- checkpoint
- resume

7. local minutes + local search
- Agent 忘记后先查本地纪要、decision、evidence、compact boundary

8. risk-tiered execution
- low risk：本地快速执行
- medium risk：先讨论
- high risk：先确认
- critical：升级到 multisig / dual control

9. local admin token
- `/api` 写接口默认需要本机 admin token

## 明确不做

- 不做全网平台打通
- 不做每条记忆上链
- 不做默认云端向量库依赖
- 不做所有动作都多签
- 不做代币发行

## 热 / 温 / 冷路径

### 热路径

热路径必须足够轻：

- 本地参考层
- 本地 lexical / tag 检索
- 本地 context builder
- 本地回复校验
- 本地 working memory checkpoint

### 温路径

温路径做增强：

- 在线大模型
- 在线 connector
- 在线工具

### 冷路径

冷路径只处理关键事件：

- 身份事件
- 关键授权
- 高风险执行记录
- 审计证明

## 成本策略

第一阶段的成本控制原则：

1. 本地优先
- 原始记忆和纪要默认不常驻云端

2. 结构化优先
- 能存字段就不存长文本
- 能存 snapshot 就不存整段聊天

3. 非向量优先
- 默认 lexical / tag / field 检索
- vector index 不是第一阶段前提

4. 冷热分层
- working layer 短、可滚动
- profile / task snapshot 稳定
- conversation minutes / evidence refs 作为冷恢复材料

## 发布门槛

### 内部 Alpha

需要：

- resident lock
- bootstrap
- local minutes
- runtime search
- runner loop
- rehydrate / resume

### 私测 Beta

在 Alpha 基础上，还需要：

- 一版安全架构
- 一版本地存储加密
- 一版受限执行层

### 对外 Preview

在 Beta 基础上，还需要：

- 备份 / 恢复 / 迁移
- 更稳定的 transcript / state model
- 更明确的高风险动作审计与回滚

## 成功标准

第一阶段成功，不看有没有“全球协议叙事”，只看：

- 单机 resident agent 是否稳定
- 忘记后是否真的能从本地恢复
- 日常动作是否保持低延迟
- 高风险动作是否真的会被挡住或升级
- 人工接管后是否还能续跑
