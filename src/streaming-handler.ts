/**
 * Streaming Message Handler for DingTalk
 *
 * Integrates AI Card streaming, session management, Gateway SSE,
 * and image post-processing for enhanced message handling.
 */

import type { DWClient } from "dingtalk-stream";
import type { DingTalkConfig, DingTalkIncomingMessage } from "./types.js";
import { createAICard, streamAICard, finishAICard, failAICard } from "./ai-card.js";
import { isNewSessionCommand, getSessionKey, DEFAULT_SESSION_TIMEOUT } from "./session.js";
import { streamFromGateway } from "./gateway-stream.js";
import { buildMediaSystemPrompt, processLocalImages, processFileMarkers, getOapiAccessToken } from "./media.js";
import { sendDingTalkMessage, sendDingTalkTextMessage } from "./send.js";

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
}

interface ExtractedContent {
  text: string;
  messageType: string;
}

// ============ Message Content Extraction ============

/**
 * Extract text content from incoming message.
 */
function extractMessageContent(data: DingTalkIncomingMessage): ExtractedContent {
  const msgtype = data.msgtype || "text";

  switch (msgtype) {
    case "text":
      return { text: data.text?.content?.trim() || "", messageType: "text" };
    case "richText": {
      // Parse richText if available
      if (data.content) {
        try {
          const parsed = JSON.parse(data.content);
          const parts = extractRichTextParts(parsed);
          return { text: parts || "[富文本消息]", messageType: "richText" };
        } catch {
          return { text: data.content || "[富文本消息]", messageType: "richText" };
        }
      }
      return { text: "[富文本消息]", messageType: "richText" };
    }
    case "picture":
    case "image":
      return { text: "[图片]", messageType: "picture" };
    case "voice":
      return { text: "[语音消息]", messageType: "voice" };
    case "file":
      return { text: "[文件]", messageType: "file" };
    default:
      return { text: data.text?.content?.trim() || `[${msgtype}消息]`, messageType: msgtype };
  }
}

/**
 * Extract text from richText structure.
 */
function extractRichTextParts(richText: unknown): string {
  if (!richText || typeof richText !== "object") return "";
  const parts: string[] = [];

  function traverse(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) traverse(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.text && typeof obj.text === "string") parts.push(obj.text);
    if (obj.content) traverse(obj.content);
  }

  traverse(richText);
  return parts.join("").trim();
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
  const { config, data, sessionWebhook, client, log } = params;

  // Extract message content
  const content = extractMessageContent(data);
  if (!content.text) {
    log?.info?.(`[DingTalk][Streaming] Empty message, skipping`);
    return;
  }

  const isDirect = data.conversationType === "1";
  const senderId = data.senderStaffId || data.conversationId;
  const senderName = data.senderNick || "Unknown";

  log?.info?.(`[DingTalk][Streaming] Message from ${senderName}: "${content.text.slice(0, 50)}..."`);

  // ===== Session Management =====
  const sessionTimeout = config.sessionTimeout ?? DEFAULT_SESSION_TIMEOUT;
  const forceNewSession = isNewSessionCommand(content.text);

  // Handle new session command
  if (forceNewSession) {
    const { sessionKey } = getSessionKey(senderId, true, sessionTimeout, log);
    await sendDingTalkMessage({
      sessionWebhook,
      text: "✨ 已开启新会话，之前的对话已清空。",
      useMarkdown: false,
      atUserId: !isDirect ? senderId : undefined,
      client,
    });
    log?.info?.(`[DingTalk][Streaming] New session requested: ${senderId}, key=${sessionKey}`);
    return;
  }

  // Get or create session
  const { sessionKey, isNew } = getSessionKey(senderId, false, sessionTimeout, log);
  log?.info?.(`[DingTalk][Session] key=${sessionKey}, isNew=${isNew}`);

  // ===== Build System Prompts =====
  const systemPrompts: string[] = [];
  let oapiToken: string | null = null;

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
    );

    if (card) {
      // ===== AI Card Streaming Mode =====
      log?.info?.(`[DingTalk][Streaming] AI Card created: ${card.cardInstanceId}`);

      let accumulated = "";
      let lastUpdateTime = 0;
      const updateInterval = 300; // Min update interval ms
      let chunkCount = 0;

      try {
        log?.info?.(`[DingTalk][Streaming] Starting Gateway stream...`);

        for await (const chunk of streamFromGateway({
          userContent: content.text,
          systemPrompts,
          sessionKey,
          gatewayAuth,
          gatewayPort: config.gatewayPort,
          log,
        })) {
          accumulated += chunk;
          chunkCount++;

          if (chunkCount <= 3) {
            log?.info?.(
              `[DingTalk][Streaming] Chunk #${chunkCount}: "${chunk.slice(0, 50)}..." (total=${accumulated.length})`,
            );
          }

          // Throttle updates
          const now = Date.now();
          if (now - lastUpdateTime >= updateInterval) {
            await streamAICard(card, accumulated, false, log);
            lastUpdateTime = now;
          }
        }

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

    await sendDingTalkTextMessage({
      sessionWebhook,
      text: `抱歉，处理请求时出错: ${errMsg}`,
      atUserId: !isDirect ? senderId : undefined,
      client,
    });
  }
}

/**
 * Check if streaming mode should be used based on config.
 */
export function shouldUseStreamingMode(config: DingTalkConfig): boolean {
  // Streaming mode requires Gateway integration
  return config.aiCardMode !== "disabled" && (!!config.gatewayToken || !!config.gatewayPassword);
}
