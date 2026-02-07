import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import type { DWClient } from "dingtalk-stream";
import type { DingTalkConfig } from "./types.js";
import { resolveDingTalkAccountConfig } from "./accounts.js";
import fs from "fs";
import path from "path";

// ============ File Marker Processing ============

/**
 * Regex to match file markers: [DINGTALK_FILE]{...}[/DINGTALK_FILE]
 */
const FILE_MARKER_RE = /\[DINGTALK_FILE\]\s*(\{[^}]+\})\s*\[\/DINGTALK_FILE\]/g;

/** Maximum file size for upload (20MB) */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export interface FileMarkerInfo {
  path: string;
  name?: string;
}

export interface ExtractedFileMarker {
  fullMatch: string;
  info: FileMarkerInfo;
}

export interface ProcessedFileResult {
  content: string;
  files: ExtractedFileMarker[];
}

/**
 * Extract file markers from content.
 * Returns the content with markers removed and a list of extracted file info.
 */
export function extractFileMarkers(content: string, log?: Logger): ProcessedFileResult {
  const files: ExtractedFileMarker[] = [];
  const matches = [...content.matchAll(FILE_MARKER_RE)];

  if (matches.length === 0) {
    return { content, files };
  }

  log?.info?.(`[DingTalk][Media] Found ${matches.length} file markers`);

  for (const match of matches) {
    const [fullMatch, jsonStr] = match;
    try {
      const info = JSON.parse(jsonStr) as FileMarkerInfo;
      if (info.path) {
        files.push({ fullMatch, info });
        log?.info?.(`[DingTalk][Media] Extracted file: ${info.path}, name=${info.name || "(auto)"}`);
      }
    } catch (err) {
      log?.warn?.(`[DingTalk][Media] Failed to parse file marker JSON: ${jsonStr}`);
    }
  }

  // Remove file markers from content
  let cleanedContent = content;
  for (const file of files) {
    cleanedContent = cleanedContent.replace(file.fullMatch, "");
  }

  // Clean up extra whitespace left by removed markers
  cleanedContent = cleanedContent.replace(/\n{3,}/g, "\n\n").trim();

  return { content: cleanedContent, files };
}

/**
 * Upload a file to DingTalk via OpenAPI and send as file message.
 * Uses the robot message API for file sending.
 */
export async function uploadAndSendFile(
  filePath: string,
  fileName: string | undefined,
  config: { appKey: string; appSecret: string; robotCode?: string },
  conversationInfo: {
    conversationType: "1" | "2";
    conversationId: string;
    senderId?: string;
  },
  log?: Logger,
): Promise<boolean> {
  try {
    const absPath = toLocalPath(filePath);

    if (!fs.existsSync(absPath)) {
      log?.warn?.(`[DingTalk][Media] File not found: ${absPath}`);
      return false;
    }

    const stats = fs.statSync(absPath);
    if (stats.size > MAX_FILE_SIZE) {
      log?.warn?.(`[DingTalk][Media] File too large (${Math.round(stats.size / 1024 / 1024)}MB > 20MB): ${absPath}`);
      return false;
    }

    const finalFileName = fileName || path.basename(absPath);
    const fileExt = path.extname(finalFileName).slice(1).toLowerCase() || "file";

    log?.info?.(`[DingTalk][Media] Uploading file: ${absPath} as "${finalFileName}"`);

    // Step 1: Get oapi access token for upload
    const oapiTokenResp = await fetch(
      `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(config.appKey)}&appsecret=${encodeURIComponent(config.appSecret)}`,
    );

    if (!oapiTokenResp.ok) {
      log?.error?.(`[DingTalk][Media] Failed to get oapi token: ${oapiTokenResp.status}`);
      return false;
    }

    const oapiTokenData = (await oapiTokenResp.json()) as { errcode?: number; access_token?: string };
    if (oapiTokenData.errcode !== 0 || !oapiTokenData.access_token) {
      log?.error?.(`[DingTalk][Media] oapi token error: errcode=${oapiTokenData.errcode}`);
      return false;
    }
    const oapiToken = oapiTokenData.access_token;

    // Step 2: Upload file via oapi to get media_id
    const formData = new FormData();
    const fileBuffer = await fs.promises.readFile(absPath);
    const blob = new Blob([fileBuffer]);
    formData.append("media", blob, finalFileName);

    const uploadResp = await fetch(
      `https://oapi.dingtalk.com/media/upload?access_token=${oapiToken}&type=file`,
      { method: "POST", body: formData },
    );

    if (!uploadResp.ok) {
      const text = await uploadResp.text();
      log?.error?.(`[DingTalk][Media] File upload failed: ${uploadResp.status} ${text}`);
      return false;
    }

    const uploadData = (await uploadResp.json()) as { errcode?: number; media_id?: string };
    const mediaId = uploadData.media_id;

    if (!mediaId) {
      log?.error?.(`[DingTalk][Media] No media_id returned from upload: errcode=${uploadData.errcode}`);
      return false;
    }

    log?.info?.(`[DingTalk][Media] File uploaded, mediaId=${mediaId}`);

    // Step 2.5: Get OAuth2 access token for sending via robot API
    const tokenResp = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appKey: config.appKey,
        appSecret: config.appSecret,
      }),
    });

    if (!tokenResp.ok) {
      log?.error?.(`[DingTalk][Media] Failed to get access token: ${tokenResp.status}`);
      return false;
    }

    const tokenData = (await tokenResp.json()) as { accessToken: string };
    const accessToken = tokenData.accessToken;

    // Step 3: Send file message via OpenAPI
    const isGroup = conversationInfo.conversationType === "2";

    if (isGroup) {
      // Send to group
      const sendResp = await fetch("https://api.dingtalk.com/v1.0/robot/groupMessages/send", {
        method: "POST",
        headers: {
          "x-acs-dingtalk-access-token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          robotCode: config.robotCode || config.appKey,
          openConversationId: conversationInfo.conversationId,
          msgKey: "sampleFile",
          msgParam: JSON.stringify({
            mediaId,
            fileName: finalFileName,
            fileType: fileExt,
          }),
        }),
      });

      if (!sendResp.ok) {
        const text = await sendResp.text();
        log?.error?.(`[DingTalk][Media] Group file send failed: ${sendResp.status} ${text}`);
        return false;
      }

      log?.info?.(`[DingTalk][Media] File sent to group successfully`);
    } else {
      // Send to user (1:1 chat)
      const sendResp = await fetch("https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend", {
        method: "POST",
        headers: {
          "x-acs-dingtalk-access-token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          robotCode: config.robotCode || config.appKey,
          userIds: [conversationInfo.senderId],
          msgKey: "sampleFile",
          msgParam: JSON.stringify({
            mediaId,
            fileName: finalFileName,
            fileType: fileExt,
          }),
        }),
      });

      if (!sendResp.ok) {
        const text = await sendResp.text();
        log?.error?.(`[DingTalk][Media] DM file send failed: ${sendResp.status} ${text}`);
        return false;
      }

      log?.info?.(`[DingTalk][Media] File sent to user successfully`);
    }

    return true;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log?.error?.(`[DingTalk][Media] File processing failed: ${errMsg}`);
    return false;
  }
}

/**
 * Process file markers in content: extract, upload, and send files.
 * Returns the cleaned content (with markers removed).
 */
export async function processFileMarkers(
  content: string,
  config: { appKey: string; appSecret: string; robotCode?: string },
  conversationInfo: {
    conversationType: "1" | "2";
    conversationId: string;
    senderId?: string;
  },
  log?: Logger,
): Promise<string> {
  const { content: cleanedContent, files } = extractFileMarkers(content, log);

  if (files.length === 0) {
    return content;
  }

  log?.info?.(`[DingTalk][Media] Processing ${files.length} file(s)...`);

  // Upload and send each file
  for (const file of files) {
    const success = await uploadAndSendFile(
      file.info.path,
      file.info.name,
      config,
      conversationInfo,
      log,
    );

    if (!success) {
      log?.warn?.(`[DingTalk][Media] Failed to send file: ${file.info.path}`);
    }
  }

  return cleanedContent;
}

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
 * Build system prompt instructing LLM to use local file paths for images and file markers.
 * This guides the LLM to output markdown with local paths instead of URLs.
 */
export function buildMediaSystemPrompt(): string {
  return `## 钉钉媒体显示规则

你正在钉钉中与用户对话。

### 图片显示
直接使用本地文件路径，系统会自动上传处理：
\`\`\`markdown
![描述](file:///path/to/image.jpg)
![描述](/tmp/screenshot.png)
\`\`\`

### 文件发送
使用特殊标记发送文件，系统会自动上传并发送文件卡片：
\`\`\`
[DINGTALK_FILE]{"path": "/path/to/file.pdf", "name": "报告.pdf"}[/DINGTALK_FILE]
[DINGTALK_FILE]{"path": "/tmp/data.xlsx"}[/DINGTALK_FILE]
\`\`\`

文件标记参数：
- \`path\` (必填): 本地文件路径
- \`name\` (可选): 显示的文件名，默认使用原文件名

### 禁止
- 不要自己执行 curl 上传
- 不要猜测或构造 URL
- 不要使用 https://oapi.dingtalk.com/... 这类地址

直接输出本地路径或文件标记即可，系统会自动处理上传。`;
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

    // Manual token request using appKey/appSecret from config
    if (config.appKey && config.appSecret) {
      return getOapiTokenForConfig(config);
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
  accountId?: string;
}): Promise<DownloadMediaResult | null> {
  const { cfg, downloadCode, robotCode, client, accountId } = params;
  const rawCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
  if (!rawCfg) {
    throw new Error("DingTalk channel not configured");
  }
  const dingtalkCfg = resolveDingTalkAccountConfig(rawCfg, accountId);

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

    // Force HTTPS if the URL is HTTP (some environments block plain HTTP)
    const fileUrl = result.downloadUrl.replace(/^http:\/\//, "https://");

    const fileResponse = await fetch(fileUrl);
    if (!fileResponse.ok) {
      throw new Error(`Failed to download file from URL: ${fileResponse.status}`);
    }

    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    const contentType = fileResponse.headers.get("content-type") || undefined;

    return { buffer, contentType };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const cause = err instanceof Error && err.cause ? ` (cause: ${String(err.cause)})` : "";
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
  accountId?: string;
}): Promise<UploadMediaResult | null> {
  const { cfg, buffer, fileName, mediaType, client, accountId } = params;
  const rawCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
  if (!rawCfg) {
    throw new Error("DingTalk channel not configured");
  }
  const dingtalkCfg = resolveDingTalkAccountConfig(rawCfg, accountId);

  if (!client) {
    return null;
  }

  try {
    // Get oapi token for media upload
    const oapiTokenResp = await fetch(
      `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(dingtalkCfg.appKey!)}&appsecret=${encodeURIComponent(dingtalkCfg.appSecret!)}`,
    );

    if (!oapiTokenResp.ok) {
      throw new Error(`Failed to get oapi token: ${oapiTokenResp.status}`);
    }

    const oapiTokenData = (await oapiTokenResp.json()) as { errcode?: number; access_token?: string };
    if (oapiTokenData.errcode !== 0 || !oapiTokenData.access_token) {
      throw new Error(`oapi token error: errcode=${oapiTokenData.errcode}`);
    }

    // Upload via oapi media endpoint
    const formData = new FormData();
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: "application/octet-stream" });
    formData.append("media", blob, fileName);

    const response = await fetch(
      `https://oapi.dingtalk.com/media/upload?access_token=${oapiTokenData.access_token}&type=${mediaType}`,
      { method: "POST", body: formData },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DingTalk media upload failed: ${response.status} ${text}`);
    }

    const result = await response.json() as { errcode?: number; media_id?: string };

    if (!result.media_id) {
      throw new Error(`DingTalk media upload failed: no media_id returned, errcode=${result.errcode}`);
    }

    return { mediaId: result.media_id };
  } catch {
    return null;
  }
}

/**
 * Send an image via sessionWebhook using actionCard format.
 * DingTalk actionCard renders ![image](url) inline, unlike markdown messages.
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

  // Use actionCard for inline image rendering.
  // DingTalk actionCard text renders ![image](url) inline, unlike markdown messages.
  const message = {
    msgtype: "actionCard",
    actionCard: {
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

  // For local files, upload first then send
  if (buffer && client) {
    const uploadResult = await uploadMediaDingTalk({
      cfg,
      buffer,
      fileName: name,
      mediaType: fileType,
      client,
    });

    if (uploadResult && fileType === "image") {
      // Send uploaded image via actionCard with media_id.
      // DingTalk actionCard renders ![image](media_id) inline.
      return sendImageDingTalk({
        cfg,
        sessionWebhook,
        imageUrl: uploadResult.mediaId,
        title: name,
        client,
      });
    }

    if (uploadResult) {
      return {
        conversationId: "",
        processQueryKey: uploadResult.mediaId,
      };
    }
  }

  throw new Error("Unable to send media: upload failed or no client available");
}

/**
 * Get oapi access token using appKey/appSecret from DingTalk config.
 */
async function getOapiTokenForConfig(config: DingTalkConfig): Promise<string | null> {
  try {
    const response = await fetch(
      `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(config.appKey!)}&appsecret=${encodeURIComponent(config.appSecret!)}`,
    );

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
