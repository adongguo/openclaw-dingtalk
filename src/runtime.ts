import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setDingTalkRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getDingTalkRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("DingTalk runtime not initialized");
  }
  return runtime;
}

// ── Session Webhook Cache ──
// Two-level cache:
// 1. Per conversationId (for precise targeting)
// 2. Per senderId (for DM routing — same user may have different conversationIds across clients)

interface WebhookEntry {
  url: string;
  conversationId: string;
  expiresAt: number;
  updatedAt: number;
}

const webhookByConversation = new Map<string, WebhookEntry>();
const webhookBySender = new Map<string, WebhookEntry>();

// ── Conversation → AccountId Mapping ──
// Tracks which bot account owns each conversationId (group or DM).
// Populated on incoming messages.
const conversationAccountMap = new Map<string, string>();

/** Record that a conversationId belongs to a specific accountId. */
export function trackConversationAccount(conversationId: string, accountId: string): void {
  conversationAccountMap.set(conversationId, accountId);
}

/** Look up which accountId owns a conversationId. */
export function getConversationAccountId(conversationId: string): string | undefined {
  return conversationAccountMap.get(conversationId);
}

/** Cache a sessionWebhook (called from bot.ts on each incoming message). */
export function cacheSessionWebhook(
  conversationId: string,
  url: string,
  expiresAt?: number,
  senderId?: string,
) {
  const entry: WebhookEntry = {
    url,
    conversationId,
    expiresAt: expiresAt ?? Date.now() + 3600_000,
    updatedAt: Date.now(),
  };
  webhookByConversation.set(conversationId, entry);

  // For DM: also cache by senderId so we can find the latest webhook
  // regardless of which client/conversationId was used
  if (senderId) {
    const existing = webhookBySender.get(senderId);
    if (!existing || entry.updatedAt > existing.updatedAt) {
      webhookBySender.set(senderId, entry);
    }
  }
}

/** Get the latest cached webhook for a conversation, or the most recent one. */
export function getCachedWebhook(conversationId?: string): string | undefined {
  const now = Date.now();
  if (conversationId) {
    const entry = webhookByConversation.get(conversationId);
    if (entry && entry.expiresAt > now) return entry.url;
  }
  // Fallback: return most recent non-expired webhook
  let best: WebhookEntry | undefined;
  for (const entry of webhookByConversation.values()) {
    if (entry.expiresAt > now && (!best || entry.updatedAt > best.updatedAt)) {
      best = entry;
    }
  }
  return best?.url;
}

/**
 * Get the latest webhook for a sender (across all their conversationIds).
 * This is critical for DM routing — the same user may DM the bot from
 * different clients, each producing a different conversationId.
 * We always want to reply to the MOST RECENT conversation.
 */
export function getLatestWebhookForSender(senderId: string): WebhookEntry | undefined {
  const now = Date.now();
  const entry = webhookBySender.get(senderId);
  if (entry && entry.expiresAt > now) return entry;
  return undefined;
}

/**
 * Get the latest webhook for a conversation, with sender fallback.
 * Priority: exact conversationId match > latest for sender > global fallback.
 */
export function resolveWebhook(params: {
  conversationId?: string;
  senderId?: string;
}): string | undefined {
  const now = Date.now();

  // 1. Exact conversationId match
  if (params.conversationId) {
    const entry = webhookByConversation.get(params.conversationId);
    if (entry && entry.expiresAt > now) return entry.url;
  }

  // 2. Latest for sender (handles multi-client DM case)
  if (params.senderId) {
    const entry = webhookBySender.get(params.senderId);
    if (entry && entry.expiresAt > now) return entry.url;
  }

  // 3. Global fallback
  return getCachedWebhook();
}
