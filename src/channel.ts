import type { ChannelPlugin, ClawdbotConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { ResolvedDingTalkAccount, DingTalkConfig } from "./types.js";
import {
  resolveDingTalkAccount,
  resolveDingTalkCredentials,
  resolveDingTalkAccountConfig,
  listDingTalkAccountIds,
  resolveDefaultDingTalkAccountId,
} from "./accounts.js";
import { dingtalkMentions } from "./mentions.js";
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
import { dingtalkMessageActions } from "./actions.js";
import { dingtalkHeartbeat } from "./heartbeat.js";

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
    notifyApproval: async ({ cfg, id, accountId }) => {
      const dingtalkCfg = resolveDingTalkAccountConfig(
        cfg.channels?.dingtalk as DingTalkConfig | undefined,
        accountId,
      );
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
      "- Images in markdown syntax (e.g. ![desc](path)) are auto-uploaded to DingTalk.",
      '- Use [DINGTALK_FILE]{"path":"...","name":"..."}[/DINGTALK_FILE] markers to send files as separate file cards.',
      "- In group chats, the bot only receives messages where it is @mentioned — this is a DingTalk platform limitation.",
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
        groupSessionScope: { type: "string", enum: ["per-group", "per-user"] },
        historyLimit: { type: "integer", minimum: 0 },
        dmHistoryLimit: { type: "integer", minimum: 0 },
        textChunkLimit: { type: "integer", minimum: 1 },
        chunkMode: { type: "string", enum: ["length", "newline"] },
        mediaMaxMb: { type: "number", minimum: 0 },
        renderMode: { type: "string", enum: ["auto", "raw", "card", "markdown"] },
        cooldownMs: { type: "integer", minimum: 0 },
        accounts: { type: "object", additionalProperties: { type: "object" } },
      },
    },
  },
  config: {
    listAccountIds: (cfg) => listDingTalkAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveDingTalkAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultDingTalkAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
      const id = accountId ?? DEFAULT_ACCOUNT_ID;

      // Multi-account: update specific account
      if (dingtalkCfg?.accounts?.[id]) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            dingtalk: {
              ...dingtalkCfg,
              accounts: {
                ...dingtalkCfg.accounts,
                [id]: { ...dingtalkCfg.accounts[id], enabled },
              },
            },
          },
        };
      }

      // Legacy: update root-level enabled
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          dingtalk: {
            ...cfg.channels?.dingtalk,
            enabled,
          },
        },
      };
    },
    deleteAccount: ({ cfg, accountId }) => {
      const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
      const id = accountId ?? DEFAULT_ACCOUNT_ID;

      // Multi-account: delete specific account from accounts map
      if (dingtalkCfg?.accounts?.[id]) {
        const { [id]: _removed, ...remainingAccounts } = dingtalkCfg.accounts;
        const hasRemaining = Object.keys(remainingAccounts).length > 0;
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            dingtalk: {
              ...dingtalkCfg,
              accounts: hasRemaining ? remainingAccounts : undefined,
            },
          },
        };
      }

      // Legacy: remove entire dingtalk config
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
    isConfigured: (_account, cfg) => {
      const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
      const accountId = _account?.accountId;
      return Boolean(resolveDingTalkCredentials(dingtalkCfg, accountId));
    },
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: ({ cfg, accountId }) => {
      const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
      const resolved = resolveDingTalkAccountConfig(dingtalkCfg, accountId);
      return resolved?.allowFrom ?? [];
    },
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    collectWarnings: ({ cfg }) => {
      const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
      const warnings: string[] = [];
      const defaultGroupPolicy = (cfg.channels as Record<string, { groupPolicy?: string }> | undefined)?.defaults?.groupPolicy;

      // Check all accounts (or root-level for legacy)
      const accountIds = listDingTalkAccountIds(cfg);
      for (const accountId of accountIds) {
        const resolved = resolveDingTalkAccountConfig(dingtalkCfg, accountId);
        const groupPolicy = resolved?.groupPolicy ?? defaultGroupPolicy ?? "allowlist";
        if (groupPolicy === "open") {
          const label = accountId === DEFAULT_ACCOUNT_ID ? "" : ` (account: ${accountId})`;
          warnings.push(
            `- DingTalk groups${label}: groupPolicy="open" allows any member to trigger (mention-gated). Set groupPolicy="allowlist" + groupAllowFrom to restrict senders.`,
          );
        }
      }

      return warnings;
    },
  },
  setup: {
    resolveAccountId: (cfg) => resolveDefaultDingTalkAccountId(cfg),
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
  actions: dingtalkMessageActions,
  heartbeat: dingtalkHeartbeat,
  onboarding: dingtalkOnboardingAdapter,
  messaging: {
    normalizeTarget: normalizeDingTalkTarget,
    targetResolver: {
      looksLikeId: looksLikeDingTalkId,
      hint: "<conversationId|user:staffId>",
    },
  },
  mentions: dingtalkMentions,
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
    probeAccount: async ({ cfg, accountId }) => {
      const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
      const resolved = resolveDingTalkAccountConfig(dingtalkCfg, accountId);
      return await probeDingTalk(resolved, accountId);
    },
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
      const dingtalkCfg = resolveDingTalkAccountConfig(
        ctx.cfg.channels?.dingtalk as DingTalkConfig | undefined,
        ctx.accountId,
      );
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
