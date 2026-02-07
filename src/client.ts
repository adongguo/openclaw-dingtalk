import { DWClient } from "dingtalk-stream";
import type { DingTalkConfig } from "./types.js";
import { resolveDingTalkCredentials } from "./accounts.js";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";

const clientCache = new Map<string, DWClient>();
const configCache = new Map<string, { appKey: string; appSecret: string }>();

export function createDingTalkClient(cfg: DingTalkConfig, accountId?: string): DWClient {
  const id = accountId ?? DEFAULT_ACCOUNT_ID;
  const creds = resolveDingTalkCredentials(cfg, accountId);
  if (!creds) {
    throw new Error(`DingTalk credentials not configured for account "${id}" (appKey, appSecret required)`);
  }

  const cached = clientCache.get(id);
  const cachedCfg = configCache.get(id);
  if (
    cached &&
    cachedCfg &&
    cachedCfg.appKey === creds.appKey &&
    cachedCfg.appSecret === creds.appSecret
  ) {
    return cached;
  }

  const client = new DWClient({
    clientId: creds.appKey,
    clientSecret: creds.appSecret,
    keepAlive: true,
  });
  // Disable SDK's built-in auto-reconnect; our health check handles reconnection.
  // Must set on config object (not client instance) because SDK checks this.config.autoReconnect.
  client.config.autoReconnect = false;

  clientCache.set(id, client);
  configCache.set(id, { appKey: creds.appKey, appSecret: creds.appSecret });

  return client;
}

export function clearClientCache(accountId?: string): void {
  if (accountId) {
    const client = clientCache.get(accountId);
    if (client) {
      try {
        client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    clientCache.delete(accountId);
    configCache.delete(accountId);
    return;
  }

  // Clear all
  for (const client of clientCache.values()) {
    try {
      client.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
  clientCache.clear();
  configCache.clear();
}

export async function getAccessToken(cfg: DingTalkConfig, accountId?: string): Promise<string> {
  const client = createDingTalkClient(cfg, accountId);
  return await client.getAccessToken();
}
