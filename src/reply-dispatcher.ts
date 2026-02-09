import type { DWClient } from "dingtalk-stream";
import {
  createReplyPrefixContext,
  createTypingCallbacks,
  logTypingFailure,
  type ClawdbotConfig,
  type RuntimeEnv,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import { getDingTalkRuntime } from "./runtime.js";
import { sendMessageDingTalk, sendActionCardDingTalk, sendMarkdownDingTalk } from "./send.js";
import type { DingTalkConfig } from "./types.js";
import { resolveDingTalkAccountConfig } from "./accounts.js";
import {
  addTypingIndicator,
  removeTypingIndicator,
  type TypingIndicatorState,
} from "./typing.js";
import { processLocalImages, processFileMarkers, getOapiAccessToken } from "./media.js";
import { resolveWebhook, getLatestWebhookForSender } from "./runtime.js";

/**
 * Detect if text contains markdown elements that benefit from card rendering.
 * Used by auto render mode.
 */
function shouldUseCard(text: string): boolean {
  // Code blocks (fenced)
  if (/```[\s\S]*?```/.test(text)) return true;
  // Tables (at least header + separator row with |)
  if (/\|.+\|[\r\n]+\|[-:| ]+\|/.test(text)) return true;
  // Markdown images (including media_id references like @lAD...)
  if (/!\[.*?\]\(.+?\)/.test(text)) return true;
  return false;
}

export type CreateDingTalkReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  conversationId: string;
  conversationType: "1" | "2";
  senderId?: string;
  sessionWebhook: string;
  client?: DWClient;
  accountId?: string;
};

export function createDingTalkReplyDispatcher(params: CreateDingTalkReplyDispatcherParams) {
  const core = getDingTalkRuntime();
  const { cfg, agentId, client } = params;
  // These are the INITIAL values from the triggering message.
  // For DMs, the actual webhook/conversationId may change if the user
  // sends from a different client before the agent replies.
  const initialConversationId = params.conversationId;
  const initialSessionWebhook = params.sessionWebhook;

  const prefixContext = createReplyPrefixContext({
    cfg,
    agentId,
  });

  // Lazily cached oapi token for image uploads in deliver callback
  let cachedOapiToken: string | null | undefined;

  // DingTalk doesn't have a native typing indicator API.
  // We could use emoji reactions if available.
  let typingState: TypingIndicatorState | null = null;

  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      // DingTalk typing indicator is optional and may not work for all bots
      try {
        // Resolve latest webhook for typing indicator too
        const latestWebhook = resolveWebhook({
          conversationId: initialConversationId,
          senderId: params.conversationType !== "2" ? params.senderId : undefined,
        }) ?? initialSessionWebhook;
        typingState = await addTypingIndicator({ cfg, sessionWebhook: latestWebhook });
        params.runtime.log?.(`dingtalk: added typing indicator`);
      } catch {
        // Typing indicator not available, ignore
      }
    },
    stop: async () => {
      if (!typingState) return;
      try {
        await removeTypingIndicator({ cfg, state: typingState });
        typingState = null;
        params.runtime.log?.(`dingtalk: removed typing indicator`);
      } catch {
        // Ignore errors
      }
    },
    onStartError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "dingtalk",
        action: "start",
        error: err,
      });
    },
    onStopError: (err) => {
      logTypingFailure({
        log: (message) => params.runtime.log?.(message),
        channel: "dingtalk",
        action: "stop",
        error: err,
      });
    },
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit({
    cfg,
    channel: "dingtalk",
    defaultLimit: 4000,
  });
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "dingtalk");
  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg,
    channel: "dingtalk",
  });

  // Progress heartbeat: send periodic "executing..." messages during long agent runs
  const PROGRESS_DELAY_MS = 8000;  // Wait 8s before first progress message
  const PROGRESS_INTERVAL_MS = 15000; // Then update every 15s
  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  let progressIntervalTimer: ReturnType<typeof setInterval> | null = null;
  const progressStartTime = Date.now();

  const startProgressHeartbeat = () => {
    // After initial delay, send first progress then start interval
    progressTimer = setTimeout(async () => {
      const elapsedSec = Math.floor((Date.now() - progressStartTime) / 1000);
      try {
        await sendMessageDingTalk({
          cfg,
          sessionWebhook,
          text: `⏳ 执行中... (${elapsedSec}s)`,
          client,
        });
      } catch { /* best-effort */ }

      progressIntervalTimer = setInterval(async () => {
        const elapsed = Math.floor((Date.now() - progressStartTime) / 1000);
        try {
          await sendMessageDingTalk({
            cfg,
            sessionWebhook,
            text: `⏳ 仍在执行中... (${elapsed}s)`,
            client,
          });
        } catch { /* best-effort */ }
      }, PROGRESS_INTERVAL_MS);
    }, PROGRESS_DELAY_MS);
  };

  const stopProgressHeartbeat = () => {
    if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
    if (progressIntervalTimer) { clearInterval(progressIntervalTimer); progressIntervalTimer = null; }
  };

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: (...args: Parameters<typeof typingCallbacks.onReplyStart>) => {
        startProgressHeartbeat();
        return typingCallbacks.onReplyStart(...args);
      },
      deliver: async (payload: ReplyPayload) => {
        stopProgressHeartbeat();
        // Dynamically resolve the latest webhook for this sender/conversation.
        // This handles the case where the same user DMs from different clients
        // (each producing a different conversationId/webhook).
        const isGroup = params.conversationType === "2";
        const resolved = resolveWebhook({
          conversationId: initialConversationId,
          senderId: isGroup ? undefined : params.senderId,
        });
        const sessionWebhook = resolved ?? initialSessionWebhook;
        const conversationId = isGroup
          ? initialConversationId
          : (getLatestWebhookForSender(params.senderId ?? "")?.conversationId ?? initialConversationId);

        params.runtime.log?.(`dingtalk deliver called: conv=${conversationId} webhook=${sessionWebhook !== initialSessionWebhook ? "RESOLVED_NEW" : "original"} account=${params.accountId ?? "default"} text=${payload.text?.slice(0, 80)}`);
        let text = payload.text ?? "";
        if (!text.trim()) {
          params.runtime.log?.(`dingtalk deliver: empty text, skipping`);
          return;
        }

        // Process local images: upload to DingTalk and replace paths with media_id
        const dingtalkCfg = resolveDingTalkAccountConfig(
          cfg.channels?.dingtalk as DingTalkConfig | undefined,
          params.accountId,
        );
        const log = {
          info: (msg: string) => params.runtime.log?.(msg),
          warn: (msg: string) => params.runtime.log?.(msg),
          error: (msg: string) => params.runtime.error?.(msg),
        };

        // Process file markers first: upload and send files as separate messages
        if (dingtalkCfg?.appKey && dingtalkCfg?.appSecret) {
          try {
            text = await processFileMarkers(
              text,
              {
                appKey: dingtalkCfg.appKey,
                appSecret: dingtalkCfg.appSecret,
                robotCode: dingtalkCfg.robotCode,
              },
              {
                conversationType: params.conversationType,
                conversationId: params.conversationId,
                senderId: params.senderId,
              },
              log,
            );
          } catch (err) {
            params.runtime.error?.(`dingtalk deliver: file processing failed: ${String(err)}`);
          }
        }

        // Process local images
        if (dingtalkCfg && dingtalkCfg.enableMediaUpload !== false) {
          try {
            if (cachedOapiToken === undefined) {
              cachedOapiToken = await getOapiAccessToken(dingtalkCfg, client);
            }
            text = await processLocalImages(text, cachedOapiToken, log);
          } catch (err) {
            params.runtime.error?.(`dingtalk deliver: image processing failed: ${String(err)}`);
          }
        }

        // Check render mode: auto (default), raw, card, or markdown
        const renderMode = dingtalkCfg?.renderMode ?? "auto";

        // Determine which message type to use
        const useCard =
          renderMode === "card" || (renderMode === "auto" && shouldUseCard(text));
        const useMarkdown = renderMode === "markdown";

        const title = generateTitle(text);

        if (useCard) {
          // Card mode: send as ActionCard with markdown rendering (NOT shareable)
          const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
          params.runtime.log?.(`dingtalk deliver: sending ${chunks.length} card chunks to ${conversationId}`);
          for (const chunk of chunks) {
            await sendActionCardDingTalk({
              cfg,
              sessionWebhook,
              title,
              text: chunk,
              client,
            });
          }
        } else if (useMarkdown) {
          // Markdown mode: send as markdown message (shareable, limited markdown support)
          const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
          params.runtime.log?.(`dingtalk deliver: sending ${chunks.length} markdown chunks to ${conversationId}`);
          for (const chunk of chunks) {
            await sendMarkdownDingTalk({
              cfg,
              sessionWebhook,
              title,
              text: chunk,
              client,
            });
          }
        } else {
          // Raw mode: send as plain text with table conversion
          const converted = core.channel.text.convertMarkdownTables(text, tableMode);
          const chunks = core.channel.text.chunkTextWithMode(converted, textChunkLimit, chunkMode);
          params.runtime.log?.(`dingtalk deliver: sending ${chunks.length} text chunks to ${conversationId}`);
          for (const chunk of chunks) {
            await sendMessageDingTalk({
              cfg,
              sessionWebhook,
              text: chunk,
              client,
            });
          }
        }
      },
      onError: (err, info) => {
        stopProgressHeartbeat();
        params.runtime.error?.(`dingtalk ${info.kind} reply failed: ${String(err)}`);
        typingCallbacks.onIdle?.();
      },
      onIdle: () => {
        stopProgressHeartbeat();
        typingCallbacks.onIdle?.();
      },
    });

  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,
      onModelSelected: prefixContext.onModelSelected,
    },
    markDispatchIdle,
  };
}

// ============ Private Functions ============

const TITLE_MAX_LENGTH = 20;

/**
 * Generate a dynamic title from message content.
 * Strips markdown symbols, takes first 20 characters, adds ellipsis if truncated.
 */
function generateTitle(text: string): string {
  const stripped = text
    .replace(/!\[.*?\]\(.*?\)/g, "")   // remove images ![alt](url)
    .replace(/\[([^\]]*)\]\(.*?\)/g, "$1") // links → link text
    .replace(/```[\s\S]*?```/g, "")     // remove fenced code blocks
    .replace(/`([^`]*)`/g, "$1")        // inline code → content
    .replace(/#{1,6}\s*/g, "")          // remove heading markers
    .replace(/[*_~>|\\-]{1,3}/g, "")    // remove emphasis / blockquote / hr markers
    .replace(/\n+/g, " ")              // collapse newlines
    .trim();

  if (!stripped) return "Reply";

  return stripped.length > TITLE_MAX_LENGTH
    ? `${stripped.slice(0, TITLE_MAX_LENGTH)}...`
    : stripped;
}
