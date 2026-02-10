import type { ChannelHeartbeatAdapter } from "openclaw/plugin-sdk";
import type { DingTalkConfig } from "./types.js";
import { resolveDingTalkAccountConfig } from "./accounts.js";
import { getConnectionHealth } from "./monitor.js";

export const dingtalkHeartbeat: ChannelHeartbeatAdapter = {
  checkReady: async ({ cfg, accountId }) => {
    const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
    const accountCfg = resolveDingTalkAccountConfig(dingtalkCfg, accountId ?? undefined);

    if (!accountCfg?.appKey || !accountCfg?.appSecret) {
      return { ok: false, reason: "DingTalk credentials not configured" };
    }

    const connectionMode = accountCfg.connectionMode ?? "stream";

    if (connectionMode === "webhook") {
      // Webhook mode doesn't maintain a persistent connection; assume ready if configured.
      return { ok: true, reason: "webhook mode (no persistent connection)" };
    }

    // Stream mode: check if the DWClient is connected.
    const health = getConnectionHealth(accountId ?? undefined);

    if (!health.connected) {
      return { ok: false, reason: "DingTalk stream not connected" };
    }

    return { ok: true, reason: "stream connected" };
  },

  resolveRecipients: ({ cfg, opts }) => {
    if (opts?.to) {
      return { recipients: [opts.to], source: "flag" };
    }

    const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
    const allowFrom = Array.isArray(dingtalkCfg?.allowFrom)
      ? dingtalkCfg!.allowFrom.map((v) => String(v).trim()).filter(Boolean)
      : [];

    // Filter out wildcards
    const filtered = allowFrom.filter((e) => e !== "*");

    if (opts?.all) {
      return { recipients: filtered, source: "all" };
    }

    if (filtered.length > 0) {
      return { recipients: [filtered[0]], source: "allowFrom" };
    }

    return { recipients: [], source: "none" };
  },
};
