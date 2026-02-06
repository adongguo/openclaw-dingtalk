import type { DWClient } from "dingtalk-stream";
import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import {
  buildPendingHistoryContextFromMap,
  recordPendingHistoryEntryIfEnabled,
  clearHistoryEntriesIfEnabled,
  DEFAULT_GROUP_HISTORY_LIMIT,
  type HistoryEntry,
} from "openclaw/plugin-sdk";
import type { DingTalkConfig, DingTalkMessageContext, DingTalkMediaInfo, DingTalkIncomingMessage } from "./types.js";
import { getDingTalkRuntime } from "./runtime.js";
import {
  resolveDingTalkGroupConfig,
  resolveDingTalkAllowlistMatch,
  isDingTalkGroupAllowed,
} from "./policy.js";
import { createDingTalkReplyDispatcher } from "./reply-dispatcher.js";
import { downloadMediaDingTalk } from "./media.js";
import { safeParseRichText, extractRichTextContent, extractRichTextDownloadCodes } from "./richtext.js";

export function parseDingTalkMessage(message: DingTalkIncomingMessage): DingTalkMessageContext {
  const rawContent = parseMessageContent(message);
  const mentionedBot = checkBotMentioned(message);
  const content = stripBotMention(rawContent);
  const isGroup = message.conversationType === "2";

  return {
    conversationId: message.conversationId,
    messageId: message.msgId,
    senderId: message.senderStaffId || "",
    senderNick: message.senderNick,
    chatType: isGroup ? "group" : "p2p",
    mentionedBot,
    sessionWebhook: message.sessionWebhook,
    sessionWebhookExpiredTime: message.sessionWebhookExpiredTime,
    content,
    contentType: message.msgtype,
    robotCode: message.robotCode,
    chatbotCorpId: message.chatbotCorpId,
    isAdmin: message.isAdmin,
  };
}

export async function handleDingTalkMessage(params: {
  cfg: ClawdbotConfig;
  message: DingTalkIncomingMessage;
  runtime?: RuntimeEnv;
  chatHistories?: Map<string, HistoryEntry[]>;
  client?: DWClient;
}): Promise<void> {
  const { cfg, message, runtime, chatHistories, client } = params;
  const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  const ctx = parseDingTalkMessage(message);
  const isGroup = ctx.chatType === "group";

  log(`dingtalk: received message from ${ctx.senderNick} (${ctx.senderId}) in ${ctx.conversationId} (${ctx.chatType})`);

  const historyLimit = Math.max(
    0,
    dingtalkCfg?.historyLimit ?? cfg.messages?.groupChat?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT,
  );

  if (isGroup) {
    const groupPolicy = dingtalkCfg?.groupPolicy ?? "open";
    const groupAllowFrom = dingtalkCfg?.groupAllowFrom ?? [];
    const groupConfig = resolveDingTalkGroupConfig({ cfg: dingtalkCfg, groupId: ctx.conversationId });

    const senderAllowFrom = groupConfig?.allowFrom ?? groupAllowFrom;
    const allowed = isDingTalkGroupAllowed({
      groupPolicy,
      allowFrom: senderAllowFrom,
      senderId: ctx.senderId,
      senderName: ctx.senderNick,
    });

    if (!allowed) {
      log(`dingtalk: sender ${ctx.senderId} not in group allowlist`);
      return;
    }
    // Note: Group messages require @mention to reach the bot - this is a DingTalk platform limitation.
    // The bot only receives messages where it was mentioned, so no additional check is needed here.
  } else {
    const dmPolicy = dingtalkCfg?.dmPolicy ?? "pairing";
    const allowFrom = dingtalkCfg?.allowFrom ?? [];

    if (dmPolicy === "allowlist") {
      const match = resolveDingTalkAllowlistMatch({
        allowFrom,
        senderId: ctx.senderId,
      });
      if (!match.allowed) {
        log(`dingtalk: sender ${ctx.senderId} not in DM allowlist`);
        return;
      }
    }
  }

  try {
    const core = getDingTalkRuntime();

    const dingtalkFrom = isGroup ? `dingtalk:group:${ctx.conversationId}` : `dingtalk:${ctx.senderId}`;
    const dingtalkTo = isGroup ? `chat:${ctx.conversationId}` : `user:${ctx.senderId}`;

    const groupSessionScope = dingtalkCfg?.groupSessionScope ?? "per-group";
    const groupPeerId =
      groupSessionScope === "per-user"
        ? `${ctx.conversationId}:${ctx.senderId}`
        : ctx.conversationId;

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "dingtalk",
      peer: {
        kind: isGroup ? "group" : "dm",
        id: isGroup ? groupPeerId : ctx.senderId,
      },
    });

    const preview = (typeof ctx.content === "string" ? ctx.content : String(ctx.content || "")).replace(/\s+/g, " ").slice(0, 160);
    const inboundLabel = isGroup
      ? `DingTalk message in group ${ctx.conversationId}`
      : `DingTalk DM from ${ctx.senderNick}`;

    core.system.enqueueSystemEvent(`${inboundLabel}: ${preview}`, {
      sessionKey: route.sessionKey,
      contextKey: `dingtalk:message:${ctx.conversationId}:${ctx.messageId}`,
    });

    // Resolve media from message
    const mediaMaxBytes = (dingtalkCfg?.mediaMaxMb ?? 30) * 1024 * 1024; // 30MB default
    const mediaList = await resolveDingTalkMediaList({
      cfg,
      message,
      maxBytes: mediaMaxBytes,
      log,
      client,
    });
    const mediaPayload = buildDingTalkMediaPayload(mediaList);

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);

    const body = core.channel.reply.formatAgentEnvelope({
      channel: "DingTalk",
      from: isGroup ? ctx.conversationId : ctx.senderNick || ctx.senderId,
      timestamp: new Date(),
      envelope: envelopeOptions,
      body: ctx.content,
    });

    let combinedBody = body;
    const historyKey = isGroup ? ctx.conversationId : undefined;

    if (isGroup && historyKey && chatHistories) {
      combinedBody = buildPendingHistoryContextFromMap({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
        currentMessage: combinedBody,
        formatEntry: (entry) =>
          core.channel.reply.formatAgentEnvelope({
            channel: "DingTalk",
            from: ctx.conversationId,
            timestamp: entry.timestamp,
            body: `${entry.sender}: ${entry.body}`,
            envelope: envelopeOptions,
          }),
      });
    }

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: combinedBody,
      RawBody: ctx.content,
      CommandBody: ctx.content,
      From: dingtalkFrom,
      To: dingtalkTo,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: isGroup ? "group" : "direct",
      GroupSubject: isGroup ? ctx.conversationId : undefined,
      SenderName: ctx.senderNick || ctx.senderId,
      SenderId: ctx.senderId,
      Provider: "dingtalk" as const,
      Surface: "dingtalk" as const,
      MessageSid: ctx.messageId,
      Timestamp: Date.now(),
      WasMentioned: ctx.mentionedBot,
      CommandAuthorized: true,
      OriginatingChannel: "dingtalk" as const,
      OriginatingTo: dingtalkTo,
      ...mediaPayload,
    });

    const { dispatcher, replyOptions, markDispatchIdle } = createDingTalkReplyDispatcher({
      cfg,
      agentId: route.agentId,
      runtime: runtime as RuntimeEnv,
      conversationId: ctx.conversationId,
      sessionWebhook: ctx.sessionWebhook,
      client,
    });

    log(`dingtalk: dispatching to agent (session=${route.sessionKey})`);

    const { queuedFinal, counts } = await core.channel.reply.dispatchReplyFromConfig({
      ctx: ctxPayload,
      cfg,
      dispatcher,
      replyOptions,
    });

    markDispatchIdle();

    if (isGroup && historyKey && chatHistories) {
      clearHistoryEntriesIfEnabled({
        historyMap: chatHistories,
        historyKey,
        limit: historyLimit,
      });
    }

    log(`dingtalk: dispatch complete (queuedFinal=${queuedFinal}, replies=${counts.final})`);
  } catch (err) {
    error(`dingtalk: failed to dispatch message: ${String(err)}`);
  }
}

// ============ Private Functions ============

function parseMessageContent(message: DingTalkIncomingMessage): string {
  if (message.msgtype === "text" && message.text?.content) {
    return message.text.content.trim();
  }
  if (message.msgtype === "richText" && message.content) {
    const parsed = safeParseRichText(message.content);
    if (parsed) {
      const extracted = extractRichTextContent(parsed);
      // Ensure we always return a string
      return typeof extracted === "string" ? extracted : "[富文本消息]";
    }
    return typeof message.content === "string" ? message.content : "[富文本消息]";
  }
  return describeMediaMessage(message);
}

function checkBotMentioned(message: DingTalkIncomingMessage): boolean {
  if (message.isInAtList) return true;
  if (message.atUsers && message.atUsers.length > 0) return true;
  return false;
}

function stripBotMention(text: string): string {
  if (typeof text !== "string") return "";
  return text.replace(/^@\S+\s*/g, "").trim();
}

function inferPlaceholder(msgtype: string): string {
  switch (msgtype) {
    case "image":
    case "picture":
      return "<media:image>";
    case "file":
      return "<media:document>";
    case "voice":
      return "<media:audio>";
    case "video":
      return "<media:video>";
    default:
      return "<media:document>";
  }
}

async function resolveDingTalkMediaList(params: {
  cfg: ClawdbotConfig;
  message: DingTalkIncomingMessage;
  maxBytes: number;
  log?: (msg: string) => void;
  client?: DWClient;
}): Promise<DingTalkMediaInfo[]> {
  const { cfg, message, maxBytes, log, client } = params;

  // Collect downloadCodes to process
  const downloadEntries: Array<{ code: string; placeholder: string }> = [];

  if (message.msgtype === "richText" && message.content) {
    const parsed = safeParseRichText(message.content);
    if (parsed) {
      const codes = extractRichTextDownloadCodes(parsed);
      for (const code of codes) {
        downloadEntries.push({ code, placeholder: "<media:image>" });
      }
    }
  } else {
    const mediaTypes = ["image", "picture", "file", "voice", "video"];
    if (!mediaTypes.includes(message.msgtype)) {
      return [];
    }
    if (!message.downloadCode) {
      log?.(`dingtalk: no downloadCode for ${message.msgtype} message`);
      return [];
    }
    downloadEntries.push({
      code: message.downloadCode,
      placeholder: inferPlaceholder(message.msgtype),
    });
  }

  if (downloadEntries.length === 0) {
    return [];
  }

  const out: DingTalkMediaInfo[] = [];
  const core = getDingTalkRuntime();

  for (const entry of downloadEntries) {
    try {
      const result = await downloadMediaDingTalk({
        cfg,
        downloadCode: entry.code,
        robotCode: message.robotCode,
        client,
      });

      if (!result) {
        log?.(`dingtalk: failed to download media (code=${entry.code.slice(0, 8)}...)`);
        continue;
      }

      const contentType = result.contentType
        || await core.media.detectMime({ buffer: result.buffer });

      const saved = await core.channel.media.saveMediaBuffer(
        result.buffer,
        contentType,
        "inbound",
        maxBytes,
      );

      out.push({
        path: saved.path,
        contentType: saved.contentType,
        placeholder: entry.placeholder,
      });

      log?.(`dingtalk: downloaded media, saved to ${saved.path}`);
    } catch (err) {
      log?.(`dingtalk: failed to download media: ${String(err)}`);
    }
  }

  return out;
}

function buildDingTalkMediaPayload(
  mediaList: DingTalkMediaInfo[],
): {
  MediaPath?: string;
  MediaType?: string;
  MediaUrl?: string;
  MediaPaths?: string[];
  MediaUrls?: string[];
  MediaTypes?: string[];
} {
  const first = mediaList[0];
  const mediaPaths = mediaList.map((media) => media.path);
  const mediaTypes = mediaList.map((media) => media.contentType).filter(Boolean) as string[];
  return {
    MediaPath: first?.path,
    MediaType: first?.contentType,
    MediaUrl: first?.path,
    MediaPaths: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaUrls: mediaPaths.length > 0 ? mediaPaths : undefined,
    MediaTypes: mediaTypes.length > 0 ? mediaTypes : undefined,
  };
}

function describeMediaMessage(message: DingTalkIncomingMessage): string {
  switch (message.msgtype) {
    case "image":
    case "picture":
      return "用户发送了一张图片";
    case "file":
      return "用户发送了一个文件";
    case "voice":
      return message.recognition
        ? `用户发送了一条语音消息，语音识别内容: ${message.recognition}`
        : "用户发送了一条语音消息";
    case "video":
      return "用户发送了一个视频";
    default:
      return `[${message.msgtype}]`;
  }
}
