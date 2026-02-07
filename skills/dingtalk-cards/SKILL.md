---
name: dingtalk-cards
description: How to use DingTalk ActionCard with buttons, AI Card streaming, FeedCard, and rich formatting for interactive messages
---

# DingTalk Card Formatting Guide / 钉钉卡片消息指南

You are responding inside DingTalk using its card system. Cards provide richer rendering than plain text/markdown messages. This guide covers ActionCard, AI Card streaming, and best practices for interactive content.

## ActionCard Overview / ActionCard 概览

ActionCard is the most powerful message type available via sessionWebhook. It supports:

- Full markdown rendering (code blocks, tables, images)
- Optional action buttons with URLs
- Optional single-button (jump to URL)
- Better visual presentation than plain markdown messages

### When ActionCard Is Used / 何时使用 ActionCard

The system automatically switches to ActionCard when your content contains:

1. **Code blocks** — fenced with ` ``` `
2. **Tables** — with `|` column syntax
3. **Images** — `![alt](url)` or `![alt](media_id)` syntax

You can also force ActionCard rendering by configuring `renderMode: "card"`.

### ActionCard Markdown Rendering / ActionCard Markdown 渲染

ActionCard supports richer markdown than the `markdown` message type:

**Full support:**
- Headers (`#` through `######`)
- Bold, italic, inline code
- Fenced code blocks with syntax highlighting
- Tables (full `|` syntax)
- Inline images: `![description](url_or_media_id)`
- Blockquotes, lists, horizontal rules
- Links `[text](url)`

**ActionCard-specific behavior:**
- Images render **inline** as visual previews (unlike `markdown` type which shows raw text)
- Code blocks get proper monospace formatting and scrollable containers
- Tables render with borders and proper alignment

### ActionCard with Buttons / 带按钮的 ActionCard

ActionCards can include interactive buttons that open URLs:

**Single button (整体跳转):**
```
Title: "查看详情"
Text: "## 新版本发布\n\n版本 2.0 已发布，包含以下更新..."
singleTitle: "立即查看"
singleURL: "https://example.com/release/v2"
```

**Multiple buttons (独立跳转):**
```
Title: "请选择操作"
Text: "## 审批请求\n\n张三提交了差旅报销申请"
btnOrientation: "0"  (vertical) or "1" (horizontal)
btns:
  - title: "同意"
    actionURL: "https://example.com/approve?id=123"
  - title: "拒绝"
    actionURL: "https://example.com/reject?id=123"
```

### ActionCard Title / ActionCard 标题

The `title` field in ActionCard serves as:
- The notification preview text (shown in notification center)
- The message summary in chat list
- It does NOT render inside the card body

**Best practice:** Keep the title short (< 20 chars), descriptive, and use the content's first heading or a summary.

## AI Card Streaming / AI Card 流式输出

When `aiCardMode: "enabled"` (default), the plugin uses DingTalk's official AI Card template for streaming responses with a typewriter effect.

### AI Card Lifecycle / AI Card 生命周期

```
PROCESSING → INPUTING → FINISHED
                    ↘ FAILED
```

1. **PROCESSING**: Card created and delivered (shows loading indicator)
2. **INPUTING**: Content starts streaming (typewriter animation)
3. **FINISHED**: Final content displayed (static)
4. **FAILED**: Error state with error message

### AI Card Features / AI Card 功能

- **Typewriter effect**: Content appears progressively, character by character
- **Full markdown**: AI Card content supports the same markdown as ActionCard
- **Session awareness**: Cards are cached per conversation and reused during active sessions
- **Auto-fallback**: If AI Card creation fails, the system falls back to regular messages

### Writing for Streaming / 流式输出写作建议

When AI Card streaming is active:

1. **Start with a brief answer** — the user sees content appear progressively.
2. **Use headers early** — they render immediately and set context.
3. **Put code blocks after explanation** — they stream well but are hard to read mid-stream.
4. **Avoid very long single paragraphs** — break into shorter segments for better progressive rendering.

## Message Formatting Best Practices / 消息格式最佳实践

### Structured Information / 结构化信息

For reports, status updates, or structured data, use this pattern:

```markdown
## 系统监控报告

### 服务状态
| 服务 | 状态 | 响应时间 |
|------|------|----------|
| API Gateway | 正常 | 45ms |
| Database | 正常 | 12ms |
| Cache | 告警 | 230ms |

### 告警详情

> Cache 服务响应时间超过阈值（200ms），建议检查 Redis 连接池配置。

### 建议操作

1. 检查 Redis 连接数
2. 查看 Cache 命中率
3. 考虑扩容
```

### Code Review / 代码审查

```markdown
## 代码审查建议

### 问题 1: 未处理空值

`src/utils.ts:42`

```typescript
// Before (问题代码)
const name = user.profile.name;

// After (修复建议)
const name = user.profile?.name ?? 'Unknown';
```

**严重程度**: 高 — 可能导致运行时 TypeError

### 问题 2: 缺少错误处理

`src/api.ts:78`

建议添加 try-catch 包裹异步调用。
```

### Error Explanation / 错误解释

```markdown
## 错误分析

**错误**: `TypeError: Cannot read properties of undefined (reading 'map')`

**原因**: `data.items` 在 API 返回空响应时为 `undefined`

**解决方案**:

```javascript
const items = data?.items ?? [];
const result = items.map(transform);
```

**预防措施**: 添加空值检查或使用可选链操作符。
```

## DingTalk Card Limitations / 钉钉卡片限制

1. **No real-time updates for ActionCard** — once sent via sessionWebhook, ActionCards cannot be edited. Only AI Cards support streaming updates.
2. **sessionWebhook expiration** — reply URLs expire. The system handles this, but be aware that very delayed responses may fail.
3. **No reactions** — DingTalk bot API does not support message reactions.
4. **Button URLs only** — ActionCard buttons can only open URLs, not trigger bot callbacks.
5. **Image size** — inline images in ActionCards should be reasonable size. Very large images may not render on mobile.
6. **No nested cards** — you cannot embed a card inside another card.

## When NOT to Use Cards / 何时不用卡片

Use plain text (`renderMode: "raw"`) for:

- Simple yes/no answers: "好的，已完成。"
- Brief acknowledgments: "收到，稍后处理。"
- Short status updates without formatting needs
- Messages that are primarily conversational
