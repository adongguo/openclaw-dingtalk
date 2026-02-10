/**
 * Message actions adapter for DingTalk.
 *
 * Implements ChannelMessageActionAdapter to integrate with OpenClaw's
 * `message` tool routing. Supports send, broadcast, sendAttachment,
 * and member-info actions.
 */

import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionContext,
  ChannelMessageActionName,
} from "openclaw/plugin-sdk";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk";
import type { DingTalkConfig } from "./types.js";
import { resolveDingTalkAccountConfig, listDingTalkAccountIds } from "./accounts.js";
import {
  sendTextViaOpenAPI,
  sendMarkdownViaOpenAPI,
  sendFileViaOpenAPI,
  sendActionCardViaOpenAPI,
  type OpenAPISendTarget,
} from "./openapi-send.js";
import { recallMessage, getReadReceipt, pinMessage } from "./message-ops.js";
import { uploadAndSendFile } from "./media.js";
import {
  getGroupMembers,
  getGroupMemberCount,
  getTrackedGroupIds,
} from "./group-members.js";
import {
  renameGroup,
  addGroupMembers,
  removeGroupMembers,
} from "./group-manage.js";

// ============ Helpers ============

function resolveConfig(
  cfg: ChannelMessageActionContext["cfg"],
  accountId?: string | null,
): DingTalkConfig {
  const raw = cfg.channels?.dingtalk as DingTalkConfig | undefined;
  return resolveDingTalkAccountConfig(raw, accountId ?? undefined);
}

function parseTarget(to: string): OpenAPISendTarget {
  // user:<staffId> → DM, otherwise treat as group conversationId
  if (to.startsWith("user:")) {
    return { kind: "user", id: to.slice(5) };
  }
  if (to.startsWith("staff:")) {
    return { kind: "user", id: to.slice(6) };
  }
  return { kind: "group", id: to };
}

function hasCredentials(config: DingTalkConfig): boolean {
  return Boolean(config.appKey && config.appSecret);
}

// ============ Action Handlers ============

async function handleSend(
  params: Record<string, unknown>,
  cfg: ChannelMessageActionContext["cfg"],
  accountId?: string | null,
) {
  const to = readStringParam(params, "target") ?? readStringParam(params, "to");
  if (!to) {
    return jsonResult({ error: "Missing required parameter: target (or to)" });
  }

  const message = readStringParam(params, "message") ?? readStringParam(params, "text") ?? "";
  const title = readStringParam(params, "title");
  const config = resolveConfig(cfg, accountId);

  if (!hasCredentials(config)) {
    return jsonResult({ error: "DingTalk credentials not configured (appKey/appSecret)" });
  }

  const target = parseTarget(to);

  // If title is provided, send as markdown; otherwise plain text
  if (title) {
    const result = await sendMarkdownViaOpenAPI({ config, target, title, text: message });
    return jsonResult({ ok: true, processQueryKey: result.processQueryKey });
  }

  const result = await sendTextViaOpenAPI({ config, target, content: message });
  return jsonResult({ ok: true, processQueryKey: result.processQueryKey });
}

async function handleBroadcast(
  params: Record<string, unknown>,
  cfg: ChannelMessageActionContext["cfg"],
  accountId?: string | null,
) {
  const message = readStringParam(params, "message") ?? readStringParam(params, "text") ?? "";
  const title = readStringParam(params, "title");
  const targetsRaw = params.targets;

  if (!message && !title) {
    return jsonResult({ error: "Missing required parameter: message" });
  }

  const config = resolveConfig(cfg, accountId);
  if (!hasCredentials(config)) {
    return jsonResult({ error: "DingTalk credentials not configured (appKey/appSecret)" });
  }

  // Resolve target list
  let targets: string[] = [];
  if (Array.isArray(targetsRaw)) {
    targets = targetsRaw.map(String).filter(Boolean);
  } else if (typeof targetsRaw === "string") {
    targets = targetsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  }

  if (targets.length === 0) {
    return jsonResult({ error: "Missing required parameter: targets (array of user/group IDs)" });
  }

  const results: Array<{ target: string; ok: boolean; error?: string }> = [];

  for (const to of targets) {
    try {
      const target = parseTarget(to);
      if (title) {
        await sendMarkdownViaOpenAPI({ config, target, title, text: message });
      } else {
        await sendTextViaOpenAPI({ config, target, content: message });
      }
      results.push({ target: to, ok: true });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({ target: to, ok: false, error: errMsg });
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  return jsonResult({
    ok: successCount > 0,
    sent: successCount,
    failed: results.length - successCount,
    results,
  });
}

async function handleSendAttachment(
  params: Record<string, unknown>,
  cfg: ChannelMessageActionContext["cfg"],
  accountId?: string | null,
) {
  const to = readStringParam(params, "target") ?? readStringParam(params, "to");
  if (!to) {
    return jsonResult({ error: "Missing required parameter: target (or to)" });
  }

  const filePath = readStringParam(params, "filePath") ?? readStringParam(params, "path") ?? readStringParam(params, "media");
  if (!filePath) {
    return jsonResult({ error: "Missing required parameter: filePath (or path, media)" });
  }

  const fileName = readStringParam(params, "filename") ?? readStringParam(params, "name");
  const config = resolveConfig(cfg, accountId);

  if (!hasCredentials(config)) {
    return jsonResult({ error: "DingTalk credentials not configured (appKey/appSecret)" });
  }

  const target = parseTarget(to);
  const conversationType = target.kind === "user" ? "1" as const : "2" as const;

  const success = await uploadAndSendFile(
    filePath,
    fileName ?? undefined,
    { appKey: config.appKey!, appSecret: config.appSecret!, robotCode: config.robotCode },
    {
      conversationType,
      conversationId: target.id,
      senderId: target.kind === "user" ? target.id : undefined,
    },
  );

  if (!success) {
    return jsonResult({ error: `Failed to upload and send file: ${filePath}` });
  }

  return jsonResult({ ok: true, filePath, target: to });
}

async function handleMemberInfo(
  params: Record<string, unknown>,
) {
  const groupId = readStringParam(params, "groupId") ?? readStringParam(params, "channelId");

  if (groupId) {
    const members = getGroupMembers(groupId);
    const count = getGroupMemberCount(groupId);
    return jsonResult({
      groupId,
      memberCount: count,
      members: members || "(no members tracked yet — members are discovered from incoming messages)",
    });
  }

  // No groupId: return summary of all tracked groups
  const groupIds = getTrackedGroupIds();
  const summary = groupIds.map((id) => ({
    groupId: id,
    memberCount: getGroupMemberCount(id),
  }));

  return jsonResult({
    trackedGroups: summary.length,
    groups: summary,
    hint: "Provide groupId for detailed member list. Members are tracked passively from incoming messages.",
  });
}

// ============ Group Management Handlers ============

async function handleRenameGroup(
  params: Record<string, unknown>,
  cfg: ChannelMessageActionContext["cfg"],
  accountId?: string | null,
) {
  const chatId = readStringParam(params, "groupId") ?? readStringParam(params, "channelId");
  if (!chatId) {
    return jsonResult({ error: "Missing required parameter: groupId (or channelId)" });
  }
  const name = readStringParam(params, "name");
  if (!name) {
    return jsonResult({ error: "Missing required parameter: name" });
  }
  const config = resolveConfig(cfg, accountId);
  if (!hasCredentials(config)) {
    return jsonResult({ error: "DingTalk credentials not configured (appKey/appSecret)" });
  }
  await renameGroup(chatId, name, config);
  return jsonResult({ ok: true, chatId, name });
}

async function handleAddParticipant(
  params: Record<string, unknown>,
  cfg: ChannelMessageActionContext["cfg"],
  accountId?: string | null,
) {
  const chatId = readStringParam(params, "groupId") ?? readStringParam(params, "channelId");
  if (!chatId) {
    return jsonResult({ error: "Missing required parameter: groupId (or channelId)" });
  }
  const userId = readStringParam(params, "userId");
  const userIdsRaw = params.userIds;
  let userIds: string[] = [];
  if (Array.isArray(userIdsRaw)) {
    userIds = userIdsRaw.map(String).filter(Boolean);
  } else if (userId) {
    userIds = [userId];
  }
  if (userIds.length === 0) {
    return jsonResult({ error: "Missing required parameter: userId or userIds" });
  }
  const config = resolveConfig(cfg, accountId);
  if (!hasCredentials(config)) {
    return jsonResult({ error: "DingTalk credentials not configured (appKey/appSecret)" });
  }
  await addGroupMembers(chatId, userIds, config);
  return jsonResult({ ok: true, chatId, added: userIds });
}

async function handleRemoveParticipant(
  params: Record<string, unknown>,
  cfg: ChannelMessageActionContext["cfg"],
  accountId?: string | null,
) {
  const chatId = readStringParam(params, "groupId") ?? readStringParam(params, "channelId");
  if (!chatId) {
    return jsonResult({ error: "Missing required parameter: groupId (or channelId)" });
  }
  const userId = readStringParam(params, "userId");
  const userIdsRaw = params.userIds;
  let userIds: string[] = [];
  if (Array.isArray(userIdsRaw)) {
    userIds = userIdsRaw.map(String).filter(Boolean);
  } else if (userId) {
    userIds = [userId];
  }
  if (userIds.length === 0) {
    return jsonResult({ error: "Missing required parameter: userId or userIds" });
  }
  const config = resolveConfig(cfg, accountId);
  if (!hasCredentials(config)) {
    return jsonResult({ error: "DingTalk credentials not configured (appKey/appSecret)" });
  }
  await removeGroupMembers(chatId, userIds, config);
  return jsonResult({ ok: true, chatId, removed: userIds });
}

// ============ Adapter ============

async function handleUnsend(
  params: Record<string, unknown>,
  cfg: ChannelMessageActionContext["cfg"],
  accountId?: string | null,
) {
  const processQueryKey = readStringParam(params, "processQueryKey") ?? readStringParam(params, "messageId");
  const openConversationId = readStringParam(params, "openConversationId") ?? readStringParam(params, "channelId");

  if (!processQueryKey || !openConversationId) {
    return jsonResult({ error: "Missing required parameters: processQueryKey (or messageId) and openConversationId (or channelId)" });
  }

  const config = resolveConfig(cfg, accountId);
  if (!hasCredentials(config)) {
    return jsonResult({ error: "DingTalk credentials not configured" });
  }

  await recallMessage(config, { processQueryKey, openConversationId });
  return jsonResult({ ok: true });
}

async function handleRead(
  params: Record<string, unknown>,
  cfg: ChannelMessageActionContext["cfg"],
  accountId?: string | null,
) {
  const taskId = readStringParam(params, "taskId");
  const agentId = readStringParam(params, "agentId");

  if (!taskId || !agentId) {
    return jsonResult({ error: "Missing required parameters: taskId and agentId" });
  }

  const config = resolveConfig(cfg, accountId);
  if (!hasCredentials(config)) {
    return jsonResult({ error: "DingTalk credentials not configured" });
  }

  const result = await getReadReceipt(config, { taskId, agentId });
  return jsonResult({ ok: true, ...result });
}

async function handlePin(
  params: Record<string, unknown>,
  cfg: ChannelMessageActionContext["cfg"],
  accountId?: string | null,
) {
  const messageId = readStringParam(params, "messageId");
  const openConversationId = readStringParam(params, "openConversationId") ?? readStringParam(params, "channelId");

  if (!messageId || !openConversationId) {
    return jsonResult({ error: "Missing required parameters: messageId and openConversationId" });
  }

  const config = resolveConfig(cfg, accountId);
  const result = await pinMessage(config, { messageId, openConversationId });
  return jsonResult(result);
}

export const dingtalkMessageActions: ChannelMessageActionAdapter = {
  listActions: ({ cfg }) => {
    const accountIds = listDingTalkAccountIds(cfg);
    if (accountIds.length === 0) return [];

    // Check at least one account has credentials
    const raw = cfg.channels?.dingtalk as DingTalkConfig | undefined;
    const hasAny = accountIds.some((id) => {
      const resolved = resolveDingTalkAccountConfig(raw, id);
      return hasCredentials(resolved);
    });

    if (!hasAny) return [];

    const actions: ChannelMessageActionName[] = [
      "send",
      "broadcast",
      "sendAttachment",
      "member-info",
      "renameGroup",
      "addParticipant",
      "removeParticipant",
      "unsend" as ChannelMessageActionName,
      "read" as ChannelMessageActionName,
      "pin" as ChannelMessageActionName,
    ];
    return actions;
  },

  supportsAction: ({ action }) => {
    const supported = new Set<string>(["send", "broadcast", "sendAttachment", "member-info", "renameGroup", "addParticipant", "removeParticipant", "unsend", "read", "pin"]);
    return supported.has(action);
  },

  extractToolSend: ({ args }) => {
    const action = typeof args.action === "string" ? args.action.trim() : "";
    if (action !== "send") return null;
    const to =
      (typeof args.target === "string" ? args.target : undefined) ??
      (typeof args.to === "string" ? args.to : undefined);
    if (!to) return null;
    const accountId = typeof args.accountId === "string" ? args.accountId.trim() : undefined;
    return { to, accountId };
  },

  handleAction: async ({ action, params, cfg, accountId }) => {
    switch (action) {
      case "send":
        return handleSend(params, cfg, accountId);
      case "broadcast":
        return handleBroadcast(params, cfg, accountId);
      case "sendAttachment":
        return handleSendAttachment(params, cfg, accountId);
      case "member-info":
        return handleMemberInfo(params);
      case "renameGroup":
        return handleRenameGroup(params, cfg, accountId);
      case "addParticipant":
        return handleAddParticipant(params, cfg, accountId);
      case "removeParticipant":
        return handleRemoveParticipant(params, cfg, accountId);
      case "unsend":
        return handleUnsend(params, cfg, accountId);
      case "read":
        return handleRead(params, cfg, accountId);
      case "pin":
        return handlePin(params, cfg, accountId);
      default:
        return jsonResult({ error: `Unsupported action: ${action}` });
    }
  },
};
