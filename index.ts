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

const plugin = {
  id: "dingtalk",
  name: "DingTalk",
  description: "DingTalk channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: ClawdbotPluginApi) {
    setDingTalkRuntime(api.runtime);
    api.registerChannel({ plugin: dingtalkPlugin });
  },
};

export default plugin;
