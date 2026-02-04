import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import type { DingTalkConfig, DingTalkIncomingMessage } from "./types.js";
import { createDingTalkClient } from "./client.js";
import { resolveDingTalkCredentials } from "./accounts.js";
import { handleDingTalkMessage } from "./bot.js";

export type MonitorDingTalkOpts = {
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};

let currentClient: DWClient | null = null;

export async function monitorDingTalkProvider(opts: MonitorDingTalkOpts = {}): Promise<void> {
  const cfg = opts.config;
  if (!cfg) {
    throw new Error("Config is required for DingTalk monitor");
  }

  const dingtalkCfg = cfg.channels?.dingtalk as DingTalkConfig | undefined;
  const creds = resolveDingTalkCredentials(dingtalkCfg);
  if (!creds) {
    throw new Error("DingTalk credentials not configured (appKey, appSecret required)");
  }

  const log = opts.runtime?.log ?? console.log;

  const connectionMode = dingtalkCfg?.connectionMode ?? "stream";

  if (connectionMode === "stream") {
    return monitorStream({ cfg, dingtalkCfg: dingtalkCfg!, runtime: opts.runtime, abortSignal: opts.abortSignal });
  }

  log("dingtalk: webhook mode not implemented in monitor, use HTTP server directly");
}

async function monitorStream(params: {
  cfg: ClawdbotConfig;
  dingtalkCfg: DingTalkConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const { cfg, dingtalkCfg, runtime, abortSignal } = params;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  log("dingtalk: starting Stream connection...");

  const client = createDingTalkClient(dingtalkCfg);
  currentClient = client;

  const chatHistories = new Map<string, HistoryEntry[]>();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (currentClient === client) {
        try {
          client.disconnect();
        } catch {
          // Ignore disconnect errors
        }
        currentClient = null;
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
      // Register callback listener for robot messages
      client.registerCallbackListener(TOPIC_ROBOT, async (res) => {
        try {
          const messageData = JSON.parse(res.data) as DingTalkIncomingMessage;
          log(`dingtalk: received message from ${messageData.senderNick}: ${messageData.text?.content || messageData.msgtype}`);

          // Debug: log raw payload for media messages to diagnose downloadCode availability
          const mediaTypes = ["image", "picture", "file", "voice", "video"];
          if (mediaTypes.includes(messageData.msgtype)) {
            log(`dingtalk: raw media message payload: ${res.data}`);
          }

          await handleDingTalkMessage({
            cfg,
            message: messageData,
            runtime,
            chatHistories,
            client,
          });

          // Acknowledge the message
          client.socketCallBackResponse(res.headers.messageId, { success: true });
        } catch (err) {
          error(`dingtalk: error handling message: ${String(err)}`);
          // Still acknowledge to prevent redelivery
          client.socketCallBackResponse(res.headers.messageId, { success: false, error: String(err) });
        }
      });

      // Connect to DingTalk Stream
      client.connect();
      log("dingtalk: Stream client connected");
    } catch (err) {
      cleanup();
      abortSignal?.removeEventListener("abort", handleAbort);
      reject(err);
    }
  });
}

export function stopDingTalkMonitor(): void {
  if (currentClient) {
    try {
      currentClient.disconnect();
    } catch {
      // Ignore errors
    }
    currentClient = null;
  }
}
