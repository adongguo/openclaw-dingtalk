/**
 * Streaming Message Handler for DingTalk
 *
 * Integrates AI Card streaming, session management, Gateway SSE,
 * and image post-processing for enhanced message handling.
 */

import type { DWClient } from "dingtalk-stream";
import type { DingTalkConfig, DingTalkIncomingMessage } from "./types.js";
import { resolveDingTalkAccountConfig } from "./accounts.js";
import { createAICard, streamAICard, finishAICard, failAICard } from "./ai-card.js";
import { getSessionKey, DEFAULT_SESSION_TIMEOUT } from "./session.js";
import { streamFromGateway } from "./gateway-stream.js";
import { buildMediaSystemPrompt, processLocalImages, processFileMarkers, getOapiAccessToken, downloadMediaDingTalk } from "./media.js";
import { sendDingTalkMessage, sendDingTalkTextMessage } from "./send.js";
import { safeParseRichText, extractRichTextContent, extractRichTextDownloadCodes } from "./richtext.js";
import { executeCommand } from "./commands.js";
import { thinkingTemplate, thinkingEnabled, errorTemplate } from "./templates.js";

// ============ Types ============

interface Logger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

export interface StreamingHandlerParams {
  config: DingTalkConfig;
  data: DingTalkIncomingMessage;
  sessionWebhook: string;
  client?: DWClient;
  log?: Logger;
  accountId?: string;
}

interface ExtractedContent {
  text: string;
  messageType: string;
  downloadCode?: string;
  downloadCodes?: string[];
}

// ============ Main Streaming Handler ============

/**
 * Handle DingTalk message with AI Card streaming.
 *
 * Flow:
 * 1. Parse incoming message
 * 2. Check for new session commands
 * 3. Get/create session key
 * 4. Build system prompts (including media prompt)
 * 5. Create AI Card for streaming
 * 6. Stream from Gateway and update AI Card
 * 7. Post-process images and finalize
 * 8. Fall back to regular message if AI Card fails
 */
export async function handleDingTalkStreamingMessage(params: StreamingHandlerParams): Promise<void> {
  const { config: rawConfig, data, sessionWebhook, client, log, accountId } = params;
  // Resolve account-specific config (merges account overrides with shared defaults)
  const config = accountId ? resolveDingTalkAccountConfig(rawConfig, accountId) : rawConfig;

  // Extract message content
  const content = extractMessageContent(data);
  if (!content.text && !content.downloadCode && (!content.downloadCodes || content.downloadCodes.length === 0)) {
    log?.info?.(`[DingTalk][Streaming] Empty message, skipping`);
    return;
  }

  // Download image(s) if present
  const downloadedImages: Array<{ base64: string; contentType: string }> = [];

  const codesToDownload: string[] = [];
  if (content.downloadCodes && content.downloadCodes.length > 0) {
    codesToDownload.push(...content.downloadCodes);
  } else if (content.downloadCode) {
    codesToDownload.push(content.downloadCode);
  }

  if (codesToDownload.length > 0 && client) {
    const cfgWrapper = { channels: { dingtalk: config } } as Parameters<typeof downloadMediaDingTalk>[0]["cfg"];
    const maxStreamingImageSize = 10 * 1024 * 1024; // 10MB per image

    for (const code of codesToDownload) {
      try {
        const mediaResult = await downloadMediaDingTalk({
          cfg: cfgWrapper,
          downloadCode: code,
          robotCode: data.robotCode || config.robotCode,
          client,
        });
        if (mediaResult) {
          if (mediaResult.buffer.length > maxStreamingImageSize) {
            const sizeMB = (mediaResult.buffer.length / 1024 / 1024).toFixed(1);
            log?.warn?.(`[DingTalk][Streaming] Image too large for streaming (${sizeMB}MB), skipping`);
          } else {
            downloadedImages.push({
              base64: mediaResult.buffer.toString("base64"),
              contentType: mediaResult.contentType || "image/png",
            });
            log?.info?.(`[DingTalk][Streaming] Downloaded image: ${mediaResult.contentType || "image/png"}, ${(mediaResult.buffer.length / 1024).toFixed(1)}KB`);
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log?.warn?.(`[DingTalk][Streaming] Failed to download image: ${errMsg}`);
      }
    }
  }

  const isDirect = data.conversationType === "1";
  const senderId = data.senderStaffId || data.conversationId;
  const senderName = data.senderNick || "Unknown";

  if (!data.senderStaffId) {
    log?.warn?.(
      `[DingTalk][Streaming] No senderStaffId for message, falling back to conversationId for session isolation`,
    );
  }

  // Apply groupSessionScope for consistent isolation with bot.ts path
  const groupSessionScope = config.groupSessionScope ?? "per-group";
  // Prefix accountId for enterprise-level isolation
  const acctPrefix = accountId ? `${accountId}:` : "";
  const sessionIdentifier = isDirect
    ? `${acctPrefix}${senderId}`
    : groupSessionScope === "per-user"
      ? `${acctPrefix}${data.conversationId}:${senderId}`
      : `${acctPrefix}${data.conversationId}`;

  log?.info?.(`[DingTalk][Streaming] Message from ${senderName}: "${content.text.slice(0, 50)}..."`);

  // Check for commands before dispatching to agent
  const commandResult = executeCommand({
    text: content.text,
    config,
    senderId,
    senderName,
    sessionIdentifier,
    sessionTimeout: config.sessionTimeout,
    log,
  });

  if (commandResult.handled) {
    try {
      await sendDingTalkMessage({
        sessionWebhook,
        text: commandResult.response,
        useMarkdown: true,
        atUserId: !isDirect ? senderId : undefined,
        client,
      });
    } catch {
      // Non-fatal: command response is best-effort
    }
    log?.info?.(`[DingTalk][Streaming] Command handled: ${content.text.trim().slice(0, 30)}`);
    return;
  }

  // Send thinking indicator (skip if AI Card mode is enabled - the card has its own visual state)
  if (config.showThinking !== false && config.aiCardMode === "disabled" && thinkingEnabled(config.templates)) {
    try {
      const thinking = thinkingTemplate(config.templates);
      await sendDingTalkTextMessage({
        sessionWebhook,
        text: thinking.text,
        client,
      });
    } catch {
      // Non-fatal: thinking indicator is best-effort
    }
  }

  // ===== Session Management =====
  const sessionTimeout = config.sessionTimeout ?? DEFAULT_SESSION_TIMEOUT;

  // Get or create session
  const { sessionKey, isNew } = getSessionKey(sessionIdentifier, false, sessionTimeout, log);
  log?.info?.(`[DingTalk][Session] key=${sessionKey}, isNew=${isNew}`);

  // ===== Build System Prompts =====
  const systemPrompts: string[] = [];
  let oapiToken: string | null = null;

  // Per-group system prompt and skills
  if (!isDirect) {
    const groupConfig = config.groups?.[data.conversationId];
    const groupSystemPrompt = groupConfig?.systemPrompt
      ?? config.groups?.["*"]?.systemPrompt;
    if (groupSystemPrompt) {
      systemPrompts.push(groupSystemPrompt);
    }
    const groupSkills = groupConfig?.skills ?? [];
    if (groupSkills.length > 0) {
      systemPrompts.push(`[可用技能] ${groupSkills.join(", ")}`);
    }
  }

  // Per-DM system prompt
  if (isDirect) {
    const dmConfig = config.dms?.[senderId];
    if (dmConfig?.systemPrompt) {
      systemPrompts.push(dmConfig.systemPrompt);
    }
  }

  // DingTalk conversation context
  systemPrompts.push(`[DingTalk Context] conversationId=${data.conversationId}, chatType=${isDirect ? "p2p" : "group"}, sender=${senderName} (${senderId})`);

  // Media upload prompt
  if (config.enableMediaUpload !== false) {
    systemPrompts.push(buildMediaSystemPrompt());
    oapiToken = await getOapiAccessToken(config, client);
    log?.info?.(`[DingTalk][Media] oapiToken: ${oapiToken ? "obtained" : "failed"}`);
  }

  // Custom system prompt
  if (config.systemPrompt) {
    systemPrompts.push(config.systemPrompt);
  }

  // ===== Gateway Auth =====
  const gatewayAuth = config.gatewayToken || config.gatewayPassword || "";

  // ===== AI Card Mode =====
  const aiCardEnabled = config.aiCardMode !== "disabled";

  if (aiCardEnabled) {
    // Try to create AI Card
    const card = await createAICard(
      config,
      {
        conversationType: data.conversationType,
        conversationId: data.conversationId,
        senderStaffId: data.senderStaffId,
        senderId: senderId,
      },
      log,
      accountId,
    );

    if (card) {
      // ===== AI Card Streaming Mode =====
      log?.info?.(`[DingTalk][Streaming] AI Card created: ${card.cardInstanceId}`);

      let accumulated = "";
      let lastUpdateTime = 0;
      const updateInterval = 300; // Min update interval ms
      let chunkCount = 0;

      // Progress heartbeat: show elapsed time when stream is silent (tool execution)
      const SILENCE_THRESHOLD_MS = 3000; // Show progress after 3s silence
      const PROGRESS_UPDATE_INTERVAL_MS = 5000; // Update progress every 5s
      let lastChunkTime = Date.now();
      let progressTimer: ReturnType<typeof setInterval> | null = null;
      let isShowingProgress = false;
      const streamStartTime = Date.now();

      const startProgressHeartbeat = () => {
        if (progressTimer) return;
        progressTimer = setInterval(async () => {
          const silenceMs = Date.now() - lastChunkTime;
          if (silenceMs >= SILENCE_THRESHOLD_MS) {
            const elapsedSec = Math.floor((Date.now() - streamStartTime) / 1000);
            const progressText = accumulated
              ? `${accumulated}\n\n⏳ *执行中... (${elapsedSec}s)*`
              : `⏳ *执行中... (${elapsedSec}s)*`;
            isShowingProgress = true;
            try {
              await streamAICard(card, progressText, false, log);
            } catch (e) {
              // Non-fatal: progress update is best-effort
            }
          }
        }, PROGRESS_UPDATE_INTERVAL_MS);
      };

      const stopProgressHeartbeat = () => {
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
      };

      try {
        log?.info?.(`[DingTalk][Streaming] Starting Gateway stream...`);
        startProgressHeartbeat();

        for await (const chunk of streamFromGateway({
          userContent: content.text,
          systemPrompts,
          sessionKey,
          gatewayAuth,
          gatewayPort: config.gatewayPort,
          images: downloadedImages.length > 0 ? downloadedImages : undefined,
          log,
        })) {
          accumulated += chunk;
          chunkCount++;
          lastChunkTime = Date.now();

          if (chunkCount <= 3) {
            log?.info?.(
              `[DingTalk][Streaming] Chunk #${chunkCount}: "${chunk.slice(0, 50)}..." (total=${accumulated.length})`,
            );
          }

          // If we were showing progress, restore actual content immediately
          if (isShowingProgress) {
            isShowingProgress = false;
            await streamAICard(card, accumulated, false, log);
            lastUpdateTime = Date.now();
            continue;
          }

          // Throttle updates
          const now = Date.now();
          if (now - lastUpdateTime >= updateInterval) {
            await streamAICard(card, accumulated, false, log);
            lastUpdateTime = now;
          }
        }

        stopProgressHeartbeat();

        log?.info?.(`[DingTalk][Streaming] Stream complete: ${chunkCount} chunks, ${accumulated.length} chars`);

        // Post-process: upload local images
        log?.info?.(
          `[DingTalk][Media] Post-processing, oapiToken=${oapiToken ? "yes" : "no"}, preview="${accumulated.slice(0, 200)}..."`,
        );
        accumulated = await processLocalImages(accumulated, oapiToken, log);

        // Post-process: extract and send file markers
        accumulated = await processFileMarkers(
          accumulated,
          { appKey: config.appKey, appSecret: config.appSecret, robotCode: config.robotCode },
          {
            conversationType: data.conversationType,
            conversationId: data.conversationId,
            senderId: senderId,
          },
          log,
        );

        // Finalize AI Card
        await finishAICard(card, accumulated, log);
        log?.info?.(`[DingTalk][Streaming] AI Card finished, ${accumulated.length} chars`);
      } catch (err: unknown) {
        stopProgressHeartbeat();
        const errMsg = err instanceof Error ? err.message : String(err);
        log?.error?.(`[DingTalk][Streaming] Gateway error: ${errMsg}`);

        // Try to show error in card
        accumulated += `\n\n⚠️ 响应中断: ${errMsg}`;
        try {
          await finishAICard(card, accumulated, log);
        } catch (finishErr: unknown) {
          const finishErrMsg = finishErr instanceof Error ? finishErr.message : String(finishErr);
          log?.error?.(`[DingTalk][Streaming] Failed to finish card with error: ${finishErrMsg}`);
          await failAICard(card, errMsg, log);
        }
      }

      return;
    }

    log?.warn?.(`[DingTalk][Streaming] AI Card creation failed, falling back to regular message`);
  }

  // ===== Fallback: Regular Message Mode =====
  let fullResponse = "";

  try {
    for await (const chunk of streamFromGateway({
      userContent: content.text,
      systemPrompts,
      sessionKey,
      gatewayAuth,
      gatewayPort: config.gatewayPort,
      images: downloadedImages.length > 0 ? downloadedImages : undefined,
      log,
    })) {
      fullResponse += chunk;
    }

    // Post-process images
    fullResponse = await processLocalImages(fullResponse, oapiToken, log);

    // Post-process: extract and send file markers
    fullResponse = await processFileMarkers(
      fullResponse,
      { appKey: config.appKey, appSecret: config.appSecret, robotCode: config.robotCode },
      {
        conversationType: data.conversationType,
        conversationId: data.conversationId,
        senderId: senderId,
      },
      log,
    );

    await sendDingTalkMessage({
      sessionWebhook,
      text: fullResponse || "（无响应）",
      useMarkdown: true,
      atUserId: !isDirect ? senderId : undefined,
      client,
    });

    log?.info?.(`[DingTalk][Streaming] Regular message sent, ${fullResponse.length} chars`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log?.error?.(`[DingTalk][Streaming] Gateway error: ${errMsg}`);

    const errTemplate = errorTemplate(errMsg, config.templates);
    await sendDingTalkTextMessage({
      sessionWebhook,
      text: errTemplate.text,
      atUserId: !isDirect ? senderId : undefined,
      client,
    });
  }
}

/**
 * Check if streaming mode should be used based on config.
 */
export function shouldUseStreamingMode(config: DingTalkConfig): boolean {
  return config.aiCardMode !== "disabled" && (!!config.gatewayToken || !!config.gatewayPassword);
}

// ============ Private Functions ============

function extractMessageContent(data: DingTalkIncomingMessage): ExtractedContent {
  const msgtype = data.msgtype || "text";

  switch (msgtype) {
    case "text":
      return { text: data.text?.content?.trim() || "", messageType: "text" };
    case "richText": {
      if (data.content) {
        const parsed = safeParseRichText(data.content);
        if (parsed) {
          const text = extractRichTextContent(parsed);
          const codes = extractRichTextDownloadCodes(parsed);
          return {
            text,
            messageType: "richText",
            downloadCodes: codes.length > 0 ? codes : undefined,
          };
        }
        return { text: typeof data.content === "string" ? data.content : "[富文本消息]", messageType: "richText" };
      }
      return { text: "[富文本消息]", messageType: "richText" };
    }
    case "picture":
    case "image":
      return { text: "用户发送了一张图片", messageType: "picture", downloadCode: data.downloadCode };
    case "voice":
      return { text: "[语音消息]", messageType: "voice" };
    case "file":
      return { text: "[文件]", messageType: "file" };
    default:
      return { text: data.text?.content?.trim() || `[${msgtype}消息]`, messageType: msgtype };
  }
}
