# Merge Prep Checklist

这份清单只回答 3 个问题：

1. 这次合并到底收了什么
2. 合并前必须再看哪些面
3. 合并后还要记住什么边界

## 这次合并的 4 段主线

不要按提交数讲，按问题本质讲。这次 PR 的主线只有 4 段：

1. `/` 收口成只回答运行态真值的公开入口，不再承载旧混合控制台。
2. 正式恢复周期、自动恢复边界、受限执行和 operator 手册对齐成同一套运行规则。
3. proposition / 记忆语言从旧 recruitment 语义收回到 runtime 语义，同时保留旧账本可读兼容。
4. browser smoke 和首页加载链一起变成真实 gate，不再把占位文案或瞬时读取失败误判成通过。

最后还有一笔 housekeeping：

- 删掉已经不再代表真实运行规则的旧 demo、旧材料、旧导出脚本
- 旧 `agent-passport` 只保留在协议、存储格式和兼容入口这些必须保留的层

## 合并话术

这次不是再做一个首页，而是把 `/` 收口成只回答运行态真值的公开入口。

正式恢复周期、自动恢复边界、受限执行和 operator 手册现在已经对齐成同一套运行规则。

旧 proposition / discourse 数据仍然可读，但对外叙事已经统一回到 memory / context 这套 runtime 语言。

browser smoke 现在会拦真实首页失败，也不会把瞬时读取波动误判成最终失败。

## 合并前必看

### 1. Fresh smoke

- 用 fresh boot 跑 `npm run smoke:all`
- 确认 browser smoke 不会再把首页占位文案当成功
- 如果你是在复用已经跑了很久的本地服务上验，结论只算参考，不算 merge gate

### 2. 公开运行态

- 打开 `/`
- 只应该看到 4 张卡：公开健康度、正式恢复周期、自动恢复边界、可用入口
- `runtime-home-summary` 应进入“公开运行态已加载”成功态
- 不应该再出现旧混合控制台的主视角、证据区、状态列表面板

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
