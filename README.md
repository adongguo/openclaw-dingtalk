# openclaw-dingtalk

DingTalk (钉钉) channel plugin for [OpenClaw](https://github.com/openclaw/openclaw).

[English](#english) | [中文](#中文)

---

## English

### Installation

```bash
openclaw plugins install @adongguo/openclaw-dingtalk
```

Or install via npm:

```bash
npm install @adongguo/openclaw-dingtalk
```

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
    # Require @mention in groups
    requireMention: true
    # Max media size in MB (default: 30)
    mediaMaxMb: 30
    # Render mode for bot replies: "auto" | "raw" | "card"
    renderMode: "auto"
    # AI Card streaming mode: "enabled" (default) | "disabled"
    aiCardMode: "enabled"
    # Session timeout in ms (default: 30 minutes)
    sessionTimeout: 1800000
    # Gateway integration (optional)
    gatewayToken: "your_gateway_token"
    gatewayPort: 18789
```

#### Render Mode

| Mode | Description |
|------|-------------|
| `auto` | (Default) Automatically detect: use ActionCard for messages with code blocks or tables, plain text otherwise. |
| `raw` | Always send replies as plain text. Markdown tables are converted to ASCII. |
| `card` | Always send replies as ActionCard with full markdown rendering. |

### Features

- Stream mode connection (WebSocket-based)
- Direct messages and group chats
- Message replies
- Image and file support (via OpenAPI)
- Pairing flow for DM approval
- User and group directory lookup (config-based)
- ActionCard render mode for markdown rendering
- AI Card streaming for real-time typing effect
- Session timeout management with `/new` command
- Gateway SSE integration for streaming responses

### Limitations

- **No message editing**: DingTalk doesn't support editing messages via sessionWebhook
- **No reactions**: Bot API doesn't support message reactions
- **sessionWebhook expiration**: Reply URLs are temporary and expire

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

Send `/new` command in the chat.

#### Why is the output not streaming

DingTalk API has rate limits. Streaming updates can easily trigger throttling. We use complete-then-send approach for stability.

#### Cannot find the bot in DingTalk

1. Ensure the app is published (at least to test version)
2. Search for the bot name in DingTalk search box
3. Check if your account is in the app's availability scope

---

## 中文

### 安装

```bash
openclaw plugins install @adongguo/openclaw-dingtalk
```

或通过 npm 安装：

```bash
npm install @adongguo/openclaw-dingtalk
```

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
    # 群聊是否需要 @机器人
    requireMention: true
    # 媒体文件最大大小 (MB, 默认 30)
    mediaMaxMb: 30
    # 回复渲染模式: "auto" | "raw" | "card"
    renderMode: "auto"
    # AI Card 流式模式: "enabled" (默认) | "disabled"
    aiCardMode: "enabled"
    # 会话超时时间 (毫秒, 默认 30 分钟)
    sessionTimeout: 1800000
    # Gateway 集成 (可选)
    gatewayToken: "your_gateway_token"
    gatewayPort: 18789
```

#### 渲染模式

| 模式 | 说明 |
|------|------|
| `auto` | （默认）自动检测：有代码块或表格时用 ActionCard，否则纯文本 |
| `raw` | 始终纯文本，表格转为 ASCII |
| `card` | 始终使用 ActionCard，支持完整 Markdown 渲染 |

### 功能

- Stream 模式连接（基于 WebSocket）
- 私聊和群聊
- 消息回复
- 图片和文件支持（通过 OpenAPI）
- 私聊配对审批流程
- 用户和群组目录查询（基于配置）
- ActionCard 渲染模式支持 Markdown 渲染
- AI Card 流式响应（打字机效果）
- 会话超时管理（支持 `/new` 命令开启新会话）
- Gateway SSE 流式集成

### 限制

- **不支持消息编辑**：钉钉不支持通过 sessionWebhook 编辑消息
- **不支持表情回复**：机器人 API 不支持消息表情回复
- **sessionWebhook 过期**：回复 URL 是临时的，会过期

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

在聊天中发送 `/new` 命令即可开启新对话。

#### 消息为什么不是流式输出

钉钉 API 有请求频率限制，流式更新消息很容易触发限流。当前采用完整回复后一次性发送的方式，以保证稳定性。

#### 在钉钉里找不到机器人

1. 确保应用已发布（至少发布到测试版本）
2. 在钉钉搜索框中搜索机器人名称
3. 检查应用可用范围是否包含你的账号

---

## License

MIT
