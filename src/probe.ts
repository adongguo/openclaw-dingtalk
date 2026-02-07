import type { DingTalkConfig, DingTalkProbeResult } from "./types.js";
import { createDingTalkClient } from "./client.js";
import { resolveDingTalkCredentials } from "./accounts.js";

export async function probeDingTalk(cfg?: DingTalkConfig, accountId?: string): Promise<DingTalkProbeResult> {
  const creds = resolveDingTalkCredentials(cfg, accountId);
  if (!creds) {
    return {
      ok: false,
      error: "missing credentials (appKey, appSecret)",
    };
  }

  try {
    const client = createDingTalkClient(cfg!, accountId);

    // Try to get access token as a connectivity test
    const accessToken = await client.getAccessToken();

    if (!accessToken) {
      return {
        ok: false,
        appKey: creds.appKey,
        error: "Failed to get access token",
      };
    }

    return {
      ok: true,
      appKey: creds.appKey,
      robotCode: creds.robotCode,
      connected: true,
    };
  } catch (err) {
    return {
      ok: false,
      appKey: creds.appKey,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
