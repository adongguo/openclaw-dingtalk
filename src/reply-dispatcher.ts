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
import { sendMessageDingTalk, sendActionCardDingTalk } from "./send.js";
import type { DingTalkConfig } from "./types.js";
import {
  addTypingIndicator,
  removeTypingIndicator,
  type TypingIndicatorState,
} from "./typing.js";
import { processLocalImages, getOapiAccessToken } from "./media.js";

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
  sessionWebhook: string;
  client?: DWClient;
};

export function createDingTalkReplyDispatcher(params: CreateDingTalkReplyDispatcherParams) {
  const core = getDingTalkRuntime();
  const { cfg, agentId, conversationId, sessionWebhook, client } = params;

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
        typingState = await addTypingIndicator({ cfg, sessionWebhook });
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

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: typingCallbacks.onReplyStart,
      deliver: async (payload: ReplyPayload) => {
        params.runtime.log?.(`dingtalk deliver called: text=${payload.text?.slice(0, 100)}`);
        let text = payload.text ?? "";
        if (!text.trim()) {
          params.runtime.log?.(`dingtalk deliver: empty text, skipping`);
          return;
        }

        // Process local images: upload to DingTalk and replace paths with media_id
        const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
        if (dingtalkCfg && dingtalkCfg.enableMediaUpload !== false) {
          try {
            if (cachedOapiToken === undefined) {
              cachedOapiToken = await getOapiAccessToken(dingtalkCfg, client);
            }
            const log = {
              info: (msg: string) => params.runtime.log?.(msg),
              warn: (msg: string) => params.runtime.log?.(msg),
              error: (msg: string) => params.runtime.error?.(msg),
            };
            text = await processLocalImages(text, cachedOapiToken, log);
          } catch (err) {
            params.runtime.error?.(`dingtalk deliver: image processing failed: ${String(err)}`);
          }
        }

        // Check render mode: auto (default), raw, or card
        const renderMode = dingtalkCfg?.renderMode ?? "auto";

        // Determine if we should use card for this message
        const useCard =
          renderMode === "card" || (renderMode === "auto" && shouldUseCard(text));

        if (useCard) {
          // Card mode: send as ActionCard with markdown rendering
          const chunks = core.channel.text.chunkTextWithMode(text, textChunkLimit, chunkMode);
          params.runtime.log?.(`dingtalk deliver: sending ${chunks.length} card chunks to ${conversationId}`);
          for (const chunk of chunks) {
            await sendActionCardDingTalk({
              cfg,
              sessionWebhook,
              title: "Reply",
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
        params.runtime.error?.(`dingtalk ${info.kind} reply failed: ${String(err)}`);
        typingCallbacks.onIdle?.();
      },
      onIdle: typingCallbacks.onIdle,
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
