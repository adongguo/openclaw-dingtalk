# openclaw-dingtalk

DingTalk (钉钉) channel plugin for [OpenClaw](https://github.com/openclaw/openclaw).

[English](#english) | [中文](#中文)

---

## English

### Installation

```bash
openclaw plugins install @adongguo/dingtalk
```

> **Note:** `npm install @adongguo/dingtalk` alone is **not enough** — OpenClaw does not auto-discover plugins from `node_modules`. You must use `openclaw plugins install` as shown above, or manually add the plugin path to your config:
>
> ```yaml
> plugins:
>   load:
>     paths:
>       - "./node_modules/@adongguo/dingtalk"
> ```

### Configuration

1. Create an enterprise internal application on [DingTalk Open Platform](https://open-dev.dingtalk.com)
2. Get your AppKey (ClientID) and AppSecret (ClientSecret) from the Credentials page
3. Enable Robot capability and select **Stream mode**
4. Configure event subscriptions (see below)
5. Configure the plugin:

#### Required Steps

1. **Create Application**: Go to DingTalk Developer Console → Application Development → Enterprise Internal Development → Create Application

2. **Enable Robot**: In your application, go to Application Capabilities → Robot → Enable Robot Configuration → Select **Stream mode**

3. **Get Credentials**: Go to Basic Information → Application Information to get AppKey and AppSecret

4. **Publish Application**: Publish the app (at least to test version) to make the bot available

```bash
openclaw config set channels.dingtalk.appKey "dingXXXXXXXX"
openclaw config set channels.dingtalk.appSecret "your_app_secret"
openclaw config set channels.dingtalk.enabled true
```

### Configuration Options

```yaml
channels:
  dingtalk:
    enabled: true
    appKey: "dingXXXXXXXX"
    appSecret: "secret"
    # Robot code (optional, for media download)
    robotCode: "dingXXXXXXXX"
    # Connection mode: "stream" (recommended) or "webhook"
    connectionMode: "stream"
    # DM policy: "pairing" | "open" | "allowlist"
    dmPolicy: "pairing"
    # Group policy: "open" | "allowlist" | "disabled"
    groupPolicy: "allowlist"
    # Group session scope: "per-group" | "per-user"
    groupSessionScope: "per-group"
    # Max media size in MB (default: 30)
    mediaMaxMb: 30
    # Render mode for bot replies: "auto" | "raw" | "card"
    renderMode: "auto"
    # AI Card streaming mode: "enabled" | "disabled"
    aiCardMode: "enabled"
    # Show thinking indicator before response
    showThinking: true
    # Session timeout in ms (default: 30 minutes)
    sessionTimeout: 1800000
    # Enable local image auto-upload in agent responses
    enableMediaUpload: true
    # Custom system prompt for the agent
    systemPrompt: "You are a helpful assistant."
    # Gateway integration (required for AI Card streaming)
    gatewayToken: "your_gateway_token"
    gatewayPort: 18789
    # Custom slash commands
    commands:
      faq:
        description: "Show FAQ"
        action: "reply"
        response: "Visit https://example.com/faq for help."
      expert:
        description: "Switch to expert mode"
        action: "system-prompt"
        systemPrompt: "You are a domain expert..."
        response: "Switched to expert mode."
    # Customize standard message text
    templates:
      thinking:
        text: "Processing..."
        enabled: true
      error:
        text: "Sorry, an error occurred: {message}"
      welcome:
        enabled: true
        title: "My AI Bot"
    # Per-DM configuration
    dms:
      "staffId123":
        systemPrompt: "Personalized prompt for this user."
    # Per-group configuration
    groups:
      "chatId456":
        systemPrompt: "Group-specific instructions."
        skills:
          - "data-analysis"
          - "code-review"
        allowFrom:
          - "*"
    # Multi-account support
    accounts:
      sales-bot:
        appKey: "dingSALES"
        appSecret: "sales_secret"
        robotCode: "salesBot"
        systemPrompt: "You are the sales assistant."
```

#### Render Mode

| Mode | Description |
|------|-------------|
| `auto` | (Default) Automatically detect: use ActionCard for messages with code blocks, tables, or images; plain text otherwise. |
| `raw` | Always send replies as plain text. Markdown tables are converted to ASCII. |
| `card` | Always send replies as ActionCard with full markdown rendering. |

#### Access Control Policies

| Option | Values | Description |
|--------|--------|-------------|
| `dmPolicy` | `pairing` / `open` / `allowlist` | Controls who can DM the bot. `pairing` requires approval flow; `open` requires `allowFrom` with `*`; `allowlist` checks `allowFrom` list. |
| `groupPolicy` | `open` / `allowlist` / `disabled` | Controls group access. `allowlist` checks `groupAllowFrom`. |
| `groupSessionScope` | `per-group` / `per-user` | Session isolation in groups. `per-group` shares one session; `per-user` gives each member their own session. |

#### Session Isolation

| Chat Type | Scope | Session Key Pattern |
|-----------|-------|---------------------|
| DM | Per user | `dingtalk:<senderId>` |
| Group (per-group) | Shared per group | `dingtalk:<conversationId>` |
| Group (per-user) | Per user in group | `dingtalk:<conversationId>:<senderId>` |

Sessions expire after `sessionTimeout` (default 30 minutes). Expired sessions are automatically cleaned up every 5 minutes.

### Features

#### Messaging
- Stream mode connection (WebSocket-based, auto-reconnect with exponential backoff)
- Direct messages and group chats with configurable policies
- Text, Markdown, ActionCard, and Link message types
- Smart render mode auto-detection (code blocks, tables, images)
- Message chunking for long responses (configurable limit, default 4000 chars)
- Message deduplication (5-minute TTL window)

#### AI Card Streaming
- Real-time streaming responses via AI Card with typewriter effect
- Gateway SSE integration for inference streaming
- Automatic fallback to regular message if card creation fails
- Card lifecycle management (Processing → Inputting → Finished/Failed)

#### Media Handling
- Inbound image download and forwarding to agent (with vision support)
- RichText message parsing (mixed text + images)
- Agent response auto-upload: local image paths in markdown are automatically uploaded
- File marker syntax for sending file cards: `[DINGTALK_FILE]{"path": "...", "name": "..."}[/DINGTALK_FILE]`
- Inline image rendering via ActionCard

#### Commands
- Built-in commands: `/help`, `/status`, `/whoami`
- Session commands: `/new`, `/reset`, `/clear`, `新会话`, `重新开始`, `清空对话`
- User-defined commands via config with three action types:
  - `reply` — Send a static response
  - `system-prompt` — Override the agent system prompt
  - `new-session` — Reset the conversation session

#### Message Templates
- Configurable message text for thinking indicator, error messages, welcome, access denied, new session, etc.
- Variable substitution: `{senderId}`, `{senderName}`, `{message}`
- Enable/disable individual templates

#### Context Enhancements
- DingTalk metadata injected into agent context (chat type, sender info, admin status, @mention status)
- Per-DM system prompts (`dms.<staffId>.systemPrompt`)
- Per-group system prompts (`groups.<chatId>.systemPrompt`)
- Per-group skill injection (`groups.<chatId>.skills`)
- Custom global system prompt

#### Multi-Account Support
- Multiple DingTalk bots from a single plugin instance
- Per-account credential overrides (appKey, appSecret, robotCode)
- Per-account config overrides (systemPrompt, policies, etc.)
- Independent stream connections per account

#### OpenClaw SDK Integration
- CLI commands: `dingtalk-status`, `dingtalk-sessions`, `dingtalk-whoami`
- Agent tools: `dingtalk_send_card` (send ActionCard), `dingtalk_list_group_members` (list tracked members)
- Shipped skills for agent knowledge (messaging, cards, media best practices)

#### Connection Resilience
- Health check every 10 seconds
- Exponential backoff reconnect (2s → 120s)
- Soft reconnect (2 attempts) before hard reconnect
- Reconnect counter capped to prevent unbounded growth
- Credential masking in logs

#### Other
- Pairing flow for DM approval
- User and group directory lookup (config-based)
- Interactive onboarding wizard
- Bot health probe (`probeDingTalk`)
- Passive group member tracking from message flow

### Limitations

- **No message editing**: DingTalk doesn't support editing messages via sessionWebhook
- **No reactions**: Bot API doesn't support message reactions
- **No typing indicator**: DingTalk has no native typing indicator API
- **sessionWebhook expiration**: Reply URLs are temporary and expire
- **Group @mention required**: In group chats, messages must @mention the bot to be received — this is a DingTalk platform limitation and cannot be changed via configuration

### FAQ

#### Bot cannot receive messages

Check the following:
1. Is Robot capability enabled in your application?
2. Is **Stream mode** selected (not HTTP mode)?
3. Is the application published?
4. Are the appKey and appSecret correct?

#### Failed to send messages

1. Check if sessionWebhook has expired
2. Verify message format is correct
3. Ensure bot has necessary permissions

#### How to clear history / start new conversation

Send one of these commands in the chat: `/new`, `/reset`, `/clear`, `新会话`, `重新开始`, or `清空对话`.

#### How to add custom commands

Add commands to your config under `channels.dingtalk.commands`:

```yaml
channels:
  dingtalk:
    commands:
      faq:
        description: "Show FAQ"
        action: "reply"
        response: "Visit our FAQ page."
      coder:
        description: "Switch to coding mode"
        action: "system-prompt"
        systemPrompt: "You are a senior software engineer."
        response: "Switched to coding mode."
```

#### Why is the output not streaming

AI Card streaming requires both `aiCardMode: "enabled"` and a configured Gateway (`gatewayToken`). Without these, the bot uses complete-then-send approach. DingTalk API has rate limits, so streaming updates are throttled.

#### Cannot find the bot in DingTalk

1. Ensure the app is published (at least to test version)
2. Search for the bot name in DingTalk search box
3. Check if your account is in the app's availability scope

---

## 中文

### 安装

```bash
openclaw plugins install @adongguo/dingtalk
```

> **注意：** 仅 `npm install @adongguo/dingtalk` 是**不够的** — OpenClaw 不会自动从 `node_modules` 发现插件。请使用上面的 `openclaw plugins install` 命令，或在配置文件中手动添加插件路径：
>
> ```yaml
> plugins:
>   load:
>     paths:
>       - "./node_modules/@adongguo/dingtalk"
> ```

### 配置

1. 在 [钉钉开放平台](https://open-dev.dingtalk.com) 创建企业内部应用
2. 在凭证页面获取 AppKey (ClientID) 和 AppSecret (ClientSecret)
3. 开启机器人能力并选择 **Stream 模式**
4. 配置事件订阅（见下方）
5. 配置插件：

#### 必需步骤

1. **创建应用**：进入钉钉开发者后台 → 应用开发 → 企业内部开发 → 创建应用

2. **开启机器人**：在应用页面，进入 应用功能 → 机器人 → 开启机器人配置 → 选择 **Stream 模式**

3. **获取凭证**：进入 基础信息 → 应用信息，获取 AppKey 和 AppSecret

4. **发布应用**：发布应用（至少发布到测试版本）使机器人可用

```bash
openclaw config set channels.dingtalk.appKey "dingXXXXXXXX"
openclaw config set channels.dingtalk.appSecret "your_app_secret"
openclaw config set channels.dingtalk.enabled true
```

### 配置选项

```yaml
channels:
  dingtalk:
    enabled: true
    appKey: "dingXXXXXXXX"
    appSecret: "secret"
    # 机器人 code（可选，用于媒体下载）
    robotCode: "dingXXXXXXXX"
    # 连接模式: "stream" (推荐) 或 "webhook"
    connectionMode: "stream"
    # 私聊策略: "pairing" | "open" | "allowlist"
    dmPolicy: "pairing"
    # 群聊策略: "open" | "allowlist" | "disabled"
    groupPolicy: "allowlist"
    # 群聊会话范围: "per-group" | "per-user"
    groupSessionScope: "per-group"
    # 媒体文件最大大小 (MB, 默认 30)
    mediaMaxMb: 30
    # 回复渲染模式: "auto" | "raw" | "card"
    renderMode: "auto"
    # AI Card 流式模式: "enabled" | "disabled"
    aiCardMode: "enabled"
    # 显示思考中指示器
    showThinking: true
    # 会话超时时间 (毫秒, 默认 30 分钟)
    sessionTimeout: 1800000
    # 启用本地图片自动上传
    enableMediaUpload: true
    # 自定义系统提示词
    systemPrompt: "你是一个有用的助手。"
    # Gateway 集成 (AI Card 流式所需)
    gatewayToken: "your_gateway_token"
    gatewayPort: 18789
    # 自定义斜杠命令
    commands:
      faq:
        description: "显示常见问题"
        action: "reply"
        response: "请访问 https://example.com/faq"
      expert:
        description: "切换到专家模式"
        action: "system-prompt"
        systemPrompt: "你是一个领域专家..."
        response: "已切换到专家模式。"
    # 自定义消息文本
    templates:
      thinking:
        text: "处理中..."
        enabled: true
      error:
        text: "抱歉，发生了错误: {message}"
      welcome:
        enabled: true
        title: "我的 AI 机器人"
    # 私聊配置
    dms:
      "staffId123":
        systemPrompt: "为该用户定制的提示词。"
    # 群聊配置
    groups:
      "chatId456":
        systemPrompt: "群组专用指令。"
        skills:
          - "数据分析"
          - "代码审查"
        allowFrom:
          - "*"
    # 多账号支持
    accounts:
      sales-bot:
        appKey: "dingSALES"
        appSecret: "sales_secret"
        robotCode: "salesBot"
        systemPrompt: "你是销售助理。"
```

#### 渲染模式

| 模式 | 说明 |
|------|------|
| `auto` | （默认）自动检测：有代码块、表格或图片时用 ActionCard，否则纯文本 |
| `raw` | 始终纯文本，表格转为 ASCII |
| `card` | 始终使用 ActionCard，支持完整 Markdown 渲染 |

#### 访问控制策略

| 选项 | 值 | 说明 |
|------|-----|------|
| `dmPolicy` | `pairing` / `open` / `allowlist` | 控制谁可以私聊机器人。`pairing` 需要审批；`open` 需要 `allowFrom` 包含 `*`；`allowlist` 检查 `allowFrom` 列表。 |
| `groupPolicy` | `open` / `allowlist` / `disabled` | 控制群组访问。`allowlist` 检查 `groupAllowFrom`。 |
| `groupSessionScope` | `per-group` / `per-user` | 群聊会话隔离。`per-group` 共享会话；`per-user` 每人独立会话。 |

#### 会话隔离

| 聊天类型 | 范围 | 会话 Key 格式 |
|---------|------|--------------|
| 私聊 | 按用户 | `dingtalk:<senderId>` |
| 群聊 (per-group) | 按群共享 | `dingtalk:<conversationId>` |
| 群聊 (per-user) | 按群内用户 | `dingtalk:<conversationId>:<senderId>` |

会话在 `sessionTimeout`（默认 30 分钟）后过期，每 5 分钟自动清理过期会话。

### 功能

#### 消息
- Stream 模式连接（基于 WebSocket，指数退避自动重连）
- 私聊和群聊（可配置策略）
- 支持文本、Markdown、ActionCard、链接消息类型
- 智能渲染模式自动检测（代码块、表格、图片）
- 长消息分段发送（可配置限制，默认 4000 字符）
- 消息去重（5 分钟 TTL 窗口）

#### AI Card 流式
- 通过 AI Card 实时流式响应（打字机效果）
- Gateway SSE 集成推理流式传输
- Card 创建失败时自动降级为普通消息
- Card 生命周期管理（处理中 → 输入中 → 完成/失败）

#### 媒体处理
- 接收图片下载并转发给 Agent（支持视觉理解）
- 富文本消息解析（混合文本 + 图片）
- Agent 响应自动上传：Markdown 中的本地图片路径自动上传
- 文件标记语法发送文件卡片：`[DINGTALK_FILE]{"path": "...", "name": "..."}[/DINGTALK_FILE]`
- 通过 ActionCard 内联图片渲染

#### 命令系统
- 内置命令：`/help`、`/status`、`/whoami`
- 会话命令：`/new`、`/reset`、`/clear`、`新会话`、`重新开始`、`清空对话`
- 通过配置定义自定义命令，支持三种动作类型：
  - `reply` — 发送静态回复
  - `system-prompt` — 覆盖 Agent 系统提示词
  - `new-session` — 重置对话会话

#### 消息模板
- 可配置思考指示器、错误消息、欢迎语、访问拒绝、新会话等消息文本
- 变量替换：`{senderId}`、`{senderName}`、`{message}`
- 可启用/禁用单个模板

#### 上下文增强
- 钉钉元数据注入 Agent 上下文（聊天类型、发送者信息、管理员状态、@提及状态）
- 按用户私聊提示词（`dms.<staffId>.systemPrompt`）
- 按群组提示词（`groups.<chatId>.systemPrompt`）
- 按群组技能注入（`groups.<chatId>.skills`）
- 自定义全局系统提示词

#### 多账号支持
- 单插件实例管理多个钉钉机器人
- 按账号凭证覆盖（appKey、appSecret、robotCode）
- 按账号配置覆盖（systemPrompt、策略等）
- 每个账号独立 Stream 连接

#### OpenClaw SDK 集成
- CLI 命令：`dingtalk-status`、`dingtalk-sessions`、`dingtalk-whoami`
- Agent 工具：`dingtalk_send_card`（发送 ActionCard）、`dingtalk_list_group_members`（列出已知群成员）
- 内置 Skills 提供 Agent 知识（消息、卡片、媒体最佳实践）

#### 连接韧性
- 每 10 秒健康检查
- 指数退避重连（2 秒 → 120 秒）
- 软重连（2 次尝试）后硬重连
- 重连计数器封顶防止无限增长
- 日志中凭证脱敏

#### 其他
- 私聊配对审批流程
- 用户和群组目录查询（基于配置）
- 交互式引导设置向导
- 机器人健康探针（`probeDingTalk`）
- 从消息流中被动追踪群成员

### 限制

- **不支持消息编辑**：钉钉不支持通过 sessionWebhook 编辑消息
- **不支持表情回复**：机器人 API 不支持消息表情回复
- **不支持输入中指示器**：钉钉没有原生输入中 API
- **sessionWebhook 过期**：回复 URL 是临时的，会过期
- **群聊必须 @机器人**：群聊消息必须 @机器人才能被机器人接收，这是钉钉平台限制，无法通过配置更改

### 常见问题

#### 机器人收不到消息

检查以下配置：
1. 是否在应用中开启了机器人能力？
2. 是否选择了 **Stream 模式**（而非 HTTP 模式）？
3. 应用是否已发布？
4. appKey 和 appSecret 是否正确？

#### 发送消息失败

1. 检查 sessionWebhook 是否已过期
2. 验证消息格式是否正确
3. 确保机器人有必要的权限

#### 如何清理历史会话 / 开启新对话

在聊天中发送以下任一命令：`/new`、`/reset`、`/clear`、`新会话`、`重新开始` 或 `清空对话`。

#### 如何添加自定义命令

在配置的 `channels.dingtalk.commands` 下添加命令：

```yaml
channels:
  dingtalk:
    commands:
      faq:
        description: "显示常见问题"
        action: "reply"
        response: "请访问我们的 FAQ 页面。"
      coder:
        description: "切换到编程模式"
        action: "system-prompt"
        systemPrompt: "你是一名资深软件工程师。"
        response: "已切换到编程模式。"
```

#### 消息为什么不是流式输出

AI Card 流式需要同时配置 `aiCardMode: "enabled"` 和 Gateway（`gatewayToken`）。未配置时采用完整回复后一次性发送。钉钉 API 有请求频率限制，流式更新会被节流处理。

#### 在钉钉里找不到机器人

1. 确保应用已发布（至少发布到测试版本）
2. 在钉钉搜索框中搜索机器人名称
3. 检查应用可用范围是否包含你的账号

---

## License

MIT
