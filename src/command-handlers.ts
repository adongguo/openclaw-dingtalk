/**
 * SDK Command Handlers for DingTalk Plugin.
 *
 * Provides command implementations registered via api.registerCommand():
 * - dingtalk-status: Show connection status and active session count
 * - dingtalk-sessions: List active DingTalk sessions
 * - dingtalk-whoami: Show the sender's staffId and permissions
 */

import type { DingTalkConfig } from "./types.js";
import { getActiveSessionCount, DEFAULT_SESSION_TIMEOUT } from "./session.js";
import { listDingTalkAccountIds, resolveDingTalkAccountConfig, resolveDingTalkCredentials } from "./accounts.js";

// ============ Public Functions ============

/**
 * Format a status response showing connection info, active sessions, and account status.
 */
export function formatStatusResponse(cfg: unknown): string {
  const dingtalkCfg = extractDingTalkConfig(cfg);
  if (!dingtalkCfg) {
    return "DingTalk plugin is not configured.";
  }

  const lines: string[] = ["**DingTalk Status**", ""];

  // Connection info
  const mode = dingtalkCfg.connectionMode ?? "stream";
  lines.push(`- Connection mode: \`${mode}\``);
  lines.push(`- Render mode: \`${dingtalkCfg.renderMode ?? "auto"}\``);
  lines.push(`- AI Card mode: \`${dingtalkCfg.aiCardMode ?? "enabled"}\``);

  // Session info
  const sessionCount = getActiveSessionCount();
  const timeoutMin = Math.round((dingtalkCfg.sessionTimeout ?? DEFAULT_SESSION_TIMEOUT) / 60000);
  lines.push(`- Active sessions: ${sessionCount}`);
  lines.push(`- Session timeout: ${timeoutMin} min`);

  // Account status
  const accountIds = listDingTalkAccountIds(cfg as Record<string, unknown>);
  if (accountIds.length > 0) {
    lines.push("");
    lines.push(`**Accounts** (${accountIds.length}):`);
    for (const accountId of accountIds) {
      const resolved = resolveDingTalkAccountConfig(dingtalkCfg, accountId);
      const creds = resolveDingTalkCredentials(dingtalkCfg, accountId);
      const status = creds ? "configured" : "missing credentials";
      const enabled = resolved?.enabled !== false ? "enabled" : "disabled";
      lines.push(`- \`${accountId}\`: ${enabled}, ${status}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a sessions response listing active sessions with age and timeout info.
 */
export function formatSessionsResponse(cfg?: unknown): string {
  const dingtalkCfg = extractDingTalkConfig(cfg);
  const sessionCount = getActiveSessionCount();

  if (sessionCount === 0) {
    return "No active DingTalk sessions.";
  }

  const timeoutMin = Math.round(
    ((dingtalkCfg?.sessionTimeout ?? DEFAULT_SESSION_TIMEOUT) / 60000),
  );

  const lines: string[] = [
    `**Active DingTalk Sessions**: ${sessionCount}`,
    "",
    `Session timeout: ${timeoutMin} min`,
    "",
    "_Session details are not exposed to preserve user privacy._",
    "_Use the gateway logs for detailed session debugging._",
  ];

  return lines.join("\n");
}

/**
 * Format a whoami response showing the sender's staffId and policy info.
 */
export function formatWhoamiResponse(senderId: string, cfg: unknown): string {
  const dingtalkCfg = extractDingTalkConfig(cfg);

  const lines: string[] = ["**DingTalk Identity**", ""];
  lines.push(`- Staff ID: \`${senderId}\``);

  if (dingtalkCfg) {
    const dmPolicy = dingtalkCfg.dmPolicy ?? "pairing";
    const groupPolicy = dingtalkCfg.groupPolicy ?? "allowlist";
    lines.push(`- DM policy: \`${dmPolicy}\``);
    lines.push(`- Group policy: \`${groupPolicy}\``);

    // Check if sender is in allowlist
    const allowFrom = dingtalkCfg.allowFrom ?? [];
    const isAllowed = allowFrom.length === 0
      || allowFrom.some((entry) => String(entry).toLowerCase() === senderId.toLowerCase())
      || allowFrom.some((entry) => String(entry).trim() === "*");
    lines.push(`- In DM allowlist: ${isAllowed ? "yes" : "no"}`);
  }

  return lines.join("\n");
}

// ============ Private Functions ============

function extractDingTalkConfig(cfg: unknown): DingTalkConfig | undefined {
  if (!cfg || typeof cfg !== "object") return undefined;
  const channels = (cfg as Record<string, unknown>).channels as Record<string, unknown> | undefined;
  return channels?.dingtalk as DingTalkConfig | undefined;
}
