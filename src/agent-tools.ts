/**
 * Agent Tools for DingTalk Plugin.
 *
 * Registers tools that agents can invoke at runtime:
 * - dingtalk_send_card: Send an interactive ActionCard message
 * - dingtalk_list_group_members: List tracked members of a group
 * - dingtalk_mention: Send a message with @mentions (supports group via OpenAPI)
 */

import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";
import { registerApprovalTools } from "./approval.js";
import { getGroupMembers, getGroupMemberCount, getTrackedGroupIds } from "./group-members.js";
import { getCachedWebhook } from "./runtime.js";
import type { DingTalkConfig } from "./types.js";
import { resolveDingTalkAccountConfig } from "./accounts.js";

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
      const result = await handleSendCard(params);
      return { content: [{ type: "text", text: result }] };
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
      const result = await handleListGroupMembers(params);
      return { content: [{ type: "text", text: result }] };
    },
  });

  // ---- Attendance tool ----
  registerTool({
    name: "dingtalk_attendance",
    description:
      "Query DingTalk attendance records. Supports two modes: " +
      "'records' (punch clock records) and 'results' (attendance results with late/absent status).",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["records", "results"],
          description: "Query mode: 'records' for punch records, 'results' for attendance results (default: results)",
        },
        userIds: {
          type: "array",
          items: { type: "string" },
          description: "List of user staff IDs to query",
        },
        dateFrom: {
          type: "string",
          description: "Start date/time in 'yyyy-MM-dd HH:mm:ss' format",
        },
        dateTo: {
          type: "string",
          description: "End date/time in 'yyyy-MM-dd HH:mm:ss' format",
        },
        offset: { type: "number", description: "Pagination offset (results mode only)" },
        limit: { type: "number", description: "Page size, max 50 (results mode only)" },
      },
      required: ["userIds", "dateFrom", "dateTo"],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      try {
        const result = await handleAttendance(params, dingtalkConfig);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }] };
      }
    },
  });

  // ---- Calendar tool ----
  registerTool({
    name: "dingtalk_calendar",
    description:
      "Manage DingTalk calendar events. Actions: 'create' (create event), " +
      "'list' (list events), 'schedule' (check free/busy).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "list", "schedule"],
          description: "Calendar action",
        },
        userId: { type: "string", description: "Union ID of the operating user" },
        summary: { type: "string", description: "Event title (create)" },
        description: { type: "string", description: "Event description (create)" },
        startTime: { type: "string", description: "Start time ISO 8601" },
        endTime: { type: "string", description: "End time ISO 8601" },
        isAllDay: { type: "boolean", description: "All-day event (create)" },
        attendees: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" } } },
          description: "Attendee union IDs (create)",
        },
        userIds: {
          type: "array",
          items: { type: "string" },
          description: "User IDs to check schedule (schedule action)",
        },
        maxResults: { type: "number", description: "Max results (list)" },
        nextToken: { type: "string", description: "Pagination token (list)" },
      },
      required: ["action", "userId"],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      try {
        const result = await handleCalendar(params, dingtalkConfig);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }] };
      }
    },
  });

  // ---- Docs tool ----
  registerTool({
    name: "dingtalk_docs",
    description:
      "Manage DingTalk documents. Actions: 'create' (create document), 'list' (list documents).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "list"],
          description: "Document action",
        },
        workspaceId: { type: "string", description: "Workspace ID" },
        operatorId: { type: "string", description: "Operator union ID" },
        name: { type: "string", description: "Document name (create)" },
        docType: { type: "string", description: "Document type, e.g. 'alidoc' (create)" },
        parentNodeId: { type: "string", description: "Parent node ID" },
        maxResults: { type: "number", description: "Max results (list)" },
        nextToken: { type: "string", description: "Pagination token (list)" },
      },
      required: ["action", "workspaceId", "operatorId"],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      try {
        const result = await handleDocs(params, dingtalkConfig);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }] };
      }
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
        accountId: {
          type: "string",
          description: "Bot account ID (e.g. 'default', 'bot2'). Use when targeting a group belonging to a specific bot/enterprise.",
        },
      },
      required: ["text"],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      try {
        const accountId = params.accountId as string | undefined;
        const resolvedConfig = accountId
          ? resolveDingTalkAccountConfig(dingtalkConfig, accountId)
          : dingtalkConfig;
        const result = await handleMention(params, resolvedConfig);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[dingtalk][mention] execute error: ${msg}`);
        return { content: [{ type: "text", text: `Error: ${msg}` }] };
      }
    },
  });

  // Register approval tools
  registerApprovalTools(api);
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
    content = `${content} ${atTexts}`;
  }

  // Resolve sessionWebhook: prefer group-specific cache, fallback to any cached
  // When groupId is specified, ONLY use that group's cached webhook.
  // Do NOT fall back to any cached webhook (which may be a DM webhook).
  const sessionWebhook = groupId
    ? getCachedWebhook(groupId)
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

async function handleAttendance(
  params: Record<string, unknown>,
  dingtalkConfig?: DingTalkConfig,
): Promise<string> {
  if (!dingtalkConfig) return "Error: DingTalk config not available.";

  const { getAttendanceRecords, getAttendanceResults } = await import("./attendance.js");
  const userIds = params.userIds as string[];
  const dateFrom = params.dateFrom as string;
  const dateTo = params.dateTo as string;
  const mode = (params.mode as string) ?? "results";

  if (!userIds?.length || !dateFrom || !dateTo) {
    return "Error: userIds, dateFrom, and dateTo are required.";
  }

  if (mode === "records") {
    const records = await getAttendanceRecords(dingtalkConfig, {
      userIds,
      checkDateFrom: dateFrom,
      checkDateTo: dateTo,
    });
    return JSON.stringify({ mode: "records", count: records.length, records }, null, 2);
  }

  const result = await getAttendanceResults(dingtalkConfig, {
    workDateFrom: dateFrom,
    workDateTo: dateTo,
    userIdList: userIds,
    offset: params.offset as number | undefined,
    limit: params.limit as number | undefined,
  });
  return JSON.stringify({ mode: "results", count: result.records.length, hasMore: result.hasMore, records: result.records }, null, 2);
}

async function handleCalendar(
  params: Record<string, unknown>,
  dingtalkConfig?: DingTalkConfig,
): Promise<string> {
  if (!dingtalkConfig) return "Error: DingTalk config not available.";

  const { createCalendarEvent, listCalendarEvents, getSchedule } = await import("./calendar.js");
  const action = params.action as string;
  const userId = params.userId as string;

  if (!userId) return "Error: userId is required.";

  if (action === "create") {
    const summary = params.summary as string;
    if (!summary) return "Error: summary is required for create.";

    const event = await createCalendarEvent(dingtalkConfig, {
      userId,
      summary,
      description: params.description as string | undefined,
      isAllDay: params.isAllDay as boolean | undefined,
      start: params.isAllDay
        ? { date: (params.startTime as string)?.slice(0, 10) }
        : { dateTime: params.startTime as string },
      end: params.isAllDay
        ? { date: (params.endTime as string)?.slice(0, 10) }
        : { dateTime: params.endTime as string },
      attendees: params.attendees as Array<{ id?: string }> | undefined,
    });
    return JSON.stringify({ action: "created", event }, null, 2);
  }

  if (action === "list") {
    const result = await listCalendarEvents(dingtalkConfig, {
      userId,
      timeMin: params.startTime as string | undefined,
      timeMax: params.endTime as string | undefined,
      maxResults: params.maxResults as number | undefined,
      nextToken: params.nextToken as string | undefined,
    });
    return JSON.stringify({ action: "list", count: result.events.length, ...result }, null, 2);
  }

  if (action === "schedule") {
    const userIds = params.userIds as string[];
    if (!userIds?.length) return "Error: userIds is required for schedule.";

    const schedules = await getSchedule(dingtalkConfig, {
      userId,
      userIds,
      startTime: params.startTime as string,
      endTime: params.endTime as string,
    });
    return JSON.stringify({ action: "schedule", schedules }, null, 2);
  }

  return `Error: unknown action '${action}'. Use 'create', 'list', or 'schedule'.`;
}

async function handleDocs(
  params: Record<string, unknown>,
  dingtalkConfig?: DingTalkConfig,
): Promise<string> {
  if (!dingtalkConfig) return "Error: DingTalk config not available.";

  const { createDocument, listDocuments } = await import("./docs.js");
  const action = params.action as string;
  const workspaceId = params.workspaceId as string;
  const operatorId = params.operatorId as string;

  if (!workspaceId || !operatorId) return "Error: workspaceId and operatorId are required.";

  if (action === "create") {
    const name = params.name as string;
    if (!name) return "Error: name is required for create.";

    const doc = await createDocument(dingtalkConfig, {
      workspaceId,
      operatorId,
      name,
      docType: params.docType as string | undefined,
      parentNodeId: params.parentNodeId as string | undefined,
    });
    return JSON.stringify({ action: "created", doc }, null, 2);
  }

  if (action === "list") {
    const result = await listDocuments(dingtalkConfig, {
      workspaceId,
      operatorId,
      maxResults: params.maxResults as number | undefined,
      nextToken: params.nextToken as string | undefined,
      parentNodeId: params.parentNodeId as string | undefined,
    });
    return JSON.stringify({ action: "list", count: result.nodes.length, ...result }, null, 2);
  }

  return `Error: unknown action '${action}'. Use 'create' or 'list'.`;
}
