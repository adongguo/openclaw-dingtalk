# DingTalk 插件能力增强 — 实施计划

基于 OpenClaw Plugin API 能力分析报告，分5个阶段实现。

---

## Phase 1: Actions 适配器（最高优先级）

**目标**: 实现 `actions` 适配器，让系统内置 `message` 工具能原生路由到 DingTalk。

**新文件**: `src/actions.ts`

**需实现的 actions**:
1. `send` — 发送消息到指定用户/群（复用 openapi-send.ts）
2. `broadcast` — 群发消息
3. `sendAttachment` — 发送文件/附件
4. `member-info` — 查询群成员信息（复用 group-members.ts）
5. `react` — 预留 stub（DingTalk 暂不支持）
6. `read` — 获取消息历史（预留 stub）

**修改文件**: `src/channel.ts` — 添加 `actions` 适配器到 `dingtalkPlugin`

**实现细节**:
- `handleAction(action, params, ctx)` 主分发函数
- send/broadcast 调用现有 `sendTextViaOpenAPI` / `sendMarkdownViaOpenAPI`
- sendAttachment 调用现有 `media.ts` 的上传能力 + openapi-send
- 参考 OpenClaw 源码中其他插件（如 telegram/discord）的 actions 实现

---

## Phase 2: Mentions 适配器

**目标**: 正确清理 DingTalk @机器人 标记，避免 agent 看到多余文本。

**修改文件**: `src/channel.ts`

**需实现**:
1. `mentions.stripPatterns` — 返回正则数组，匹配 DingTalk 的 @机器人 格式
2. `mentions.stripMentions(text, botName)` — 清理 @XXX 文本
3. `mentions.extractMentions(message)` — 提取被 @ 的用户列表

**实现细节**:
- DingTalk @格式: 消息体中含 `@机器人名` 文本 + atUsers 字段
- 需要清理: `@机器人名\u2005` (DingTalk 用特殊空格分隔)
- 参考现有 streaming-handler.ts 中已有的部分清理逻辑

---

## Phase 3: 生命周期钩子

**目标**: 注册关键生命周期钩子，增强可观测性和扩展性。

**新文件**: `src/hooks.ts`

**需注册的钩子**:
1. `message_received` — 消息计数、日志记录
2. `message_sending` — 发送前格式转换（如自动 markdown→actionCard）
3. `gateway_start` / `gateway_stop` — DingTalk stream 连接管理日志

**修改文件**: `src/bot.ts` 或入口文件 — 在插件初始化时调用 `api.on()` 注册钩子

**实现细节**:
- message_received: 记录来源(DM/群)、用户ID、消息类型统计
- message_sending: 可以在这里做 markdown 渲染优化
- 钩子应该是轻量级的，不阻塞主流程

---

## Phase 4: Heartbeat 适配器

**目标**: 实现连接健康检查，提升运维可靠性。

**修改文件**: `src/channel.ts`

**需实现**:
1. `heartbeat.checkReady(accountId)` — 检查 DingTalk stream 连接是否存活
2. `heartbeat.resolveRecipients(cfg)` — 返回心跳消息的发送目标

**实现细节**:
- checkReady: 检查 monitor.ts 中的连接状态（lastMessageTime, isConnected）
- resolveRecipients: 从 config 中读取 owner/allowFrom 作为心跳接收者
- 参考现有 probe.ts 的健康检查逻辑

---

## Phase 5: 辅助能力

**目标**: 补充其他中低优先级能力。

### 5a. Resolver 适配器
**修改文件**: `src/channel.ts`
- `resolver.resolveTargets(targets)` — 解析用户名/群名到 DingTalk ID
- 复用 directory.ts 的查询能力

### 5b. registerHttpRoute
**新文件**: `src/http-routes.ts`
- 注册 `/dingtalk/callback` 路由，接收 DingTalk 事件订阅回调
- 可扩展支持: 审批事件、考勤事件等

### 5c. registerService
**新文件**: `src/services.ts`
- 注册后台服务: 定期清理过期 session webhook
- 定期刷新 access token（当前按需刷新，可改为预刷新）

### 5d. registerCli
**新文件**: `src/cli.ts`
- 注册 `openclaw dingtalk status` — 查看连接状态
- 注册 `openclaw dingtalk send <target> <message>` — CLI 发送消息
- 注册 `openclaw dingtalk groups` — 列出已知群组

---

## 实施顺序和依赖

```
Phase 1 (actions)     ← 独立，最高优先级
    ↓
Phase 2 (mentions)    ← 独立，可与 Phase 1 并行
    ↓
Phase 3 (hooks)       ← 依赖 Phase 1 完成（message_sending 钩子需要了解 actions 流程）
    ↓
Phase 4 (heartbeat)   ← 独立
    ↓
Phase 5 (辅助)        ← 可按需实施
```

## 注意事项

1. **保持向后兼容**: 现有的 agent-tools.ts（dingtalk_send_card 等）继续保留
2. **参考 OpenClaw 源码**: `/root/.openclaw/workspace/openclaw` 中有完整的插件接口定义和其他插件示例
3. **DingTalk API 限制**: 部分能力受钉钉 API 限制（如 bot 不能编辑消息、不能添加 reaction）
4. **测试**: 每个 Phase 完成后需要验证——通过 `message` 工具测试 actions，通过群消息测试 mentions
5. **代码规范**: 遵循现有代码风格（TypeScript, ESM, 函数式为主）
6. **文件大小**: 保持每个文件 <500 LOC，复杂逻辑拆分
