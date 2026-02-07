import type { ClawdbotConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { DingTalkConfig, DingTalkAccountConfig, ResolvedDingTalkAccount } from "./types.js";

/**
 * Resolve merged account config: account-specific fields override shared defaults.
 * For legacy format (no `accounts` map), synthesize from root-level fields.
 */
export function resolveDingTalkAccountConfig(
  dingtalkCfg: DingTalkConfig | undefined,
  accountId?: string,
): DingTalkConfig {
  if (!dingtalkCfg) {
    return {} as DingTalkConfig;
  }

  const id = accountId ?? DEFAULT_ACCOUNT_ID;
  const accountEntry = dingtalkCfg.accounts?.[id];

  // Legacy format: no accounts map, or requesting the default account with no accounts
  if (!accountEntry) {
    return dingtalkCfg;
  }

  // Merge: account-specific overrides shared defaults
  return {
    ...dingtalkCfg,
    ...(accountEntry.appKey !== undefined && { appKey: accountEntry.appKey }),
    ...(accountEntry.appSecret !== undefined && { appSecret: accountEntry.appSecret }),
    ...(accountEntry.robotCode !== undefined && { robotCode: accountEntry.robotCode }),
    ...(accountEntry.connectionMode !== undefined && { connectionMode: accountEntry.connectionMode }),
    ...(accountEntry.dmPolicy !== undefined && { dmPolicy: accountEntry.dmPolicy }),
    ...(accountEntry.allowFrom !== undefined && { allowFrom: accountEntry.allowFrom }),
    ...(accountEntry.groupPolicy !== undefined && { groupPolicy: accountEntry.groupPolicy }),
    ...(accountEntry.groupAllowFrom !== undefined && { groupAllowFrom: accountEntry.groupAllowFrom }),
    ...(accountEntry.groups !== undefined && { groups: accountEntry.groups }),
    ...(accountEntry.renderMode !== undefined && { renderMode: accountEntry.renderMode }),
    ...(accountEntry.aiCardMode !== undefined && { aiCardMode: accountEntry.aiCardMode }),
    ...(accountEntry.cooldownMs !== undefined && { cooldownMs: accountEntry.cooldownMs }),
    ...(accountEntry.showThinking !== undefined && { showThinking: accountEntry.showThinking }),
    ...(accountEntry.groupSessionScope !== undefined && { groupSessionScope: accountEntry.groupSessionScope }),
    ...(accountEntry.gatewayToken !== undefined && { gatewayToken: accountEntry.gatewayToken }),
    ...(accountEntry.gatewayPassword !== undefined && { gatewayPassword: accountEntry.gatewayPassword }),
    ...(accountEntry.gatewayPort !== undefined && { gatewayPort: accountEntry.gatewayPort }),
    ...(accountEntry.systemPrompt !== undefined && { systemPrompt: accountEntry.systemPrompt }),
    ...(accountEntry.enabled !== undefined && { enabled: accountEntry.enabled }),
  };
}

export function resolveDingTalkCredentials(
  cfg?: DingTalkConfig,
  accountId?: string,
): {
  appKey: string;
  appSecret: string;
  robotCode?: string;
} | null {
  const resolved = accountId ? resolveDingTalkAccountConfig(cfg, accountId) : cfg;
  const appKey = resolved?.appKey?.trim();
  const appSecret = resolved?.appSecret?.trim();
  if (!appKey || !appSecret) return null;
  return {
    appKey,
    appSecret,
    robotCode: resolved?.robotCode?.trim() || undefined,
  };
}

export function resolveDingTalkAccount(params: {
  cfg: ClawdbotConfig;
  accountId?: string | null;
}): ResolvedDingTalkAccount {
  const dingtalkCfg = params.cfg.channels?.dingtalk as DingTalkConfig | undefined;
  const accountId = params.accountId?.trim() || DEFAULT_ACCOUNT_ID;
  const resolved = resolveDingTalkAccountConfig(dingtalkCfg, accountId);
  const enabled = resolved?.enabled !== false;
  const creds = resolveDingTalkCredentials(dingtalkCfg, accountId);

  return {
    accountId,
    enabled,
    configured: Boolean(creds),
    appKey: creds?.appKey,
    robotCode: creds?.robotCode,
  };
}

export function listDingTalkAccountIds(cfg: ClawdbotConfig): string[] {
  const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
  if (dingtalkCfg?.accounts && Object.keys(dingtalkCfg.accounts).length > 0) {
    return Object.keys(dingtalkCfg.accounts);
  }
  // Legacy: check if root-level credentials exist
  if (dingtalkCfg?.appKey && dingtalkCfg?.appSecret) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return [];
}

export function resolveDefaultDingTalkAccountId(cfg: ClawdbotConfig): string {
  const ids = listDingTalkAccountIds(cfg);
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

export function listEnabledDingTalkAccounts(cfg: ClawdbotConfig): ResolvedDingTalkAccount[] {
  return listDingTalkAccountIds(cfg)
    .map((accountId) => resolveDingTalkAccount({ cfg, accountId }))
    .filter((account) => account.enabled && account.configured);
}
