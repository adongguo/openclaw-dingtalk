/**
 * Agent Tools for DingTalk Plugin.
 *
 * Registers tools that agents can invoke at runtime:
 * - dingtalk_send_card: Send an interactive ActionCard message
 * - dingtalk_list_group_members: List tracked members of a group
 * - dingtalk_mention: Send a message with @mentions (supports group via OpenAPI)
 */

import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";
import { getGroupMembers, getGroupMemberCount, getTrackedGroupIds } from "./group-members.js";
import { getCachedWebhook } from "./runtime.js";
import type { DingTalkConfig } from "./types.js";

// ============ Public Functions ============

/**
 * Register DingTalk-specific agent tools if the API supports it.
 */
export function registerDingTalkTools(api: ClawdbotPluginApi): void {
  const registerTool = (api as Record<string, unknown>).registerTool as
    | ((tool: Record<string, unknown>) => void)
    | undefined;

  if (!registerTool) return;

  // Extract DingTalk config for OpenAPI-based tools
  const config = (api as Record<string, unknown>).config as Record<string, unknown> | undefined;
  const dingtalkConfig = (config?.channels as Record<string, unknown>)?.dingtalk as DingTalkConfig | undefined;

  registerTool({
    name: "dingtalk_send_card",
    description:
      "Send an interactive ActionCard message to the current DingTalk conversation. " +
      "ActionCards render markdown with optional action buttons.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Card title displayed in notification and chat list",
        },
        text: {
          type: "string",
          description: "Card body in markdown format",
        },
        buttons: {
          type: "array",
          description: "Optional action buttons (max 5)",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Button label" },
              actionURL: { type: "string", description: "URL to open when clicked" },
            },
            required: ["title", "actionURL"],
          },
        },
        singleTitle: {
          type: "string",
          description: "Single button label (use instead of buttons array for a single CTA)",
        },
        singleURL: {
          type: "string",
          description: "URL for the single button",
        },
      },
      required: ["title", "text"],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      return handleSendCard(params);
    },
  });

  registerTool({
    name: "dingtalk_list_group_members",
    description:
      "List tracked members of a DingTalk group. Members are discovered " +
      "passively from incoming messages (not from an API call). " +
      "Returns known members with their nicknames and staff IDs.",
    parameters: {
      type: "object",
      properties: {
        groupId: {
          type: "string",
          description: "The DingTalk group/conversation ID. If omitted, lists all tracked groups.",
        },
      },
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      return handleListGroupMembers(params);
    },
  });

  registerTool({
    name: "dingtalk_mention",
    description:
      "Send a message that @mentions specific users in the current DingTalk group. " +
      "Use dingtalk_list_group_members first to get user staff IDs. " +
      "Supports targeting a specific group via groupId parameter (uses OpenAPI).",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Message text to send",
        },
        userIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of user staff IDs to @mention",
        },
        atAll: {
          type: "boolean",
          description: "If true, @mention everyone in the group",
        },
        groupId: {
          type: "string",
          description: "Target group conversationId (e.g. cidXXX). When provided, sends via OpenAPI to that group.",
        },
      },
      required: ["text"],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      return handleMention(params, dingtalkConfig);
    },
  });
}

// ============ Private Functions ============

async function handleSendCard(params: Record<string, unknown>): Promise<string> {
  const title = params.title as string | undefined;
  const text = params.text as string | undefined;

  if (!title || !text) {
    return "Error: title and text are required.";
  }

  const sessionWebhook = getCachedWebhook();
  if (!sessionWebhook) {
    return "Error: no cached sessionWebhook. A DingTalk message must have been received first.";
  }

  try {
    const { sendViaWebhook } = await import("./send.js");
    const buttons = params.buttons as Array<{ title: string; actionURL: string }> | undefined;
    const singleTitle = params.singleTitle as string | undefined;
    const singleURL = params.singleURL as string | undefined;

    await sendViaWebhook({
      sessionWebhook,
      message: {
        msgtype: "actionCard",
        actionCard: {
          title,
          text,
          ...(buttons && buttons.length > 0 ? { btns: buttons, btnOrientation: "0" } : {}),
          ...(singleTitle ? { singleTitle } : {}),
          ...(singleURL ? { singleURL } : {}),
        },
      },
    });

    return `ActionCard "${title}" sent successfully.`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Failed to send ActionCard: ${msg}`;
  }
}

async function handleListGroupMembers(params: Record<string, unknown>): Promise<string> {
  const groupId = params.groupId as string | undefined;

  if (groupId) {
    const members = getGroupMembers(groupId);
    const count = getGroupMemberCount(groupId);

    if (count === 0) {
      return `No tracked members for group ${groupId}. Members are discovered from incoming messages.`;
    }

    return `Group ${groupId} — ${count} known member(s):\n${members}`;
  }

  const groupIds = getTrackedGroupIds();
  if (groupIds.length === 0) {
    return "No tracked groups yet. Members are discovered from incoming messages.";
  }

  const lines: string[] = [`**Tracked Groups** (${groupIds.length}):`];
  for (const gid of groupIds) {
    const count = getGroupMemberCount(gid);
    lines.push(`- \`${gid}\`: ${count} member(s)`);
  }

  return lines.join("\n");
}

async function handleMention(
  params: Record<string, unknown>,
  dingtalkConfig?: DingTalkConfig,
): Promise<string> {
  const text = (params.text ?? (params as any).command) as string | undefined;
  const rawUserIds = params.userIds;
  const userIds = Array.isArray(rawUserIds) ? rawUserIds as string[] : undefined;
  const atAll = params.atAll === true || params.atAll === "true";
  const groupId = params.groupId as string | undefined;

  if (!text) {
    return "Error: text is required.";
  }

  // Build mention content
  let content = text;
  if (atAll) {
    if (!content.includes("@所有人")) {
      content = `${content} @所有人`;
    }
  } else if (userIds && userIds.length > 0) {
    const atTexts = userIds.map(id => `@${id}`).join(" ");
    if (!userIds?.some(id => content.includes(`@${id}`))) {
      content = `${content} ${atTexts}`;
    }
  }

  // Resolve sessionWebhook: prefer group-specific cache, fallback to any cached
  const sessionWebhook = groupId
    ? getCachedWebhook(groupId) ?? getCachedWebhook()
    : getCachedWebhook();

  // Route 1: Use webhook (supports real @mention with at field)
  if (sessionWebhook) {
    // Webhook is available — use it for real @mention support
  } else if (groupId && dingtalkConfig) {
    // Route 2: Fallback to OpenAPI (no real @mention, just text)
    try {
      const { sendViaOpenAPI } = await import("./openapi-send.js");
      await sendViaOpenAPI({
        config: dingtalkConfig,
        target: { kind: "group", id: groupId },
        msgKey: "sampleText",
        msgParam: { content },
      });

      const mentionInfo = atAll ? "@所有人(文本)" : userIds?.length ? `@${userIds.join(", @")}(文本)` : "无@";
      return `Message sent to group via OpenAPI. Note: ${mentionInfo} — OpenAPI不支持真实@，需要先在群里发消息给机器人以缓存webhook。`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return `Failed to send to group: ${msg}`;
    }
  } else {
    return "Error: no cached sessionWebhook and no groupId specified. Either send a message in the target group first, or provide groupId.";
  }

  try {
    const { sendViaWebhook } = await import("./send.js");

    const atField: Record<string, unknown> = {};
    if (atAll) {
      atField.isAtAll = true;
    } else if (userIds && userIds.length > 0) {
      atField.atUserIds = userIds;
      atField.isAtAll = false;
    }

    const message: Record<string, unknown> = {
      msgtype: "text",
      text: { content },
    };

    if (Object.keys(atField).length > 0) {
      message.at = atField;
    }

    await sendViaWebhook({ sessionWebhook, message });

    const mentionInfo = atAll ? "@所有人" : userIds?.length ? `@${userIds.join(", @")}` : "无@";
    return `Message sent with ${mentionInfo}.`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Failed to send message: ${msg}`;
  }
}
