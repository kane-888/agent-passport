# agent-passport Alpha 产品验收清单

这份清单只验收 Alpha 产品体验，不替代 `go-live`、`smoke`、部署验证或公安/ICP备案流程。

## 入口

- 首页首屏只展示两个主入口：`创建 Passport`、`登录 / 恢复 Passport`。
- `创建 Passport` 指向 `/operator?flow=create-passport`。
- `登录 / 恢复 Passport` 指向 `/operator?flow=login-passport`。
- 换机、崩溃、异常恢复统一归入登录/恢复入口，不再作为首页第三入口。

## 创建 Passport

- 能说明创建动作会生成本地 agent 身份。
- 能说明创建后必须建立恢复基线。
- 创建流程不得绕过管理令牌、存储密钥、签名主密钥和恢复口令的设置。
- 创建完成后能从 `/api/health`、`/api/security` 或 `/operator` 读到当前运行态真值。

## 登录 / 恢复 Passport

- 能说明登录/恢复动作是确认连续身份，而不是创建新身份。
- 能从长期偏好、记忆链、恢复包或 setup package 恢复上下文。
- 崩溃、换机、密钥轮换后能明确提示下一步：导入恢复材料、重跑恢复演练、再判断是否放开执行。
- 如果恢复材料不足，必须保守提示，不得把自动恢复写成正式恢复完成。

## 值班与异常

- `/operator` 能显示当前先做什么、谁拍板、哪些边界还未恢复。
- `/api/security` 中 `securityPosture`、`formalRecoveryFlow`、`automaticRecovery`、`constrainedExecution` 的结论和 `/operator` 一致。
- 事故交接包能导出或定位。
- 运行态异常时先保全日志、备份、恢复包和审计证据。

## 公开合规与法律入口

- 首页页脚展示 `隐私政策`、`用户协议`、`联系方式`。
- `.cn` 公网部署必须配置真实 `AGENT_PASSPORT_ICP_RECORD_NUMBER`。
- 公安联网备案号通过审核后，再配置 `AGENT_PASSPORT_PUBLIC_SECURITY_RECORD_NUMBER` 并展示。
- 隐私政策说明本地身份、长期偏好、恢复材料和审计信息如何处理。
- 用户协议说明 Alpha 阶段限制和不得绕过安全/恢复门禁。

## 架构口径

- `记忆稳态引擎` 负责模型底座、本地推理、记忆压缩和稳态维持。
- `agent-passport` 负责连续身份、长期偏好、恢复、长期记忆和审计。
- `openneed` 是 app 层，不能被写成底层模型 runtime、本地推理引擎或连续身份本体。

## 最小验收命令

```bash
npm run test:smoke:guards
npm run smoke:all:ci
npm run test:verify:deploy:http
```

具备 Safari DOM automation 的验收机再补：

```bash
npm run smoke:browser
AGENT_PASSPORT_DEPLOY_BASE_URL=https://agent-passport.cn npm run verify:go-live
```
