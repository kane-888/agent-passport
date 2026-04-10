# Merge Prep Checklist

这份清单只回答 3 个问题：

1. 这次合并到底收了什么
2. 合并前必须再看哪些面
3. 合并后还要记住什么边界

## 这次合并的 4 段叙事

按当前 PR 叙事，主线就是这 4 个提交：

1. `971a793` `Retire dashboard home and realign memory language`
2. `4bba2f8` `Add recovery cadence and automation boundaries`
3. `bcc1f3a` `Improve memory-chain proposition cues`
4. `6690fc0` `Add operator handbook and cross-device recovery drill`

合并时不要把它讲成“零散 UI 修补”。这次真正收口的是：

- `/` 不再承载旧 dashboard，只保留公开运行态
- 本地存储加密、正式恢复 runbook、恢复周期、自动恢复边界已经连成同一套口径
- 受限执行、operator handbook、跨机器恢复演练开始形成可值班的安全主线
- 记忆语言与 proposition 归一化不再继续拖着旧 recruitment 语义

## 合并前必看

### 1. Fresh smoke

- 用 fresh boot 跑 `npm run smoke:all`
- 确认 browser smoke 不会再把首页占位文案当成功
- 如果你是在复用已经跑了很久的本地服务上验，结论只算参考，不算 merge gate

### 2. 公开运行态

- 打开 `/`
- 只应该看到 4 张卡：公开健康度、正式恢复周期、自动恢复边界、可用入口
- `runtime-home-summary` 应进入“公开运行态已加载”成功态
- 不应该再出现旧 dashboard 的主视角、证据区、状态列表面板

### 3. 恢复与安全真值

- 看 `GET /api/security`
- 确认能同时读到 `securityPosture`、`localStorageFormalFlow`、`constrainedExecution`、`automaticRecovery`
- 看 `GET /api/device/setup`
- 确认 `formalRecoveryFlow.runbook`、`formalRecoveryFlow.operationalCadence`、`setupPackages` 返回一致
- 看 `/lab.html`
- 确认 runtime housekeeping 仍然只做 read session 撤销与旧恢复包/初始化包清理，不冒充正式恢复

### 4. 深操作入口

- `/offline-chat` 继续承载离线协作与记忆主链
- `/repair-hub` 继续承载 repair / credential / status list 深钻
- `/lab.html` 继续承载高级维护入口

## 合并后仍要记住的边界

- 自动恢复 / 续跑只是运行态接力，不是备份完成
- runtime housekeeping 只是减旧，不会生成新的恢复包、恢复演练或初始化包
- `/` 现在是公开运行态，不是可无限加功能的总控台
- 真正的 release gate 仍然是 fresh smoke 和受保护接口真值，不是“页面大概能打开”
