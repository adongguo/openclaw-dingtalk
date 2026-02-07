---
name: dingtalk-messaging
description: How to format and send DingTalk messages optimally — text, markdown, ActionCard, chunking, @mentions, and render modes
---

# DingTalk Messaging Guide / 钉钉消息格式指南

You are responding to a user inside DingTalk (钉钉), a Chinese enterprise messaging platform. Follow these rules to ensure your messages render correctly and look professional.

## Message Types Overview / 消息类型概览

DingTalk supports these outbound message types:

| Type | Best For | Markdown? | @mention? |
|------|----------|-----------|-----------|
| `text` | Short plain answers, quick replies | No | Yes |
| `markdown` | Formatted text with headers, lists, links | Limited | Yes |
| `actionCard` | Rich content: code blocks, tables, images | Full | No |
| `link` | External URL cards | No | No |

## Render Mode Selection / 渲染模式选择

The plugin uses a `renderMode` config setting:

- **`auto`** (default): Automatically selects `actionCard` when content contains code blocks, tables, or images. Otherwise uses `text`.
- **`raw`**: Always sends as plain text.
- **`card`**: Always sends as ActionCard.

You do NOT need to choose the message type yourself — the system auto-detects. Just write good markdown and the system handles the rest.

## Markdown Formatting Rules / Markdown 格式规则

### What Works in DingTalk

DingTalk's markdown support is limited compared to GitHub. Here's what renders correctly:

**Supported:**
- `# Heading 1` through `###### Heading 6`
- `**bold**` and `*italic*`
- `[link text](url)`
- `![image](url)` (in actionCard only, not in markdown msgtype)
- `> blockquote`
- `- unordered list` and `1. ordered list`
- `` `inline code` ``
- Fenced code blocks with ` ``` `
- `---` horizontal rule

**NOT Supported or Renders Poorly:**
- Nested lists beyond 2 levels
- HTML tags (`<br>`, `<table>`, etc.)
- Task lists (`- [ ] item`)
- Footnotes
- Strikethrough `~~text~~`
- Emoji shortcodes (`:smile:`) — use Unicode emoji directly: 😊

### Code Blocks / 代码块

Fenced code blocks render properly **only in ActionCard** mode. The system auto-detects code blocks and switches to ActionCard.

```python
# This will trigger ActionCard rendering automatically
def hello():
    print("Hello DingTalk!")
```

### Tables / 表格

Tables trigger ActionCard rendering automatically. Use standard markdown table syntax:

```markdown
| Name | Role |
|------|------|
| Alice | Engineer |
| Bob | Designer |
```

If ActionCard is unavailable, tables are converted to ASCII format for readability.

## @Mention Rules / @提及规则

### In Group Chats / 群聊

- You can @mention users by their `staffId`.
- The `at` field in the message payload handles this automatically.
- When replying in a group, the system may auto-@mention the sender.

### Important Limitation / 重要限制

- **Group messages must @mention the bot** for the bot to receive them. This is a DingTalk platform limitation.
- DingTalk strips the `@BotName` prefix from the message content before delivery.

## Text Length and Chunking / 文本长度与分块

- DingTalk has a ~4000 character limit per message.
- The plugin automatically chunks long messages.
- Chunk mode options:
  - `length` — splits at character boundary
  - `newline` — splits at paragraph/line boundaries (preserves formatting better)

### Best Practices for Long Content / 长文本最佳实践

1. **Use headers** to organize content — they provide natural chunk boundaries.
2. **Avoid extremely long code blocks** — break them into logical sections.
3. **Use bullet points** instead of long paragraphs for better readability on mobile.
4. **Keep table rows concise** — DingTalk mobile UI is narrow.

## Language Guidelines / 语言指南

DingTalk is primarily used in Chinese enterprises. Follow these conventions:

1. **Default to Chinese** (简体中文) unless the user writes in another language.
2. Use **formal business Chinese** (书面语) for professional contexts.
3. Keep responses concise — mobile reading is common.
4. Use proper Chinese punctuation: `，` `。` `！` `？` `：` `；` instead of `, . ! ? : ;`

## Example: Well-Formatted Response / 示例：规范格式化回复

```markdown
## 项目进度报告

### 本周完成

- **用户认证模块**: 完成 OAuth2 集成，已通过测试
- **数据库迁移**: 新增 3 个表，索引优化完成
- **API 文档**: 已更新至 v2.1

### 下周计划

1. 前端页面重构
2. 性能压测
3. 安全审计

### 待解决问题

> 第三方 API 响应时间偶尔超过 5 秒，需要增加超时重试机制。

如需详细信息，请告诉我具体模块名称。
```

## Anti-Patterns to Avoid / 避免的反模式

1. **Don't use HTML** — DingTalk ignores HTML tags in bot messages.
2. **Don't embed base64 images** — use local file paths and let the system upload.
3. **Don't send empty messages** — the system filters them, but avoid generating them.
4. **Don't use `---` excessively** — one horizontal rule between sections is enough.
5. **Don't nest markdown deeply** — keep structure flat (2 levels max for lists).
6. **Don't use raw URLs** — wrap them in `[display text](url)` format.
