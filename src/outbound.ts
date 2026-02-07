import type { ChannelOutboundAdapter, ClawdbotConfig } from "openclaw/plugin-sdk";
import type { DingTalkConfig } from "./types.js";
import { getDingTalkRuntime } from "./runtime.js";
import { resolveDingTalkAccountConfig } from "./accounts.js";
import { sendMessageDingTalk } from "./send.js";
import { sendMediaDingTalk } from "./media.js";
import {
  sendTextViaOpenAPI,
  sendImageViaOpenAPI,
  sendFileViaOpenAPI,
  type OpenAPISendTarget,
} from "./openapi-send.js";
import fs from "fs";
import path from "path";
import { resolveOriginalCase } from "./peer-id-registry.js";

export type OutboundTarget =
  | { kind: "webhook"; url: string }
  | { kind: "user"; id: string }
  | { kind: "group"; id: string };

export const dingtalkOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getDingTalkRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text }) => {
    const target = parseOutboundTarget(to);

    if (target.kind === "webhook") {
      const result = await sendMessageDingTalk({ cfg, sessionWebhook: target.url, text });
      return { channel: "dingtalk", conversationId: result.conversationId, messageId: result.processQueryKey || "" };
    }

    const resolvedCfg = resolveFirstConfiguredAccount(cfg);
    if (!resolvedCfg) {
      throw new Error("[dingtalk] appKey/appSecret required for proactive send");
    }

    const openAPITarget: OpenAPISendTarget = { kind: target.kind, id: target.id };
    const result = await sendTextViaOpenAPI({ config: resolvedCfg, target: openAPITarget, content: text });
    return { channel: "dingtalk", conversationId: "", messageId: result.processQueryKey };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl }) => {
    const target = parseOutboundTarget(to);

    if (target.kind === "webhook") {
      if (text?.trim()) {
        await sendMessageDingTalk({ cfg, sessionWebhook: target.url, text });
      }

      if (mediaUrl) {
        try {
          const result = await sendMediaDingTalk({ cfg, sessionWebhook: target.url, mediaUrl });
          return { channel: "dingtalk", conversationId: result.conversationId, messageId: result.processQueryKey || "" };
        } catch (err) {
          // Fallback: upload failed, send URL as link
          const fallbackText = `📎 ${mediaUrl}`;
          const result = await sendMessageDingTalk({ cfg, sessionWebhook: target.url, text: fallbackText });
          return { channel: "dingtalk", conversationId: result.conversationId, messageId: result.processQueryKey || "" };
        }
      }

      const result = await sendMessageDingTalk({ cfg, sessionWebhook: target.url, text: text ?? "" });
      return { channel: "dingtalk", conversationId: result.conversationId, messageId: result.processQueryKey || "" };
    }

    const resolvedCfg = resolveFirstConfiguredAccount(cfg);
    if (!resolvedCfg) {
      throw new Error("[dingtalk] appKey/appSecret required for proactive send");
    }

    const openAPITarget: OpenAPISendTarget = { kind: target.kind, id: target.id };

    if (text?.trim()) {
      await sendTextViaOpenAPI({ config: resolvedCfg, target: openAPITarget, content: text });
    }

    if (mediaUrl) {
      try {
        const result = await sendMediaViaOpenAPIWithUpload(resolvedCfg, openAPITarget, mediaUrl);
        return { channel: "dingtalk", conversationId: "", messageId: result };
      } catch {
        const fallbackText = `📎 ${mediaUrl}`;
        const result = await sendTextViaOpenAPI({ config: resolvedCfg, target: openAPITarget, content: fallbackText });
        return { channel: "dingtalk", conversationId: "", messageId: result.processQueryKey };
      }
    }

    if (!text?.trim()) {
      const result = await sendTextViaOpenAPI({ config: resolvedCfg, target: openAPITarget, content: text ?? "" });
      return { channel: "dingtalk", conversationId: "", messageId: result.processQueryKey };
    }

    return { channel: "dingtalk", conversationId: "", messageId: "" };
  },
};

// ============ Private Helpers ============

/**
 * Resolve the first account with valid credentials for proactive sends.
 * Checks multi-account `accounts` map first, then falls back to root-level credentials.
 */
function resolveFirstConfiguredAccount(cfg: ClawdbotConfig): DingTalkConfig | null {
  const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
  if (!dingtalkCfg) return null;

  // Check accounts map first
  if (dingtalkCfg.accounts) {
    for (const accountId of Object.keys(dingtalkCfg.accounts)) {
      const resolved = resolveDingTalkAccountConfig(dingtalkCfg, accountId);
      if (resolved?.appKey && resolved?.appSecret) {
        return resolved;
      }
    }
  }

  // Fall back to root-level credentials
  if (dingtalkCfg.appKey && dingtalkCfg.appSecret) {
    return dingtalkCfg;
  }

  return null;
}

function parseOutboundTarget(to: string): OutboundTarget {
  if (to.startsWith("https://") || to.startsWith("http://")) {
    return { kind: "webhook", url: to };
  }

  const userMatch = to.match(/^(?:user|staff):(.+)$/i);
  if (userMatch) {
    return { kind: "user", id: resolveOriginalCase(userMatch[1]) };
  }

  const groupMatch = to.match(/^(?:group|chat):(.+)$/i);
  if (groupMatch) {
    return { kind: "group", id: resolveOriginalCase(groupMatch[1]) };
  }

  if (to.startsWith("cid")) {
    return { kind: "group", id: to };
  }

  // Bare ID without prefix: webhook URLs always start with http(s)://,
  // group conversationIds start with "cid", so anything else is a staffId.
  return { kind: "user", id: resolveOriginalCase(to) };
}

function isLocalPath(url: string): boolean {
  return !url.startsWith("http://") && !url.startsWith("https://");
}

async function getOapiToken(config: DingTalkConfig): Promise<string> {
  const response = await fetch(
    `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(config.appKey!)}&appsecret=${encodeURIComponent(config.appSecret!)}`,
  );

  if (!response.ok) {
    throw new Error(`[dingtalk] Failed to get oapi token: ${response.status}`);
  }

  const data = (await response.json()) as { errcode?: number; access_token?: string };
  if (data.errcode !== 0 || !data.access_token) {
    throw new Error(`[dingtalk] oapi token error: errcode=${data.errcode}`);
  }
  return data.access_token;
}

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);

async function sendMediaViaOpenAPIWithUpload(
  config: DingTalkConfig,
  target: OpenAPISendTarget,
  mediaUrl: string,
): Promise<string> {
  if (isLocalPath(mediaUrl)) {
    const fileName = path.basename(mediaUrl);
    const ext = path.extname(fileName).toLowerCase();

    if (IMAGE_EXTENSIONS.has(ext)) {
      // Local image: upload as image type, then send via sampleImageMsg.
      // DingTalk's sampleImageMsg accepts media_id directly as photoURL.
      const mediaId = await uploadFileToMediaId(config, mediaUrl, "image");
      try {
        const result = await sendImageViaOpenAPI({ config, target, photoURL: mediaId });
        return result.processQueryKey;
      } catch {
        // sampleImageMsg failed, falling back to file card
        const fileType = ext.slice(1) || "jpg";
        const result = await sendFileViaOpenAPI({ config, target, mediaId, fileName, fileType });
        return result.processQueryKey;
      }
    }

    // Non-image file
    const mediaId = await uploadFileToMediaId(config, mediaUrl);
    const fileType = ext.slice(1) || "file";
    const result = await sendFileViaOpenAPI({ config, target, mediaId, fileName, fileType });
    return result.processQueryKey;
  }

  // Remote URL: send as inline image
  const result = await sendImageViaOpenAPI({ config, target, photoURL: mediaUrl });
  return result.processQueryKey;
}

async function uploadFileToMediaId(
  config: DingTalkConfig,
  filePath: string,
  mediaType: "image" | "file" = "file",
): Promise<string> {
  const oapiToken = await getOapiToken(config);
  const fileBuffer = await fs.promises.readFile(filePath);
  const fileName = path.basename(filePath);

  const formData = new FormData();
  const blob = new Blob([fileBuffer]);
  formData.append("media", blob, fileName);

  const response = await fetch(
    `https://oapi.dingtalk.com/media/upload?access_token=${oapiToken}&type=${mediaType}`,
    { method: "POST", body: formData },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[dingtalk] Media upload failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { errcode?: number; media_id?: string };
  if (!data.media_id) {
    throw new Error(`[dingtalk] Media upload returned no media_id: errcode=${data.errcode}`);
  }
  return data.media_id;
}
