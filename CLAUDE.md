# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DingTalk (钉钉) channel plugin for [OpenClaw](https://github.com/openclaw/openclaw). Enables send/receive messages through DingTalk's enterprise messaging platform using Stream mode.

## Development

TypeScript ESM project. No build step - plugin is loaded directly as `.ts` files by OpenClaw.

```bash
npm install          # Install dependencies
npx tsc --noEmit     # Type check
```

No test suite exists yet.

## Architecture

### Entry Point
- `index.ts` - Plugin registration, exports public API

### Core Modules (src/)

**Channel Implementation:**
- `channel.ts` - Main `ChannelPlugin` implementation, lifecycle management, config validation

**Connection & Events:**
- `client.ts` - DingTalk Stream SDK client factory (DWClient)
- `monitor.ts` - Stream mode connection, registers TOPIC_ROBOT callback
- `bot.ts` - Message event handler, parses content, resolves media, dispatches to agent
- `onboarding.ts` - Interactive setup wizard for channel configuration

**Outbound:**
- `send.ts` - Text, markdown, ActionCard messages via sessionWebhook
- `media.ts` - Upload/download images and files via OpenAPI
- `outbound.ts` - `ChannelOutboundAdapter` implementation
- `reply-dispatcher.ts` - Reply handling with render mode (raw/card/auto)

**Configuration & Policy:**
- `config-schema.ts` - Zod schemas for channel config
- `policy.ts` - DM/group allowlist, mention requirements
- `accounts.ts` - Credential resolution (appKey, appSecret)
- `types.ts` - TypeScript type definitions

**Utilities:**
- `targets.ts` - Normalize target formats
- `directory.ts` - User/group lookup (config-based)
- `reactions.ts` - Stub (DingTalk doesn't support reactions via bot API)
- `typing.ts` - Stub (DingTalk doesn't support typing indicator)
- `probe.ts` - Bot health check

**AI Card Streaming (NEW):**
- `ai-card.ts` - AI Card creation, streaming updates, and completion
- `session.ts` - Session timeout management with new session commands
- `gateway-stream.ts` - Gateway SSE streaming client
- `streaming-handler.ts` - Integrated streaming message handler

### Message Flow

1. `monitor.ts` starts Stream connection via `DWClient.connect()`
2. `DWClient.registerCallbackListener(TOPIC_ROBOT, ...)` receives messages
3. `bot.ts` parses the incoming message JSON
4. For media messages, `media.ts` downloads content via OpenAPI
5. Message is dispatched to OpenClaw agent via `reply-dispatcher.ts`
6. Agent responses flow through `send.ts` using `sessionWebhook` URL

### Key Configuration Options

| Option | Description |
|--------|-------------|
| `connectionMode` | `stream` (default) or `webhook` |
| `dmPolicy` | `pairing` / `open` / `allowlist` |
| `groupPolicy` | `open` / `allowlist` / `disabled` |
| `renderMode` | `auto` / `raw` / `card` for message rendering |
| `aiCardMode` | `enabled` / `disabled` for AI Card streaming |
| `sessionTimeout` | Session timeout in ms (default: 30 minutes) |
| `gatewayToken` | Gateway auth token |
| `gatewayPort` | Gateway port (default: 18789) |

### DingTalk SDK Usage

Uses `dingtalk-stream` npm package. Key components:
- `DWClient` - Stream mode client for WebSocket connection
- `TOPIC_ROBOT` - Topic constant for robot message callbacks
- `sessionWebhook` - Temporary webhook URL for replying (from incoming message)

### OpenClaw Plugin SDK

This plugin implements the OpenClaw channel plugin interface:
- `ChannelPlugin` - Main plugin interface (`channel.ts`)
- `ChannelOutboundAdapter` - Outbound message handling (`outbound.ts`)
- `OpenClawPluginApi` - Runtime API for plugin registration

The plugin is registered in `index.ts` via `api.registerChannel()`.

### DingTalk API Limitations

- **No message editing**: Cannot edit sent messages via sessionWebhook
- **No reactions**: Bot API doesn't support message reactions
- **No typing indicator**: No native API for this
- **sessionWebhook expiration**: Reply URLs expire (check `sessionWebhookExpiredTime`)
- **Rate limits**: Avoid rapid message sending to prevent throttling
- **Group @mention required**: In group chats, messages must @mention the bot to be received - this is a DingTalk platform limitation and cannot be changed via configuration

## Troubleshooting

**Bot receives no messages**:
1. Check DingTalk Open Platform → Application → Robot configuration
2. Ensure Stream mode is enabled (not HTTP mode)
3. Verify `im.message.receive_v1` event subscription is enabled
4. Check appKey/appSecret are correct

**Failed to send messages**:
1. Ensure sessionWebhook hasn't expired
2. Check message format (text/markdown/actionCard)
3. Verify bot has necessary permissions

See README.md for full configuration guide and required permissions.
