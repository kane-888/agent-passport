# 正式恢复周期与轮换策略

这份说明只回答 3 个问题：

1. 恢复演练什么时候算到期
2. 哪些事件发生后必须重跑
3. 哪些自动化只能清理，不能替代正式恢复

## 运行态看哪里

- `/` 的“正式恢复周期”：给公开概览
- `/` 的“自动恢复边界”：提醒自动恢复有没有越位
- `GET /api/security` 里的 `localStorageFormalFlow.operationalCadence`
- `GET /api/security` 里的 `automaticRecovery.operatorBoundary`
- `GET /api/device/setup` 里的 `formalRecoveryFlow.operationalCadence`
- `/lab.html` 的 runtime housekeeping 面板：只是 `POST /api/security/runtime-housekeeping` 的维护入口

不要口头判断。先看这几个字段。公开运行态只负责给态势，不直接生成新的恢复包或初始化包。

## 固定周期

- 如果策略要求 recent rehearsal，就按 `operationalCadence.rehearsalWindowHours` 执行
- `operationalCadence.nextRequiredAt` 表示最晚应在什么时候前补跑
- `operationalCadence.status` 只看 5 种：
  - `within_window`：还在窗口内
  - `due_soon`：快到期了，先安排
  - `overdue`：已经过期，先补步骤 3，必要时补 4
  - `missing`：还没有通过记录
  - `optional_*`：当前策略没强制，但仍建议保留通过记录

## 必须重跑的触发事件

- `store key` 轮换后：重跑 `1 -> 2 -> 3 -> 4`
- `signing key` 轮换后：重跑 `1 -> 2 -> 3 -> 4`
- 恢复包重导或轮换后：至少重跑 `3 -> 4`
- 真实切机前：先补一次跨机器恢复演练
- 事故交接、恢复复机、重新放开执行前：确认 recent rehearsal 仍在窗口内

这些触发项也会出现在 `operationalCadence.rerunTriggers`。

## 自动化边界

当前已经有一类自动化：

- `POST /api/security/runtime-housekeeping`

`/lab.html` 上有对应的 housekeeping UI，但它只是这条接口的操作壳。

它能做的只有：

- 撤销现有 read sessions
- 按保留窗口清理旧恢复包
- 按保留窗口清理旧初始化包

它不能做的事：

- 不能生成新的恢复包
- 不能替代恢复演练
- 不能把正式恢复直接标成 ready
- 不能证明另一台机器已经可接管

所以：

- 清理自动化是“减旧”，不是“补新”
- 自动恢复 / 续跑是“临时接力”，不是“备份完成”

## 值班动作

- `operationalCadence.status=due_soon`：先约下一轮恢复演练
- `operationalCadence.status=overdue`：先补正式恢复步骤 3，必要时补 4
- `automaticRecovery.operatorBoundary.formalFlowReady=false`：即使 runner 能续跑，也不能把正式恢复当成完成

## 一句话收口

恢复周期的本质不是“记得偶尔跑一下”，而是系统明确告诉你：什么时候到期、为什么必须重跑、哪些自动化绝不能冒充正式恢复。
