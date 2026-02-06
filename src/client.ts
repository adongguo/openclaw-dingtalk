import { DWClient } from "dingtalk-stream";
import type { DingTalkConfig } from "./types.js";
import { resolveDingTalkCredentials } from "./accounts.js";

let cachedClient: DWClient | null = null;
let cachedConfig: { appKey: string; appSecret: string } | null = null;

export function createDingTalkClient(cfg: DingTalkConfig): DWClient {
  const creds = resolveDingTalkCredentials(cfg);
  if (!creds) {
    throw new Error("DingTalk credentials not configured (appKey, appSecret required)");
  }

  if (
    cachedClient &&
    cachedConfig &&
    cachedConfig.appKey === creds.appKey &&
    cachedConfig.appSecret === creds.appSecret
  ) {
    return cachedClient;
  }

  const client = new DWClient({
    clientId: creds.appKey,
    clientSecret: creds.appSecret,
    keepAlive: true,
  });

  cachedClient = client;
  cachedConfig = { appKey: creds.appKey, appSecret: creds.appSecret };

  return client;
}

export function clearClientCache() {
  if (cachedClient) {
    try {
      cachedClient.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }
  cachedClient = null;
  cachedConfig = null;
}

export async function getAccessToken(cfg: DingTalkConfig): Promise<string> {
  const client = createDingTalkClient(cfg);
  return await client.getAccessToken();
}
