# Contributing Guide

Development workflow and guidelines for openclaw-dingtalk.

## Prerequisites

- Node.js >= 18
- npm >= 9
- DingTalk Developer Account ([开放平台](https://open-dev.dingtalk.com))

## Setup

```bash
# Clone repository
git clone https://github.com/adongguo/openclaw-dingtalk.git
cd openclaw-dingtalk

# Install dependencies
npm install

# Type check
npx tsc --noEmit
```

## Project Structure

```
openclaw-dingtalk/
├── index.ts              # Plugin entry point
├── src/
│   ├── channel.ts        # ChannelPlugin implementation
│   ├── client.ts         # DWClient factory
│   ├── monitor.ts        # Stream connection handler
│   ├── bot.ts            # Message event handler
│   ├── send.ts           # Outbound message sending
│   ├── media.ts          # Media upload/download
│   ├── outbound.ts       # ChannelOutboundAdapter
│   ├── reply-dispatcher.ts # Reply routing
│   ├── ai-card.ts        # AI Card streaming
│   ├── session.ts        # Session management
│   ├── gateway-stream.ts # Gateway SSE client
│   ├── streaming-handler.ts # Streaming integration
│   ├── config-schema.ts  # Zod config schemas
│   ├── policy.ts         # DM/group policies
│   ├── accounts.ts       # Credential resolution
│   ├── types.ts          # TypeScript definitions
│   ├── targets.ts        # Target normalization
│   ├── directory.ts      # User/group lookup
│   ├── onboarding.ts     # Setup wizard
│   ├── probe.ts          # Health check
│   ├── reactions.ts      # Stub (unsupported)
│   └── typing.ts         # Stub (unsupported)
├── openclaw.plugin.json  # Plugin manifest
├── package.json
└── tsconfig.json
```

## Development Workflow

### 1. Local Development

No build step required. Plugin loads `.ts` files directly via OpenClaw's tsx runtime.

```bash
# Type check during development
npx tsc --noEmit --watch
```

### 2. Testing with OpenClaw

```bash
# In your OpenClaw project, link the plugin
npm link ../openclaw-dingtalk

# Or use local path in config
openclaw config set plugins.dingtalk.path "/path/to/openclaw-dingtalk"
```

### 3. Configuration

Create test configuration:

```yaml
channels:
  dingtalk:
    enabled: true
    appKey: "your_app_key"
    appSecret: "your_app_secret"
    connectionMode: "stream"
    dmPolicy: "pairing"
```

## Scripts Reference

| Command | Description |
|---------|-------------|
| `npm install` | Install dependencies |
| `npx tsc --noEmit` | Type check without emitting |
| `npx tsc --noEmit --watch` | Watch mode type checking |

## Configuration Options

All configuration is via OpenClaw config file. See [config-schema.ts](../src/config-schema.ts) for full schema.

### Core Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable channel |
| `appKey` | string | - | DingTalk AppKey (ClientID) |
| `appSecret` | string | - | DingTalk AppSecret (ClientSecret) |
| `robotCode` | string | - | Robot code for media operations |
| `connectionMode` | `"stream"` \| `"webhook"` | `"stream"` | Connection mode |

### Policy Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dmPolicy` | `"open"` \| `"pairing"` \| `"allowlist"` | `"pairing"` | DM handling policy |
| `groupPolicy` | `"open"` \| `"allowlist"` \| `"disabled"` | `"allowlist"` | Group handling policy |
| `requireMention` | boolean | `true` | Require @mention in groups |
| `allowFrom` | string[] | - | DM allowlist (user IDs) |
| `groupAllowFrom` | string[] | - | Group allowlist (conversation IDs) |

### Rendering Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `renderMode` | `"auto"` \| `"raw"` \| `"card"` | `"auto"` | Message render mode |
| `aiCardMode` | `"enabled"` \| `"disabled"` | `"enabled"` | AI Card streaming mode |

### Gateway Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `gatewayToken` | string | - | Gateway auth token |
| `gatewayPassword` | string | - | Gateway auth password |
| `gatewayPort` | number | `18789` | Gateway port |

### Session Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sessionTimeout` | number | `1800000` | Session timeout in ms (30 min) |

### Media Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mediaMaxMb` | number | `30` | Max media size in MB |
| `enableMediaUpload` | boolean | `true` | Enable image post-processing |

### Advanced Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cooldownMs` | number | - | Message cooldown to avoid rate limiting |
| `historyLimit` | number | - | Group message history limit |
| `dmHistoryLimit` | number | - | DM message history limit |
| `textChunkLimit` | number | - | Max text chunk size |
| `systemPrompt` | string | - | Custom system prompt |

## Code Style

- TypeScript with strict mode
- ESM modules (`"type": "module"`)
- Zod for runtime validation
- Functional style preferred

## Commit Guidelines

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add AI Card streaming support
fix: handle sessionWebhook expiration
docs: update configuration reference
refactor: extract media upload logic
```

## Testing

No test suite exists yet. Manual testing:

1. Configure DingTalk application in Stream mode
2. Start OpenClaw with dingtalk channel enabled
3. Send messages via DingTalk client

## Resources

- [DingTalk Open Platform](https://open-dev.dingtalk.com)
- [DingTalk Developer Docs](https://open.dingtalk.com/document)
- [dingtalk-stream SDK](https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs)
- [OpenClaw Documentation](https://github.com/openclaw/openclaw)
