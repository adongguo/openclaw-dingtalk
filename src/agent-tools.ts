/**
 * Agent Tools for DingTalk Plugin.
 *
 * Registers tools that agents can invoke at runtime:
 * - dingtalk_send_card: Send an interactive ActionCard message
 * - dingtalk_list_group_members: List tracked members of a group
 */

import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";
import { getGroupMembers, getGroupMemberCount, getTrackedGroupIds } from "./group-members.js";

// ============ Types ============

type ToolRegistration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (params: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<string>;
};

// ============ Public Functions ============

/**
 * Register DingTalk-specific agent tools if the API supports it.
 */
export function registerDingTalkTools(api: ClawdbotPluginApi): void {
  const registerTool = (api as Record<string, unknown>).registerTool as
    | ((tool: ToolRegistration) => void)
    | undefined;

  if (!registerTool) return;

  registerTool.call(api, {
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
    handler: handleSendCard,
  });

  registerTool.call(api, {
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
    handler: handleListGroupMembers,
  });

  registerTool.call(api, {
    name: "dingtalk_mention",
    description:
      "Send a message that @mentions specific users in the current DingTalk group. " +
      "Use dingtalk_list_group_members first to get user staff IDs.",
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
      },
      required: ["text"],
    },
    handler: handleMention,
  });
}

// ============ Private Functions ============

async function handleSendCard(
  params: Record<string, unknown>,
  ctx: Record<string, unknown>,
): Promise<string> {
  const title = params.title as string | undefined;
  const text = params.text as string | undefined;

  if (!title || !text) {
    return "Error: title and text are required.";
  }

  const sessionWebhook = ctx.sessionWebhook as string | undefined;
  if (!sessionWebhook) {
    return "Error: no active sessionWebhook. This tool can only be used in response to a DingTalk message.";
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

async function handleListGroupMembers(
  params: Record<string, unknown>,
): Promise<string> {
  const groupId = params.groupId as string | undefined;

  if (groupId) {
    const members = getGroupMembers(groupId);
    const count = getGroupMemberCount(groupId);

    if (count === 0) {
      return `No tracked members for group ${groupId}. Members are discovered from incoming messages.`;
    }

    return `Group ${groupId} — ${count} known member(s):\n${members}`;
  }

  // List all tracked groups
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
  ctx: Record<string, unknown>,
): Promise<string> {
  const text = params.text as string | undefined;
  const userIds = params.userIds as string[] | undefined;
  const atAll = params.atAll as boolean | undefined;

  if (!text) {
    return "Error: text is required.";
  }

  const sessionWebhook = ctx.sessionWebhook as string | undefined;
  if (!sessionWebhook) {
    return "Error: no active sessionWebhook. This tool can only be used in response to a DingTalk message.";
  }

  try {
    const { sendViaWebhook } = await import("./send.js");

    // DingTalk requires BOTH:
    // 1. @ text in message content
    // 2. atUserIds in the at field
    let content = text;
    const atField: Record<string, unknown> = {};

    if (atAll) {
      // @所有人 needs the text "@所有人" in content
      if (!content.includes("@所有人")) {
        content = `${content} @所有人`;
      }
      atField.isAtAll = true;
    } else if (userIds && userIds.length > 0) {
      // Add @userId to content for each user (DingTalk will render as @nickname)
      const atTexts = userIds.map(id => `@${id}`).join(" ");
      if (!userIds.some(id => content.includes(`@${id}`))) {
        content = `${content} ${atTexts}`;
      }
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

    const mentionInfo = atAll 
      ? "@所有人" 
      : userIds && userIds.length > 0 
        ? `@${userIds.join(", @")}` 
        : "无@";
    
    return `Message sent with ${mentionInfo}.`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `Failed to send message: ${msg}`;
  }
}
