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
import { uploadAndSendFile } from "./media.js";
import {
  getGroupMembers,
  getGroupMemberCount,
  getTrackedGroupIds,
} from "./group-members.js";

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

// ============ Adapter ============

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
    ];
    return actions;
  },

  supportsAction: ({ action }) => {
    const supported = new Set<string>(["send", "broadcast", "sendAttachment", "member-info"]);
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
      default:
        return jsonResult({ error: `Unsupported action: ${action}` });
    }
  },
};
