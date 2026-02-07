import fs from "fs";
import os from "os";
import path from "path";
import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { DingTalkConfig, DingTalkIncomingMessage } from "./types.js";
import { createDingTalkClient, clearClientCache } from "./client.js";
import { resolveDingTalkCredentials, resolveDingTalkAccountConfig } from "./accounts.js";
import { handleDingTalkMessage } from "./bot.js";
import { cleanupExpiredSessions, DEFAULT_SESSION_TIMEOUT } from "./session.js";
import { isDuplicate } from "./dedup.js";
import { registerPeerId } from "./peer-id-registry.js";

export type MonitorDingTalkOpts = {
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};

const activeClients = new Map<string, DWClient>();
const cleanupIntervals = new Map<string, ReturnType<typeof setInterval>>();
const healthCheckIntervals = new Map<string, ReturnType<typeof setInterval>>();

const HEALTH_CHECK_INTERVAL = 10_000;          // Check every 10 seconds
const MIN_RECONNECT_DELAY = 2_000;             // 2 seconds
const MAX_RECONNECT_DELAY = 120_000;           // 2 minutes
const MAX_SOFT_RECONNECT_ATTEMPTS = 2;         // After this, do a hard reconnect
const RECONNECT_ATTEMPT_CAP = 7;               // Cap counter once backoff is already at max
const WAIT_FOR_CONNECTED_TIMEOUT = 15_000;     // 15 seconds to wait for WebSocket open

export async function monitorDingTalkProvider(opts: MonitorDingTalkOpts = {}): Promise<void> {
  const cfg = opts.config;
  if (!cfg) {
    throw new Error("Config is required for DingTalk monitor");
  }

  const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
  const accountId = opts.accountId;
  const accountCfg = resolveDingTalkAccountConfig(dingtalkCfg, accountId);
  const creds = resolveDingTalkCredentials(dingtalkCfg, accountId);
  if (!creds) {
    throw new Error(`DingTalk credentials not configured for account "${accountId ?? "default"}" (appKey, appSecret required)`);
  }

  const log = opts.runtime?.log ?? console.log;

  const connectionMode = accountCfg?.connectionMode ?? "stream";

  if (connectionMode === "stream") {
    return monitorStream({ cfg, dingtalkCfg: accountCfg!, runtime: opts.runtime, abortSignal: opts.abortSignal, accountId });
  }

  log("dingtalk: webhook mode not implemented in monitor, use HTTP server directly");
}

async function monitorStream(params: {
  cfg: ClawdbotConfig;
  dingtalkCfg: DingTalkConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
}): Promise<void> {
  const { cfg, dingtalkCfg, runtime, abortSignal, accountId } = params;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;
  const clientKey = accountId ?? "__default__";

  log(`dingtalk: starting Stream connection${accountId ? ` for account "${accountId}"` : ""}...`);

  const client = createDingTalkClient(dingtalkCfg, accountId);
  activeClients.set(clientKey, client);

  const chatHistories = new Map<string, HistoryEntry[]>();

  // Named callback handler that dynamically resolves the current client.
  // This ensures hard reconnects (client replacement) work seamlessly
  // because the handler always uses the latest client from activeClients.
  const messageHandler = buildMessageHandler({
    clientKey,
    cfg,
    runtime,
    chatHistories,
    accountId,
    log: (msg) => log(msg),
    error: (msg) => error(msg),
  });

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      const hcId = healthCheckIntervals.get(clientKey);
      if (hcId) {
        clearInterval(hcId);
        healthCheckIntervals.delete(clientKey);
      }
      const cuId = cleanupIntervals.get(clientKey);
      if (cuId) {
        clearInterval(cuId);
        cleanupIntervals.delete(clientKey);
      }
      const activeClient = activeClients.get(clientKey);
      if (activeClient) {
        try {
          activeClient.disconnect();
        } catch {
          // Ignore disconnect errors
        }
        activeClients.delete(clientKey);
      }
    };

    const handleAbort = () => {
      log("dingtalk: abort signal received, stopping Stream client");
      cleanup();
      resolve();
    };

    if (abortSignal?.aborted) {
      cleanup();
      resolve();
      return;
    }

    abortSignal?.addEventListener("abort", handleAbort, { once: true });

    try {
      // Reset subscriptions to avoid accumulating duplicates across reconnects
      // (SDK bug: defaultConfig.subscriptions is shared by reference)
      client.config.subscriptions = [{ type: "EVENT", topic: "*" }];
      client.registerCallbackListener(TOPIC_ROBOT, messageHandler);

      // Clean up stale temp files from previous sessions
      cleanupTempFiles(log);

      // Connect to DingTalk Stream
      client.connect();
      log("dingtalk: Stream client connected");

      // Start connection health supervisor
      healthCheckIntervals.set(clientKey, startConnectionHealthCheck(clientKey, {
        log: (msg) => log(msg),
        error: (msg) => error(msg),
      }, {
        dingtalkCfg,
        accountId,
        messageHandler,
      }));

      // Periodic cleanup of expired sessions (every 5 minutes)
      const sessionTimeout = dingtalkCfg.sessionTimeout ?? DEFAULT_SESSION_TIMEOUT;
      cleanupIntervals.set(clientKey, setInterval(() => {
        const cleaned = cleanupExpiredSessions(sessionTimeout);
        if (cleaned > 0) {
          log(`dingtalk: cleaned up ${cleaned} expired sessions`);
        }
      }, 300_000));
    } catch (err) {
      cleanup();
      abortSignal?.removeEventListener("abort", handleAbort);
      reject(err);
    }
  });
}

export function stopDingTalkMonitor(accountId?: string): void {
  if (accountId) {
    const key = accountId;
    const hcId = healthCheckIntervals.get(key);
    if (hcId) { clearInterval(hcId); healthCheckIntervals.delete(key); }
    const cuId = cleanupIntervals.get(key);
    if (cuId) { clearInterval(cuId); cleanupIntervals.delete(key); }
    const client = activeClients.get(key);
    if (client) {
      try { client.disconnect(); } catch { /* ignore */ }
      activeClients.delete(key);
    }
    return;
  }

  // Stop all
  for (const [, hcId] of healthCheckIntervals) {
    clearInterval(hcId);
  }
  healthCheckIntervals.clear();

  for (const [, cuId] of cleanupIntervals) {
    clearInterval(cuId);
  }
  cleanupIntervals.clear();

  for (const [, client] of activeClients) {
    try { client.disconnect(); } catch { /* ignore */ }
  }
  activeClients.clear();
}

// ============ Private Functions ============

function buildMessageHandler(ctx: {
  clientKey: string;
  cfg: ClawdbotConfig;
  runtime?: RuntimeEnv;
  chatHistories: Map<string, HistoryEntry[]>;
  accountId?: string;
  log: (msg: string) => void;
  error: (msg: string) => void;
}) {
  return async (res: { data: string; headers: { messageId: string } }) => {
    const currentClient = activeClients.get(ctx.clientKey);
    if (!currentClient) return;

    try {
      const messageData = JSON.parse(res.data) as DingTalkIncomingMessage;

      // DingTalk nests downloadCode inside `content` for media messages (picture, file, voice, video).
      // Extract to top level for consistent access by downstream handlers.
      if (!messageData.downloadCode && messageData.content && typeof messageData.content === "object") {
        const contentObj = messageData.content as unknown as Record<string, unknown>;
        if (typeof contentObj.downloadCode === "string") {
          (messageData as Record<string, unknown>).downloadCode = contentObj.downloadCode;
        }
      }

      // Deduplicate messages to prevent double-processing
      if (isDuplicate(messageData.msgId)) {
        ctx.log(`dingtalk: duplicate message ${messageData.msgId}, skipping`);
        currentClient.socketCallBackResponse(res.headers.messageId, { success: true });
        return;
      }

      // Register peer ID for case-preserving outbound resolution
      if (messageData.senderStaffId) {
        registerPeerId(messageData.senderStaffId);
      }

      ctx.log(`dingtalk: received message from ${messageData.senderNick}: ${messageData.text?.content || messageData.msgtype}`);

      await handleDingTalkMessage({
        cfg: ctx.cfg,
        message: messageData,
        runtime: ctx.runtime,
        chatHistories: ctx.chatHistories,
        client: currentClient,
        accountId: ctx.accountId,
      });

      // Acknowledge the message
      currentClient.socketCallBackResponse(res.headers.messageId, { success: true });
    } catch (err) {
      ctx.error(`dingtalk: error handling message: ${String(err)}`);
      // Still acknowledge to prevent redelivery
      currentClient.socketCallBackResponse(res.headers.messageId, { success: false, error: String(err) });
    }
  };
}

type ReconnectContext = {
  dingtalkCfg: DingTalkConfig;
  accountId?: string;
  messageHandler: (res: { data: string; headers: { messageId: string } }) => Promise<void>;
};

function startConnectionHealthCheck(
  clientKey: string,
  logger: { log: (msg: string) => void; error: (msg: string) => void },
  reconnectCtx: ReconnectContext,
): ReturnType<typeof setInterval> {
  let disconnectedSince: number | null = null;
  let reconnectAttempts = 0;
  let reconnecting = false;
  let loggedUnregistered = false;

  return setInterval(async () => {
    const client = activeClients.get(clientKey);
    if (!client) return;

    // Only check `connected` (WebSocket open), NOT `registered`.
    // The Go SDK doesn't check `registered` at all — CALLBACK messages
    // can arrive regardless of the REGISTERED system message.
    if (client.connected) {
      if (disconnectedSince !== null) {
        const downtime = Math.round((Date.now() - disconnectedSince) / 1000);
        logger.log(`dingtalk: connection restored after ${downtime}s (${reconnectAttempts} reconnect attempt(s))`);
        disconnectedSince = null;
        reconnectAttempts = 0;
      }
      // Log unregistered state once for visibility, but don't act on it
      if (!client.registered && !loggedUnregistered) {
        loggedUnregistered = true;
        logger.log("dingtalk: WebSocket open but REGISTERED not received (this is OK — messages can still arrive)");
      }
      if (client.registered) {
        loggedUnregistered = false;
      }
      return;
    }

    // WebSocket is dead (connected=false) — need to reconnect
    if (disconnectedSince === null) {
      disconnectedSince = Date.now();
    }
    loggedUnregistered = false;

    // Skip if we're already in a reconnect attempt
    if (reconnecting) return;

    // Calculate backoff delay: 2s, 4s, 8s, 16s, ... up to 120s
    const backoffDelay = Math.min(
      MIN_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
      MAX_RECONNECT_DELAY,
    );
    const elapsed = Date.now() - disconnectedSince;

    // Wait for at least one backoff period before attempting reconnect
    if (elapsed < backoffDelay) return;

    reconnecting = true;
    reconnectAttempts = Math.min(reconnectAttempts + 1, RECONNECT_ATTEMPT_CAP);

    const useHardReconnect = reconnectAttempts > MAX_SOFT_RECONNECT_ATTEMPTS;

    if (useHardReconnect) {
      logger.log(
        `dingtalk: soft reconnect failed ${MAX_SOFT_RECONNECT_ATTEMPTS} times, ` +
        `performing hard reconnect (attempt #${reconnectAttempts})`
      );
    } else {
      logger.log(`dingtalk: connection lost, reconnect attempt #${reconnectAttempts} (backoff: ${Math.round(backoffDelay / 1000)}s)`);
    }

    try {
      if (useHardReconnect) {
        await hardReconnect(clientKey, client, reconnectCtx, logger);
      } else {
        await softReconnect(client);
      }
      logger.log(`dingtalk: ${useHardReconnect ? "hard " : ""}reconnect succeeded`);
      // Reset so next failure starts with soft reconnects
      reconnectAttempts = 0;
      disconnectedSince = null;
    } catch (err) {
      logger.error(`dingtalk: reconnect attempt #${reconnectAttempts} failed: ${String(err)}`);
      // Reset disconnectedSince so the next attempt respects the new backoff
      disconnectedSince = Date.now();
    } finally {
      reconnecting = false;
    }
  }, HEALTH_CHECK_INTERVAL);
}

async function softReconnect(client: DWClient): Promise<void> {
  cleanupClientInternalState(client);

  await raceWithTimeout(client.connect(), 30_000, "connect timeout");

  // connect() resolves before WebSocket open, so wait for at least connected.
  await waitForConnected(client, WAIT_FOR_CONNECTED_TIMEOUT);
}

async function hardReconnect(
  clientKey: string,
  oldClient: DWClient,
  ctx: ReconnectContext,
  logger: { log: (msg: string) => void; error: (msg: string) => void },
): Promise<void> {
  // Tear down old client completely.
  // clearClientCache disconnects internally, so no separate disconnect needed.
  // Use resolved ID to avoid clearing ALL accounts when accountId is undefined.
  clearClientCache(ctx.accountId ?? DEFAULT_ACCOUNT_ID);

  // Create a completely fresh client with new WebSocket session.
  // IMPORTANT: The DingTalk SDK has a shared `defaultConfig.subscriptions` array bug:
  // the constructor spreads defaultConfig (shallow copy), so config.subscriptions
  // points to the same array.  registerCallbackListener pushes to it, mutating
  // the shared default.  After N reconnects, getEndpoint() sends N duplicate
  // CALLBACK entries, which can prevent the server from sending REGISTERED.
  // Fix: reset subscriptions to the default before registering our callback.
  const newClient = createDingTalkClient(ctx.dingtalkCfg, ctx.accountId);
  newClient.config.subscriptions = [{ type: "EVENT", topic: "*" }];
  newClient.registerCallbackListener(TOPIC_ROBOT, ctx.messageHandler);

  logger.log("dingtalk: hard reconnect - fresh client created, connecting...");

  await raceWithTimeout(newClient.connect(), 30_000, "connect timeout");

  // Only wait for WebSocket open, not REGISTERED.
  await waitForConnected(newClient, WAIT_FOR_CONNECTED_TIMEOUT);

  // Replace the old client in the active map
  activeClients.set(clientKey, newClient);
}

function cleanupClientInternalState(client: DWClient): void {
  const c = client as unknown as Record<string, unknown>;

  // Clear old keepAlive heartbeat timer to prevent leaks
  if (c.heartbeatIntervallId !== undefined) {
    clearInterval(c.heartbeatIntervallId as ReturnType<typeof setInterval>);
    c.heartbeatIntervallId = undefined;
  }

  // Gracefully close the old WebSocket so the DingTalk server receives a proper
  // close frame and invalidates the session.
  const socket = c.socket as { removeAllListeners?: () => void; close?: () => void; terminate?: () => void } | undefined;
  if (socket) {
    if (socket.removeAllListeners) {
      try { socket.removeAllListeners(); } catch { /* ignore */ }
    }
    if (socket.close) {
      try { socket.close(); } catch { /* ignore */ }
    } else if (socket.terminate) {
      try { socket.terminate(); } catch { /* ignore */ }
    }
  }
  c.socket = undefined;

  // Mark as user-initiated disconnect to prevent any SDK auto-reconnect race
  c.userDisconnect = true;

  // Reset SDK internal flags so connect() starts fresh
  c.connected = false;
  c.registered = false;
  c.reconnecting = false;
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(reason)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function waitForConnected(client: DWClient, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (client.connected) {
      resolve();
      return;
    }
    const start = Date.now();
    const check = () => {
      if (client.connected) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("connection timeout (not connected)"));
        return;
      }
      setTimeout(check, 500);
    };
    check();
  });
}

function cleanupTempFiles(log: (msg: string) => void): void {
  try {
    const tmpDir = os.tmpdir();
    const entries = fs.readdirSync(tmpDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    let cleaned = 0;

    for (const entry of entries) {
      if (!/^dingtalk_\d+\..+$/.test(entry)) continue;

      try {
        const fullPath = path.join(tmpDir, entry);
        const stats = fs.statSync(fullPath);
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(fullPath);
          cleaned++;
        }
      } catch {
        // Skip files that can't be accessed
      }
    }

    if (cleaned > 0) {
      log(`dingtalk: cleaned up ${cleaned} stale temp files`);
    }
  } catch (err) {
    log(`dingtalk: temp file cleanup failed: ${String(err)}`);
  }
}
