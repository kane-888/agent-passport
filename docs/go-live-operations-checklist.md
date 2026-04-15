# agent-passport 上线前收口与值班放行清单

这份清单只回答 4 个问题：

1. 现在能不能部署或继续放量
2. 部署后靠什么看运行态是否还是真的
3. 什么时候必须暂停、回滚或切到更保守姿态
4. 谁拍板、谁执行、谁修

不要从惯例判断。只看当前运行态真值。

## 只看这 6 个真值入口

上线前和上线后，只看这 6 个位置：

1. `GET /api/health`
2. `GET /api/security`
3. `GET /api/device/setup`
4. `/`
5. `/operator`
6. smoke / deploy 验证结果

如果这 6 个位置给出的结论不一致，先按更保守的结论执行。

## 最短放行顺序

不要跳步。放行顺序固定如下：

### 1. 先确认服务真的活着

必须同时满足：

- `/api/health.ok=true`
- `/api/health.service=agent-passport`
- 当前绑定地址符合预期

当前本地默认预期是：

- `hostBinding=127.0.0.1` 或 `localhost`

如果这一步没过，后面都不用看。

### 2. 再确认安全姿态没有越界

必须确认：

- `securityPosture.mode=normal`
- 没有需要先锁边界的硬告警

如果当前不是 `normal`：

- 先去 `/operator`
- 先按当前姿态锁边界
- 不讨论继续放量

### 3. 再确认正式恢复不是假完成

必须明确区分两件事：

- “系统还能续跑”
- “正式恢复已经达标”

只有下面条件同时成立，才允许把正式恢复当成上线基线：

- `formalRecoveryFlow.durableRestoreReady=true`
- `formalRecoveryFlow.runbook.status=ready`
- 最近一次恢复演练还在窗口内
- `automaticRecovery.operatorBoundary.formalFlowReady=true`

如果自动恢复还能继续，但上面没全部满足：

- 可以继续内部排查或临时接力
- 不能把它写成“恢复已达标”
- 不能把它当成正式上线放行依据

### 4. 再确认受限执行层没有退化

必须确认：

- `constrainedExecution.status` 不在 `degraded` / `locked`
- `/operator` 没有把执行面列为当前阻塞项

如果受限执行层退化：

- 停真实执行
- 保留读、证据保全和恢复动作
- 不继续放量

### 5. 再确认值班与交接链是完整的

必须确认：

- `/operator` 的 `next action` 和 `/api/security` / `/api/device/setup` 一致
- 当前唯一阻塞原因清楚
- 事故交接包可以导出
- 最近恢复包、恢复演练、初始化包都能定位到

如果值班面说不清“现在谁拍板、先做什么、为什么还不能放行”，就不算准备好上线。

### 6. 最后再看 smoke 和部署验证

本地主产品链至少要过：

- `npm run smoke:dom`
- `npm run smoke:ui`
- `npm run smoke:browser`

如果是公网部署，还要再过：

- `npm run verify:deploy:http`

结论很简单：

- 运行态真值没过，不放行
- smoke 没过，不放行
- 部署验证没过，不放行

## 监控基线

上线后最少要持续盯这 5 类信号：

1. 服务活性
2. 安全姿态
3. 正式恢复窗口
4. 自动恢复闭环
5. 受限执行边界

对应位置：

- `/api/health`：服务是否可达
- `/api/security`：当前姿态、正式恢复、自动恢复边界、受限执行摘要
- `/api/device/setup`：正式恢复 runbook、最近证据、跨机器恢复关口
- `/operator`：当前下一步、硬告警、交接字段是否齐
- runner history / anomaly / incident packet：异常、续跑、证据保全是否可回放

## 三档放行标准

### 1. 继续内部 Alpha

必须满足：

- 服务可达
- 安全姿态可读
- `/`、`/operator`、`/lab.html`、`/repair-hub` 职责没有串位
- `smoke:dom`、`smoke:ui`、`smoke:browser` 通过

这档允许：

- 正式恢复还在补主线
- 自动恢复只是有限接力

这档不允许：

- 对外把系统表述成“正式恢复已达标”

### 2. 私有部署试点

在内部 Alpha 基础上，再加：

- `securityPosture.mode=normal`
- 受限执行层不退化
- operator 能稳定给出当前 next action
- 最近恢复包、恢复演练、初始化包都可定位

这档允许：

- 受控客户试点
- 小范围放量

这档不允许：

- 把跨机器恢复和正式恢复对外讲成完全封顶

### 3. 正式上线 / 对外稳定放行

在私有部署试点基础上，再加：

- `formalRecoveryFlow.durableRestoreReady=true`
- 恢复演练仍在窗口内
- `automaticRecovery.operatorBoundary.formalFlowReady=true`
- 公网部署验证通过
- 当前没有未解释的硬告警

少一条都不要写成“正式上线稳态”。

## 必须暂停或回滚的触发条件

出现下面任一条，先停，再查：

- `/api/health.ok` 不是 `true`
- `securityPosture.mode != normal`
- `formalRecoveryFlow.durableRestoreReady != true`，但业务还想按正式恢复已达标继续放量
- `constrainedExecution.status` 进入 `degraded` / `locked`
- 自动恢复出现 `loop_detected` / `failed` / `human_review_required`
- browser smoke 或 deploy HTTP 验证失败

## 角色分工

### 持有者 / 委托主体

- 决定是否继续业务放量
- 决定是否接受恢复结果
- 决定是否允许恢复后重新放开执行

### 运营者 / 值班操作员

- 看 `/operator` 和运行态真值
- 切安全姿态
- 导出证据
- 执行恢复包 / 演练 / 初始化包流程

### 平台 / 开发维护

- 解释为什么没过
- 修复根因
- 提供回放、迁移、回滚和验证手段

## 一句话收口

上线不是“服务能打开”就算过，而是运行态、恢复基线、执行边界、值班动作和部署验证都指向同一个结论。
