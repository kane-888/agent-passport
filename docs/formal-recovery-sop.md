# 正式恢复 SOP

这份 SOP 面向当前单机单 Agent 的 `agent-passport` runtime；它的底层运行时引擎是 `agent-passport 记忆稳态引擎`。目标是把下面 4 件事收成一条可重复执行的正式主线：

1. 本地账本和签名密钥进入受保护存储
2. 导出恢复包
3. 执行恢复演练
4. 导出初始化包

公开运行态 `/` 上的“正式恢复周期”“自动恢复边界”“可用入口”，`/operator` 上的值班决策面，以及 `/api/device/setup` 返回的 `formalRecoveryFlow.runbook` / `formalRecoveryFlow.crossDeviceRecoveryClosure`，就是这份 SOP 的运行态投影。首页不再承载旧混合控制台；真正的恢复动作走受保护 API。

`/lab.html` 只做维护减旧，`/repair-hub` 只给修复证据；它们都不替代正式恢复动作或值班拍板。

如果用 `smoke:browser` 检查这层投影，当前 gate 会要求 DOM 级验证首页 4 张卡、触发条件和入口列表与 `/api/health` / `/api/security` 当前真值一致；Safari automation 不可用时直接失败。

## 最短动作链

正式恢复只按这一条主线走：

1. 先把本地账本和签名密钥放进受保护存储。
2. 再导出恢复包。
3. 再跑恢复演练。
4. 最后导出初始化包。

只有 `1 -> 2 -> 3 -> 4` 都完成，且 `formalRecoveryFlow.durableRestoreReady=true`，才算正式恢复达标。

下面这些都不算正式恢复完成：

- 只有自动恢复 / 续跑还能继续
- 只有 `/lab.html` 做了维护减旧
- 只有恢复包或初始化包，没有通过恢复演练

如果要验证“另一台机器能不能把同一个 Agent 接回来”，直接按下面这份固定流程执行：

- [docs/cross-device-recovery-rehearsal.md](cross-device-recovery-rehearsal.md)
- [docs/recovery-cadence-policy.md](recovery-cadence-policy.md)

## 适用范围

- 当前机器已经启动本地服务
- 当前本地参考层只绑定一个 resident agent
- 恢复目标仍然是“同一台机器恢复”或“受控迁移到另一台机器”
- 自动恢复 / 续跑只是在正式恢复基线之上提供有限接力，不替代正式备份恢复
- 判断顺序固定为：先保护密钥与账本，再导出恢复包，再跑恢复演练，最后导出初始化包

## 进入 SOP 之前先确认

先看这 5 个位置：

- `/` 的“公开健康度”：确认服务活着，默认绑定仍是本机 loopback
- `/operator`：确认当前是谁拍板、先做什么、跨机器恢复现在是 blocked 还是 ready_for_rehearsal
- `/` 的“正式恢复周期”：确认 `operationalCadence.status`、`actionSummary` 和 `rerunTriggers`
- `/` 的“自动恢复边界”：确认自动恢复没有把自己冒充成正式恢复完成
- `/api/security` 与 `/api/device/setup`：以字段真值确认 `securityPosture.mode`、`formalRecoveryFlow.runbook.nextStepLabel`、`formalRecoveryFlow.durableRestoreReady`、`formalRecoveryFlow.crossDeviceRecoveryClosure.readyForRehearsal`

也可以直接查接口：

```bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:4319/api/device/setup
curl -H "Authorization: Bearer <token>" http://127.0.0.1:4319/api/security
```

## 主线步骤

### 1. 保护本地账本与签名密钥

目标：

- `storeEncryption.status=protected`
- `signingKey.status=ready`
- 如果当前机器支持系统保护层，并且策略要求使用，则 `systemProtected=true`

执行方式：

- 先查 `GET /api/security` 与 `GET /api/device/setup`
- 如果策略要求系统保护，而且 `/api/security` 仍显示 `storeKey.source` 或 `signingKey.source` 不是 `keychain`，再用 `POST /api/security/keychain-migration` 先 dry-run，再决定是否真的迁入系统保护层
- 如果 `/api/security` 已显示两者都在 `keychain`，直接把这一步视为已达标，不需要重复跑迁移入口
- `/` 只负责显示当前态势，不负责直接执行这一步

完成判定：

- `formalRecoveryFlow.runbook.steps[protect_local_store].completed=true`
- `formalRecoveryFlow.runbook` 不再提示 `store_key_*` 或 `signing_key_*`

### 2. 导出恢复包

目标：

- 至少保留一份恢复包
- 最新恢复包尽量包含 ledger envelope
- 恢复包口令独立保存，不与管理令牌混放

执行方式：

- 用 `POST /api/device/runtime/recovery` 导出恢复包
- 推荐 `includeLedgerEnvelope=true`
- 推荐备注里写机器名、日期、操作人

完成判定：

- `formalRecoveryFlow.backupBundle.total > 0`
- `formalRecoveryFlow.runbook.steps[export_recovery_bundle].completed=true`

建议：

- 导出后立刻记录保存位置
- 如果换了 store key 或 signing key，重新导出一份新恢复包

### 3. 执行恢复演练

目标：

- 验证恢复包能真实打开
- 验证恢复结果能通过本地检查
- 如果策略要求 recent rehearsal，要保证最新演练仍在窗口内

执行方式：

- 用 `POST /api/device/runtime/recovery/verify` 执行恢复演练
- 优先用最近一份恢复包和正式口令跑一次完整演练

完成判定：

- `formalRecoveryFlow.rehearsal.status=fresh`，或在非强制策略下至少有一条通过记录
- `formalRecoveryFlow.runbook.steps[run_recovery_rehearsal].completed=true`

建议：

- 每次恢复包轮换后都重跑一次
- 把演练时间纳入固定周期

### 4. 导出初始化包

目标：

- 让目标机器能快速拿到最小运行配置
- 保留 resident agent、did method、最近恢复证据的可用入口

执行方式：

- 用 `POST /api/device/setup/package` 导出初始化包
- 建议在恢复包导出且演练通过之后立刻导一次

完成判定：

- `formalRecoveryFlow.setupPackage.total > 0`
- `formalRecoveryFlow.runbook.steps[export_setup_package].completed=true`

建议：

- 初始化包和恢复包分开存放
- 初始化包更新时保留最近一次可用版本

## 完成标准

当下面条件同时成立时，可以认为“正式恢复基线达标”：

- `formalRecoveryFlow.durableRestoreReady=true`
- `formalRecoveryFlow.status=ready`
- `formalRecoveryFlow.runbook.status=ready`
- `/api/security` 里的 `automaticRecovery.operatorBoundary.formalFlowReady=true`

## 发生异常时怎么处理

### 密钥保护没过

优先回到步骤 1，不要先导出恢复包。

### 恢复包存在但演练过期

保留原包，重跑演练；只有在包本身失效时才重导恢复包。

### 自动恢复能接力，但正式恢复仍有缺口

这说明运行态闭环能继续，但交付级恢复还没达标。继续按 runbook 补齐，不要把自动恢复当成备份完成。

### 自动恢复审计里出现 `loop_detected` / `gated` / `failed`

先看 `/` 的“自动恢复边界”和 runner history 里的闭环审计 timeline，再决定是否重试 runner。

## 建议节奏

- 初次部署：完整跑一遍 1 -> 2 -> 3 -> 4
- 策略变更后：至少重跑 2 -> 3 -> 4
- 本地密钥轮换后：重跑 1 -> 2 -> 3 -> 4
- 周期性检查：至少确认最近一次恢复演练仍在策略窗口内
