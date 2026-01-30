import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import type { DWClient } from "dingtalk-stream";
import type { DingTalkConfig } from "./types.js";
import fs from "fs";
import path from "path";

// ============ Image Post-Processing (Local Path Upload) ============

/**
 * Regex to match markdown images with local file paths:
 * - ![alt](file:///path/to/image.jpg)
 * - ![alt](MEDIA:/var/folders/xxx.jpg)
 * - ![alt](attachment:///path.jpg)
 * - ![alt](/tmp/xxx.jpg)
 * - ![alt](/var/folders/xxx.jpg)
 * - ![alt](/Users/xxx/photo.jpg)
 */
const LOCAL_IMAGE_RE = /!\[([^\]]*)\]\(((?:file:\/\/\/|MEDIA:|attachment:\/\/\/)[^\s)]+|\/(?:tmp|var|private|Users)[^\s)]+)\)/g;

/**
 * Regex to match bare local image paths (not in markdown syntax):
 * - `/var/folders/.../screenshot.png`
 * - `/tmp/image.jpg`
 * - `/Users/xxx/photo.png`
 * Supports backtick wrapping: `path`
 */
const BARE_IMAGE_PATH_RE = /`?(\/(?:tmp|var|private|Users)\/[^\s`'",)]+\.(?:png|jpg|jpeg|gif|bmp|webp))`?/gi;

interface Logger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

/**
 * Build system prompt instructing LLM to use local file paths for images.
 * This guides the LLM to output markdown with local paths instead of URLs.
 */
export function buildMediaSystemPrompt(): string {
  return `## 钉钉图片显示规则

你正在钉钉中与用户对话。显示图片时，直接使用本地文件路径，系统会自动上传处理。

### 正确方式
\`\`\`markdown
![描述](file:///path/to/image.jpg)
![描述](/tmp/screenshot.png)
![描述](/Users/xxx/photo.jpg)
\`\`\`

### 禁止
- 不要自己执行 curl 上传
- 不要猜测或构造 URL
- 不要使用 https://oapi.dingtalk.com/... 这类地址

直接输出本地路径即可，系统会自动上传到钉钉。`;
}

/**
 * Convert file:// MEDIA: attachment:// prefixes to absolute path.
 */
function toLocalPath(raw: string): string {
  let filePath = raw;
  if (filePath.startsWith("file://")) {
    filePath = filePath.replace("file://", "");
  } else if (filePath.startsWith("MEDIA:")) {
    filePath = filePath.replace("MEDIA:", "");
  } else if (filePath.startsWith("attachment://")) {
    filePath = filePath.replace("attachment://", "");
  }

  // Decode URL-encoded paths (e.g. %E5%9B%BE -> 图)
  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    // Keep original if decode fails
  }
  return filePath;
}

/**
 * Get oapi access token for media upload.
 * Uses dingtalk-stream's internal getAccessToken if available.
 */
export async function getOapiAccessToken(
  config: DingTalkConfig,
  client?: DWClient,
): Promise<string | null> {
  try {
    // Try to get token from client first (dingtalk-stream SDK)
    if (client) {
      try {
        const token = await (client as unknown as { getAccessToken: () => Promise<string> }).getAccessToken();
        return token;
      } catch {
        // Fall through to manual token request
      }
    }

    // Manual token request
    const response = await fetch("https://oapi.dingtalk.com/gettoken", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { errcode?: number; access_token?: string };
    if (data.errcode === 0 && data.access_token) {
      return data.access_token;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Upload local file to DingTalk via oapi media upload endpoint.
 * Returns media_id if successful.
 */
async function uploadToDingTalk(filePath: string, oapiToken: string, log?: Logger): Promise<string | null> {
  try {
    const absPath = toLocalPath(filePath);

    if (!fs.existsSync(absPath)) {
      log?.warn?.(`[DingTalk][Media] File not found: ${absPath}`);
      return null;
    }

    const fileStream = fs.createReadStream(absPath);
    const fileName = path.basename(absPath);

    // Use FormData for multipart upload
    const formData = new FormData();
    const blob = new Blob([await fs.promises.readFile(absPath)]);
    formData.append("media", blob, fileName);

    log?.info?.(`[DingTalk][Media] Uploading image: ${absPath}`);

    const response = await fetch(
      `https://oapi.dingtalk.com/media/upload?access_token=${oapiToken}&type=image`,
      {
        method: "POST",
        body: formData,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      log?.warn?.(`[DingTalk][Media] Upload failed: ${response.status} ${text}`);
      return null;
    }

    const data = (await response.json()) as { media_id?: string };
    const mediaId = data.media_id;

    if (mediaId) {
      log?.info?.(`[DingTalk][Media] Upload success: media_id=${mediaId}`);
      return mediaId;
    }

    log?.warn?.(`[DingTalk][Media] Upload returned no media_id: ${JSON.stringify(data)}`);
    return null;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log?.error?.(`[DingTalk][Media] Upload failed: ${errMsg}`);
    return null;
  }
}

/**
 * Process content by scanning for local image paths and uploading them to DingTalk.
 * Replaces local paths with media_id in the output.
 *
 * @param content - Content containing potential local image paths
 * @param oapiToken - DingTalk oapi access token
 * @param log - Optional logger
 * @returns Content with local paths replaced by media_ids
 */
export async function processLocalImages(content: string, oapiToken: string | null, log?: Logger): Promise<string> {
  if (!oapiToken) {
    log?.warn?.(`[DingTalk][Media] No oapiToken, skipping image post-processing`);
    return content;
  }

  let result = content;

  // Step 1: Match markdown images ![alt](path)
  const mdMatches = [...content.matchAll(LOCAL_IMAGE_RE)];
  if (mdMatches.length > 0) {
    log?.info?.(`[DingTalk][Media] Found ${mdMatches.length} markdown images, uploading...`);
    for (const match of mdMatches) {
      const [fullMatch, alt, rawPath] = match;
      const mediaId = await uploadToDingTalk(rawPath, oapiToken, log);
      if (mediaId) {
        result = result.replace(fullMatch, `![${alt}](${mediaId})`);
      }
    }
  }

  // Step 2: Match bare local paths (e.g. /var/folders/.../xxx.png)
  // Filter out paths already wrapped in markdown
  const bareMatches = [...result.matchAll(BARE_IMAGE_PATH_RE)];
  const newBareMatches = bareMatches.filter((m) => {
    const idx = m.index!;
    const before = result.slice(Math.max(0, idx - 10), idx);
    return !before.includes("](");
  });

  if (newBareMatches.length > 0) {
    log?.info?.(`[DingTalk][Media] Found ${newBareMatches.length} bare image paths, uploading...`);
    // Replace from end to avoid index shifting
    for (const match of newBareMatches.reverse()) {
      const [fullMatch, rawPath] = match;
      log?.info?.(`[DingTalk][Media] Bare image: "${fullMatch}" -> path="${rawPath}"`);
      const mediaId = await uploadToDingTalk(rawPath, oapiToken, log);
      if (mediaId) {
        const replacement = `![](${mediaId})`;
        result = result.slice(0, match.index!) + result.slice(match.index!).replace(fullMatch, replacement);
        log?.info?.(`[DingTalk][Media] Replaced: ${replacement}`);
      }
    }
  }

  if (mdMatches.length === 0 && newBareMatches.length === 0) {
    log?.info?.(`[DingTalk][Media] No local image paths detected`);
  }

  return result;
}

export type DownloadMediaResult = {
  buffer: Buffer;
  contentType?: string;
  fileName?: string;
};

export type UploadMediaResult = {
  mediaId: string;
};

export type SendMediaResult = {
  conversationId: string;
  processQueryKey?: string;
};

/**
 * Download media from DingTalk message using downloadCode.
 * Note: This requires OpenAPI access token.
 */
export async function downloadMediaDingTalk(params: {
  cfg: ClawdbotConfig;
  downloadCode: string;
  robotCode?: string;
  client?: DWClient;
}): Promise<DownloadMediaResult | null> {
  const { cfg, downloadCode, robotCode, client } = params;
  const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
  if (!dingtalkCfg) {
    throw new Error("DingTalk channel not configured");
  }

  if (!client) {
    // Cannot download without client for access token
    return null;
  }

  try {
    const accessToken = await client.getAccessToken();

    // DingTalk media download API
    // https://api.dingtalk.com/v1.0/robot/messageFiles/download
    const response = await fetch("https://api.dingtalk.com/v1.0/robot/messageFiles/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-acs-dingtalk-access-token": accessToken,
      },
      body: JSON.stringify({
        downloadCode,
        robotCode: robotCode || dingtalkCfg.robotCode,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DingTalk media download failed: ${response.status} ${text}`);
    }

    const result = await response.json() as { downloadUrl?: string };

    if (!result.downloadUrl) {
      throw new Error("DingTalk media download failed: no downloadUrl returned");
    }

    // Download the actual file from the URL
    const fileResponse = await fetch(result.downloadUrl);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file from URL: ${fileResponse.status}`);
    }

    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    const contentType = fileResponse.headers.get("content-type") || undefined;

    return { buffer, contentType };
  } catch (err) {
    console.error(`DingTalk media download error: ${String(err)}`);
    return null;
  }
}

/**
 * Upload media to DingTalk via OpenAPI.
 * This can be used for sending images/files in messages.
 */
export async function uploadMediaDingTalk(params: {
  cfg: ClawdbotConfig;
  buffer: Buffer;
  fileName: string;
  mediaType: "image" | "file" | "voice";
  client?: DWClient;
}): Promise<UploadMediaResult | null> {
  const { cfg, buffer, fileName, mediaType, client } = params;
  const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
  if (!dingtalkCfg) {
    throw new Error("DingTalk channel not configured");
  }

  if (!client) {
    return null;
  }

  try {
    const accessToken = await client.getAccessToken();

    // DingTalk media upload uses multipart form data
    // https://api.dingtalk.com/v1.0/robot/messageFiles/upload
    const formData = new FormData();
    // Convert Buffer to ArrayBuffer for Blob compatibility
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: "application/octet-stream" });
    formData.append("file", blob, fileName);
    formData.append("type", mediaType);
    formData.append("robotCode", dingtalkCfg.robotCode || "");

    const response = await fetch("https://api.dingtalk.com/v1.0/robot/messageFiles/upload", {
      method: "POST",
      headers: {
        "x-acs-dingtalk-access-token": accessToken,
      },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DingTalk media upload failed: ${response.status} ${text}`);
    }

    const result = await response.json() as { mediaId?: string };

    if (!result.mediaId) {
      throw new Error("DingTalk media upload failed: no mediaId returned");
    }

    return { mediaId: result.mediaId };
  } catch (err) {
    console.error(`DingTalk media upload error: ${String(err)}`);
    return null;
  }
}

/**
 * Send an image via sessionWebhook using markdown with image URL.
 * Note: DingTalk sessionWebhook has limited support for images.
 * For better image support, use OpenAPI.
 */
export async function sendImageDingTalk(params: {
  cfg: ClawdbotConfig;
  sessionWebhook: string;
  imageUrl: string;
  title?: string;
  client?: DWClient;
}): Promise<SendMediaResult> {
  const { sessionWebhook, imageUrl, title, client } = params;

  let accessToken: string | undefined;
  if (client) {
    try {
      accessToken = await client.getAccessToken();
    } catch {
      // Proceed without access token
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (accessToken) {
    headers["x-acs-dingtalk-access-token"] = accessToken;
  }

  // Use markdown format to embed image
  const message = {
    msgtype: "markdown",
    markdown: {
      title: title || "Image",
      text: `![image](${imageUrl})`,
    },
  };

  const response = await fetch(sessionWebhook, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DingTalk image send failed: ${response.status} ${text}`);
  }

  const result = await response.json() as { errcode?: number; errmsg?: string; processQueryKey?: string };

  if (result.errcode && result.errcode !== 0) {
    throw new Error(`DingTalk image send failed: ${result.errmsg || `code ${result.errcode}`}`);
  }

  return {
    conversationId: "",
    processQueryKey: result.processQueryKey,
  };
}

/**
 * Send a file link via sessionWebhook.
 * Note: DingTalk sessionWebhook doesn't support file attachments directly.
 * This sends a link message pointing to the file URL.
 */
export async function sendFileDingTalk(params: {
  cfg: ClawdbotConfig;
  sessionWebhook: string;
  fileUrl: string;
  fileName: string;
  client?: DWClient;
}): Promise<SendMediaResult> {
  const { sessionWebhook, fileUrl, fileName, client } = params;

  let accessToken: string | undefined;
  if (client) {
    try {
      accessToken = await client.getAccessToken();
    } catch {
      // Proceed without access token
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (accessToken) {
    headers["x-acs-dingtalk-access-token"] = accessToken;
  }

  // Use link format for files
  const message = {
    msgtype: "link",
    link: {
      title: fileName,
      text: `File: ${fileName}`,
      messageUrl: fileUrl,
      picUrl: "",
    },
  };

  const response = await fetch(sessionWebhook, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DingTalk file send failed: ${response.status} ${text}`);
  }

  const result = await response.json() as { errcode?: number; errmsg?: string; processQueryKey?: string };

  if (result.errcode && result.errcode !== 0) {
    throw new Error(`DingTalk file send failed: ${result.errmsg || `code ${result.errcode}`}`);
  }

  return {
    conversationId: "",
    processQueryKey: result.processQueryKey,
  };
}

/**
 * Helper to detect file type from extension
 */
export function detectFileType(
  fileName: string,
): "image" | "file" | "voice" {
  const ext = path.extname(fileName).toLowerCase();
  const imageExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
  const voiceExts = [".opus", ".ogg", ".mp3", ".wav", ".m4a"];

  if (imageExts.includes(ext)) {
    return "image";
  } else if (voiceExts.includes(ext)) {
    return "voice";
  }
  return "file";
}

/**
 * Check if a string is a local file path (not a URL)
 */
function isLocalPath(urlOrPath: string): boolean {
  if (urlOrPath.startsWith("/") || urlOrPath.startsWith("~") || /^[a-zA-Z]:/.test(urlOrPath)) {
    return true;
  }
  try {
    const url = new URL(urlOrPath);
    return url.protocol === "file:";
  } catch {
    return true;
  }
}

/**
 * Send media via sessionWebhook (limited support)
 */
export async function sendMediaDingTalk(params: {
  cfg: ClawdbotConfig;
  sessionWebhook: string;
  mediaUrl?: string;
  mediaBuffer?: Buffer;
  fileName?: string;
  client?: DWClient;
}): Promise<SendMediaResult> {
  const { cfg, sessionWebhook, mediaUrl, mediaBuffer, fileName, client } = params;

  let buffer: Buffer | undefined;
  let name: string;
  let url: string | undefined;

  if (mediaBuffer) {
    buffer = mediaBuffer;
    name = fileName ?? "file";
  } else if (mediaUrl) {
    if (isLocalPath(mediaUrl)) {
      const filePath = mediaUrl.startsWith("~")
        ? mediaUrl.replace("~", process.env.HOME ?? "")
        : mediaUrl.replace("file://", "");

      if (!fs.existsSync(filePath)) {
        throw new Error(`Local file not found: ${filePath}`);
      }
      buffer = fs.readFileSync(filePath);
      name = fileName ?? path.basename(filePath);
    } else {
      // Remote URL - can send directly as link
      url = mediaUrl;
      name = fileName ?? (path.basename(new URL(mediaUrl).pathname) || "file");
    }
  } else {
    throw new Error("Either mediaUrl or mediaBuffer must be provided");
  }

  const fileType = detectFileType(name);

  if (url) {
    // Send as link/image depending on type
    if (fileType === "image") {
      return sendImageDingTalk({ cfg, sessionWebhook, imageUrl: url, title: name, client });
    } else {
      return sendFileDingTalk({ cfg, sessionWebhook, fileUrl: url, fileName: name, client });
    }
  }

  // For local files, we need to upload first
  if (buffer && client) {
    const uploadResult = await uploadMediaDingTalk({
      cfg,
      buffer,
      fileName: name,
      mediaType: fileType,
      client,
    });

    if (uploadResult) {
      // Note: mediaId usage depends on specific DingTalk API
      // For now, return a result indicating upload was successful
      return {
        conversationId: "",
        processQueryKey: uploadResult.mediaId,
      };
    }
  }

  throw new Error("Unable to send media: upload failed or no client available");
}
