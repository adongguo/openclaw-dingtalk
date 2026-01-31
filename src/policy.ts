import type { ChannelGroupContext, GroupToolPolicyConfig } from "openclaw/plugin-sdk";
import type { DingTalkConfig, DingTalkGroupConfig } from "./types.js";

export type DingTalkAllowlistMatch = {
  allowed: boolean;
  matchKey?: string;
  matchSource?: "wildcard" | "id" | "name";
};

export function resolveDingTalkAllowlistMatch(params: {
  allowFrom: Array<string | number>;
  senderId: string;
  senderName?: string | null;
}): DingTalkAllowlistMatch {
  const allowFrom = params.allowFrom
    .map((entry) => String(entry).trim().toLowerCase())
    .filter(Boolean);

  if (allowFrom.length === 0) return { allowed: false };
  if (allowFrom.includes("*")) {
    return { allowed: true, matchKey: "*", matchSource: "wildcard" };
  }

  const senderId = params.senderId.toLowerCase();
  if (allowFrom.includes(senderId)) {
    return { allowed: true, matchKey: senderId, matchSource: "id" };
  }

  const senderName = params.senderName?.toLowerCase();
  if (senderName && allowFrom.includes(senderName)) {
    return { allowed: true, matchKey: senderName, matchSource: "name" };
  }

  return { allowed: false };
}

export function resolveDingTalkGroupConfig(params: {
  cfg?: DingTalkConfig;
  groupId?: string | null;
}): DingTalkGroupConfig | undefined {
  const groups = params.cfg?.groups ?? {};
  const groupId = params.groupId?.trim();
  if (!groupId) return undefined;

  const direct = groups[groupId] as DingTalkGroupConfig | undefined;
  if (direct) return direct;

  const lowered = groupId.toLowerCase();
  const matchKey = Object.keys(groups).find((key) => key.toLowerCase() === lowered);
  return matchKey ? (groups[matchKey] as DingTalkGroupConfig | undefined) : undefined;
}

export function resolveDingTalkGroupToolPolicy(
  params: ChannelGroupContext,
): GroupToolPolicyConfig | undefined {
  const cfg = params.cfg.channels?.dingtalk as DingTalkConfig | undefined;
  if (!cfg) return undefined;

  const groupConfig = resolveDingTalkGroupConfig({
    cfg,
    groupId: params.groupId,
  });

  return groupConfig?.tools;
}

export function isDingTalkGroupAllowed(params: {
  groupPolicy: "open" | "allowlist" | "disabled";
  allowFrom: Array<string | number>;
  senderId: string;
  senderName?: string | null;
}): boolean {
  const { groupPolicy } = params;
  if (groupPolicy === "disabled") return false;
  if (groupPolicy === "open") return true;
  return resolveDingTalkAllowlistMatch(params).allowed;
}

