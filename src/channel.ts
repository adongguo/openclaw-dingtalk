import type { ChannelPlugin, ClawdbotConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { ResolvedDingTalkAccount, DingTalkConfig } from "./types.js";
import { resolveDingTalkAccount, resolveDingTalkCredentials } from "./accounts.js";
import { dingtalkOutbound } from "./outbound.js";
import { probeDingTalk } from "./probe.js";
import { resolveDingTalkGroupToolPolicy } from "./policy.js";
import { normalizeDingTalkTarget, looksLikeDingTalkId } from "./targets.js";
import {
  listDingTalkDirectoryPeers,
  listDingTalkDirectoryGroups,
  listDingTalkDirectoryPeersLive,
  listDingTalkDirectoryGroupsLive,
} from "./directory.js";
import { dingtalkOnboardingAdapter } from "./onboarding.js";

const meta = {
  id: "dingtalk",
  label: "DingTalk",
  selectionLabel: "DingTalk (钉钉)",
  docsPath: "/channels/dingtalk",
  docsLabel: "dingtalk",
  blurb: "钉钉/DingTalk enterprise messaging.",
  aliases: ["dingding"],
  order: 70,
} as const;

export const dingtalkPlugin: ChannelPlugin<ResolvedDingTalkAccount> = {
  id: "dingtalk",
  meta: {
    ...meta,
  },
  pairing: {
    idLabel: "dingtalkUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(dingtalk|user|staff):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
      if (!dingtalkCfg?.appKey || !dingtalkCfg?.appSecret) {
        return;
      }
      try {
        const { sendTextViaOpenAPI } = await import("./openapi-send.js");
        const staffId = String(id).replace(/^(dingtalk|user|staff):/i, "");
        await sendTextViaOpenAPI({
          config: dingtalkCfg,
          target: { kind: "user", id: staffId },
          content: "Your pairing request has been approved. You can now send messages to the bot.",
        });
      } catch {
        // Proactive send not available; silently ignore
      }
    },
  },
  capabilities: {
    chatTypes: ["direct", "channel"],
    polls: false,
    threads: false, // DingTalk has limited thread support
    media: true,
    reactions: false, // DingTalk doesn't support reactions via bot API
    edit: false, // DingTalk doesn't support message editing via sessionWebhook
    reply: true,
  },
  agentPrompt: {
    messageToolHints: () => [
      "- DingTalk targeting: messages are sent via sessionWebhook to the current conversation.",
      "- DingTalk supports text, markdown, and ActionCard message types.",
    ],
  },
  groups: {
    resolveToolPolicy: resolveDingTalkGroupToolPolicy,
  },
  reload: { configPrefixes: ["channels.dingtalk"] },
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        appKey: { type: "string" },
        appSecret: { type: "string" },
        robotCode: { type: "string" },
        connectionMode: { type: "string", enum: ["stream", "webhook"] },
        webhookPath: { type: "string" },
        webhookPort: { type: "integer", minimum: 1 },
        dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
        allowFrom: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
        groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
        groupAllowFrom: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
        requireMention: { type: "boolean" },
        historyLimit: { type: "integer", minimum: 0 },
        dmHistoryLimit: { type: "integer", minimum: 0 },
        textChunkLimit: { type: "integer", minimum: 1 },
        chunkMode: { type: "string", enum: ["length", "newline"] },
        mediaMaxMb: { type: "number", minimum: 0 },
        renderMode: { type: "string", enum: ["auto", "raw", "card"] },
        cooldownMs: { type: "integer", minimum: 0 },
      },
    },
  },
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg) => resolveDingTalkAccount({ cfg }),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    setAccountEnabled: ({ cfg, enabled }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        dingtalk: {
          ...cfg.channels?.dingtalk,
          enabled,
        },
      },
    }),
    deleteAccount: ({ cfg }) => {
      const next = { ...cfg } as ClawdbotConfig;
      const nextChannels = { ...cfg.channels };
      delete (nextChannels as Record<string, unknown>).dingtalk;
      if (Object.keys(nextChannels).length > 0) {
        next.channels = nextChannels;
      } else {
        delete next.channels;
      }
      return next;
    },
    isConfigured: (_account, cfg) =>
      Boolean(resolveDingTalkCredentials(cfg.channels?.dingtalk as DingTalkConfig | undefined)),
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: ({ cfg }) =>
      (cfg.channels?.dingtalk as DingTalkConfig | undefined)?.allowFrom ?? [],
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    collectWarnings: ({ cfg }) => {
      const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
      const defaultGroupPolicy = (cfg.channels as Record<string, { groupPolicy?: string }> | undefined)?.defaults?.groupPolicy;
      const groupPolicy = dingtalkCfg?.groupPolicy ?? defaultGroupPolicy ?? "allowlist";
      if (groupPolicy !== "open") return [];
      return [
        `- DingTalk groups: groupPolicy="open" allows any member to trigger (mention-gated). Set channels.dingtalk.groupPolicy="allowlist" + channels.dingtalk.groupAllowFrom to restrict senders.`,
      ];
    },
  },
  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg }) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        dingtalk: {
          ...cfg.channels?.dingtalk,
          enabled: true,
        },
      },
    }),
  },
  onboarding: dingtalkOnboardingAdapter,
  messaging: {
    normalizeTarget: normalizeDingTalkTarget,
    targetResolver: {
      looksLikeId: looksLikeDingTalkId,
      hint: "<conversationId|user:staffId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, query, limit }) =>
      listDingTalkDirectoryPeers({ cfg, query, limit }),
    listGroups: async ({ cfg, query, limit }) =>
      listDingTalkDirectoryGroups({ cfg, query, limit }),
    listPeersLive: async ({ cfg, query, limit }) =>
      listDingTalkDirectoryPeersLive({ cfg, query, limit }),
    listGroupsLive: async ({ cfg, query, limit }) =>
      listDingTalkDirectoryGroupsLive({ cfg, query, limit }),
  },
  outbound: dingtalkOutbound,
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
      port: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      port: snapshot.port ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ cfg }) =>
      await probeDingTalk(cfg.channels?.dingtalk as DingTalkConfig | undefined),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      port: runtime?.port ?? null,
      probe,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const { monitorDingTalkProvider } = await import("./monitor.js");
      const dingtalkCfg = ctx.cfg.channels?.dingtalk as DingTalkConfig | undefined;
      const port = dingtalkCfg?.webhookPort ?? null;
      ctx.setStatus({ accountId: ctx.accountId, port });
      ctx.log?.info(`starting dingtalk provider (mode: ${dingtalkCfg?.connectionMode ?? "stream"})`);
      return monitorDingTalkProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
  },
};
