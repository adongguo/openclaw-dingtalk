import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { dingtalkPlugin } from "./src/channel.js";
import { setDingTalkRuntime } from "./src/runtime.js";

export { monitorDingTalkProvider } from "./src/monitor.js";
export {
  sendMessageDingTalk,
  sendMarkdownDingTalk,
  sendActionCardDingTalk,
  sendViaWebhook,
  sendDingTalkMessage,
  sendDingTalkTextMessage,
} from "./src/send.js";
export {
  uploadMediaDingTalk,
  downloadMediaDingTalk,
  sendImageDingTalk,
  sendFileDingTalk,
  sendMediaDingTalk,
  buildMediaSystemPrompt,
  processLocalImages,
  getOapiAccessToken,
  // File marker processing
  extractFileMarkers,
  processFileMarkers,
  uploadAndSendFile,
  type FileMarkerInfo,
  type ExtractedFileMarker,
  type ProcessedFileResult,
} from "./src/media.js";
export { probeDingTalk } from "./src/probe.js";
export {
  addReactionDingTalk,
  removeReactionDingTalk,
  listReactionsDingTalk,
  DingTalkEmoji,
} from "./src/reactions.js";
export { dingtalkPlugin } from "./src/channel.js";

// OpenAPI-based sending (proactive messaging)
export {
  sendViaOpenAPI,
  sendTextViaOpenAPI,
  sendMarkdownViaOpenAPI,
  sendImageViaOpenAPI,
  sendFileViaOpenAPI,
  sendActionCardViaOpenAPI,
  type OpenAPISendTarget,
  type OpenAPIMsgKey,
  type OpenAPISendRequest,
  type OpenAPISendResult,
} from "./src/openapi-send.js";

// AI Card streaming
export {
  createAICard,
  streamAICard,
  finishAICard,
  failAICard,
  getAccessToken,
  clearAccessTokenCache,
  getOrCreateAICard,
  cleanupStaleAICards,
  AICardStatus,
  type AICardInstance,
  type AICardStatusType,
} from "./src/ai-card.js";

// Session management
export {
  isNewSessionCommand,
  getSessionKey,
  clearSession,
  getSessionInfo,
  clearAllSessions,
  getActiveSessionCount,
  cleanupExpiredSessions,
  getNewSessionCommands,
  DEFAULT_SESSION_TIMEOUT,
  type UserSession,
} from "./src/session.js";

// Gateway streaming
export {
  streamFromGateway,
  getGatewayCompletion,
  type GatewayOptions,
} from "./src/gateway-stream.js";

// Streaming message handler
export {
  handleDingTalkStreamingMessage,
  shouldUseStreamingMode,
  type StreamingHandlerParams,
} from "./src/streaming-handler.js";

// Message deduplication
export { isDuplicate } from "./src/dedup.js";

// Peer ID case registry
export { registerPeerId, resolveOriginalCase } from "./src/peer-id-registry.js";

// Retry utility
export { fetchWithRetry, type RetryConfig } from "./src/retry.js";

// Log masking
export { maskSensitive, maskLogObject } from "./src/log-mask.js";

// Group member tracking
export { trackGroupMember, getGroupMembers, getGroupMemberCount, clearGroupMembers } from "./src/group-members.js";

// SDK command handlers
export { formatStatusResponse, formatSessionsResponse, formatWhoamiResponse } from "./src/command-handlers.js";

// Agent tools
export { registerDingTalkTools } from "./src/agent-tools.js";

// Lifecycle hooks
export { registerDingTalkHooks } from "./src/hooks.js";

const plugin = {
  id: "dingtalk",
  name: "DingTalk",
  description: "DingTalk channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: ClawdbotPluginApi) {
    setDingTalkRuntime(api.runtime);
    api.registerChannel({ plugin: dingtalkPlugin });
    registerCommands(api);
    registerTools(api);
    registerHooks(api);
  },
};

export default plugin;

// ============ Private Functions ============

function registerCommands(api: ClawdbotPluginApi): void {
  const registerCommand = (api as Record<string, unknown>).registerCommand as
    | ((cmd: Record<string, unknown>) => void)
    | undefined;

  if (!registerCommand) return;

  registerCommand.call(api, {
    name: "dingtalk-status",
    description: "Show DingTalk connection status and active session count",
    handler: async (ctx: Record<string, unknown>) => {
      const { formatStatusResponse } = await import("./src/command-handlers.js");
      return formatStatusResponse(ctx.config);
    },
  });

  registerCommand.call(api, {
    name: "dingtalk-sessions",
    description: "List active DingTalk sessions",
    handler: async (ctx: Record<string, unknown>) => {
      const { formatSessionsResponse } = await import("./src/command-handlers.js");
      return formatSessionsResponse(ctx.config);
    },
  });

  registerCommand.call(api, {
    name: "dingtalk-whoami",
    description: "Show the sender's DingTalk staffId and permissions",
    handler: async (ctx: Record<string, unknown>) => {
      const { formatWhoamiResponse } = await import("./src/command-handlers.js");
      const senderId = (ctx.senderId ?? ctx.userId ?? "unknown") as string;
      return formatWhoamiResponse(senderId, ctx.config);
    },
  });
}

function registerTools(api: ClawdbotPluginApi): void {
  import("./src/agent-tools.js").then(({ registerDingTalkTools }) => {
    registerDingTalkTools(api);
  }).catch(() => {
    // Agent tools registration is optional; silently skip if module fails to load
  });
}

function registerHooks(api: ClawdbotPluginApi): void {
  import("./src/hooks.js").then(({ registerDingTalkHooks }) => {
    registerDingTalkHooks(api);
  }).catch(() => {
    // Hook registration is optional; silently skip if module fails to load
  });
}
