---
name: dingtalk-media
description: How to send images and files in DingTalk — file markers [DINGTALK_FILE], local image paths, media upload, and inline display
---

# DingTalk Media Guide / 钉钉媒体文件指南

You are responding inside DingTalk (钉钉). This guide explains how to send images and files to users. The system handles all uploads automatically — you just need to use the correct syntax.

## Sending Images / 发送图片

### Method: Markdown Image Syntax / 方法：Markdown 图片语法

Use standard markdown image syntax with **local file paths**. The system automatically:
1. Detects local paths in your output
2. Uploads the file to DingTalk's media storage
3. Replaces the path with a `media_id`
4. Renders the image inline using ActionCard

**Supported path formats:**

```markdown
![描述](file:///path/to/image.jpg)
![截图](/tmp/screenshot.png)
![报表](/var/folders/xx/chart.png)
![照片](/Users/someone/photo.jpg)
![图片](MEDIA:/path/to/image.png)
![附件](attachment:///path/to/image.jpg)
```

**Bare paths are also detected:**

If you output a bare local image path (not wrapped in markdown syntax), the system will detect and upload it too:

```
Here is the generated chart: /tmp/output/chart.png
```

The system converts this to `![](/tmp/output/chart.png)` and uploads automatically.

### How It Works Internally / 内部工作原理

1. Your output is scanned for local image paths
2. Each local file is uploaded via DingTalk's `oapi.dingtalk.com/media/upload` API
3. The local path is replaced with the returned `media_id`
4. The content is sent as an ActionCard (which renders `![alt](media_id)` inline)

### Image Requirements / 图片要求

- **Supported formats**: JPG, JPEG, PNG, GIF, WebP, BMP
- **Maximum size**: 20MB per file
- **File must exist**: The system checks `fs.existsSync()` before upload — non-existent paths are silently skipped

### Important Rules / 重要规则

1. **Use local file paths only** — do NOT construct DingTalk API URLs yourself.
2. **Do NOT use `curl` or manual upload** — the system handles all media uploads.
3. **Do NOT guess or fabricate URLs** like `https://oapi.dingtalk.com/media/download?...`
4. **Remote URLs work too** — `![img](https://example.com/photo.jpg)` will be sent as-is without upload.

## Sending Files / 发送文件

### Method: File Markers / 方法：文件标记

Use the `[DINGTALK_FILE]...[/DINGTALK_FILE]` marker to send files as DingTalk file cards. The system automatically uploads and sends them.

**Syntax:**

```
[DINGTALK_FILE]{"path": "/path/to/file.pdf", "name": "报告.pdf"}[/DINGTALK_FILE]
```

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | Yes | Local file path (absolute path) |
| `name` | No | Display filename. Defaults to the original filename |

### File Marker Examples / 文件标记示例

**PDF report:**
```
这是您要的报告：

[DINGTALK_FILE]{"path": "/tmp/reports/monthly-report.pdf", "name": "月度报告.pdf"}[/DINGTALK_FILE]
```

**Excel spreadsheet:**
```
数据已导出：

[DINGTALK_FILE]{"path": "/tmp/exports/data.xlsx"}[/DINGTALK_FILE]
```

**Multiple files:**
```
以下是本次会议的所有资料：

[DINGTALK_FILE]{"path": "/tmp/meeting/slides.pptx", "name": "会议PPT.pptx"}[/DINGTALK_FILE]
[DINGTALK_FILE]{"path": "/tmp/meeting/notes.docx", "name": "会议纪要.docx"}[/DINGTALK_FILE]
[DINGTALK_FILE]{"path": "/tmp/meeting/budget.xlsx", "name": "预算表.xlsx"}[/DINGTALK_FILE]
```

### How File Markers Work / 文件标记工作原理

1. The system extracts all `[DINGTALK_FILE]...[/DINGTALK_FILE]` markers
2. For each marker:
   - Validates the file exists and is under 20MB
   - Gets an oapi access token
   - Uploads the file via `oapi.dingtalk.com/media/upload`
   - Sends the file as a `sampleFile` message via OpenAPI
3. Markers are removed from the text content
4. The remaining text is sent as a regular message

### File Requirements / 文件要求

- **Maximum size**: 20MB per file
- **File must exist**: Non-existent files are skipped with a warning
- **Supported types**: Any file type (PDF, DOCX, XLSX, ZIP, etc.)
- **File type detection**: Automatic from extension

## Receiving Images / 接收图片

When a user sends an image in DingTalk:

1. The incoming message contains a `downloadCode`
2. The system calls DingTalk's `/v1.0/robot/messageFiles/download` API
3. The downloaded image is passed to the agent as content

**Image message type**: `msgtype: "image"` or `"picture"`

## Mixed Content: Text + Images + Files / 混合内容

You can combine text, images, and files in a single response:

```markdown
## 数据分析结果

根据您提供的数据，分析如下：

### 趋势图

![趋势分析](/tmp/analysis/trend.png)

### 关键发现

1. 销售额环比增长 15%
2. 新客户转化率提升至 8.2%
3. 退货率下降 2 个百分点

### 详细报告

[DINGTALK_FILE]{"path": "/tmp/analysis/full-report.pdf", "name": "完整分析报告.pdf"}[/DINGTALK_FILE]
[DINGTALK_FILE]{"path": "/tmp/analysis/raw-data.xlsx", "name": "原始数据.xlsx"}[/DINGTALK_FILE]
```

**Processing order:**
1. File markers are extracted and files are uploaded/sent first
2. Local image paths are detected and uploaded
3. Remaining text (with media_ids replacing local paths) is sent as ActionCard

## Troubleshooting / 故障排除

### Image Not Displaying / 图片不显示

- **Check file exists**: The path must be an absolute path to an existing file.
- **Check file size**: Must be under 20MB.
- **Check format**: Must be a supported image format (JPG, PNG, GIF, WebP, BMP).
- **ActionCard required**: Images only render inline in ActionCard mode. If `renderMode: "raw"`, images won't display — the system auto-detects and switches to ActionCard.

### File Upload Failed / 文件上传失败

- **Check credentials**: `appKey` and `appSecret` must be configured.
- **Check file path**: Must be an absolute local path.
- **Check permissions**: The process must have read access to the file.
- **Check size**: 20MB limit per file.

### Common Mistakes / 常见错误

| Mistake | Correct |
|---------|---------|
| `![img](https://oapi.dingtalk.com/media/download?...)` | `![img](/tmp/image.png)` |
| Using `curl` to upload | Just output the local path |
| Fabricating media_id values | Let the system generate media_id |
| Using `<img>` HTML tags | Use `![alt](path)` markdown |
| Sending base64-encoded images | Save to file first, then use path |

## Anti-Patterns / 反模式

1. **Never construct DingTalk API URLs** — the system manages all API calls.
2. **Never output raw base64** — save to a temporary file and reference the path.
3. **Never use HTML image tags** — DingTalk bot messages ignore HTML.
4. **Never manually upload** — the system handles upload, token management, and retry.
5. **Never hardcode media_id** — they expire and are environment-specific.
