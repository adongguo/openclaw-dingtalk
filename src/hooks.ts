/**
 * DingTalk lifecycle hooks — lightweight observability and format helpers.
 *
 * Registered via `api.on()` in the plugin entry point.
 * All handlers are non-blocking and best-effort (errors are caught internally).
 */

import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";

// ---------------------------------------------------------------------------
// Types (mirrored from OpenClaw plugin hook signatures)
// ---------------------------------------------------------------------------

interface MessageReceivedEvent {
  from: string;
  content: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

interface MessageReceivedContext {
  channelId: string;
  accountId?: string;
  conversationId?: string;
}

interface MessageSendingEvent {
  to: string;
  content: string;
  metadata?: Record<string, unknown>;
}

interface MessageSendingContext {
  channelId: string;
  accountId?: string;
  conversationId?: string;
}

interface MessageSendingResult {
  content?: string;
  cancel?: boolean;
}

interface GatewayStartEvent {
  port: number;
}

interface GatewayStartContext {
  port?: number;
}

interface GatewayStopEvent {
  reason?: string;
}

interface GatewayStopContext {
  port?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate a string for log output. */
function preview(text: string, max = 80): string {
  if (!text) return "(empty)";
  const oneline = text.replace(/\s+/g, " ").trim();
  return oneline.length > max ? `${oneline.slice(0, max)}…` : oneline;
}

/** Detect whether content looks like markdown. */
function looksLikeMarkdown(content: string): boolean {
  if (!content) return false;
  return /^#{1,6}\s|\*\*|__|\[.*\]\(.*\)|```|^\s*[-*]\s/m.test(content);
}

// ---------------------------------------------------------------------------
// Hook handlers
// ---------------------------------------------------------------------------

function onMessageReceived(event: MessageReceivedEvent, ctx: MessageReceivedContext): void {
  if (ctx.channelId !== "dingtalk") return;

  const source = ctx.conversationId ? "group" : "DM";
  const acct = ctx.accountId ?? "default";
  const snippet = preview(event.content);

  console.log(
    `[dingtalk:hook] message_received | ${source} | from=${event.from} | account=${acct} | ${snippet}`,
  );
}

function onMessageSending(
  event: MessageSendingEvent,
  ctx: MessageSendingContext,
): MessageSendingResult | void {
  if (ctx.channelId !== "dingtalk") return;

  const snippet = preview(event.content);
  const acct = ctx.accountId ?? "default";

  console.log(
    `[dingtalk:hook] message_sending | to=${event.to} | account=${acct} | ${snippet}`,
  );

  // If the outgoing content looks like markdown, tag it in metadata so
  // downstream renderers (e.g. ActionCard) can pick it up.  We do NOT
  // transform the content itself — that is handled by the outbound adapter.
  if (looksLikeMarkdown(event.content)) {
    console.log(`[dingtalk:hook] message_sending | markdown detected`);
  }

  // Return void — no modification to the message.
  return undefined;
}

function onGatewayStart(event: GatewayStartEvent, _ctx: GatewayStartContext): void {
  console.log(
    `[dingtalk:hook] gateway_start | port=${event.port}`,
  );
}

function onGatewayStop(event: GatewayStopEvent, _ctx: GatewayStopContext): void {
  console.log(
    `[dingtalk:hook] gateway_stop | reason=${event.reason ?? "unknown"}`,
  );
}

// ---------------------------------------------------------------------------
// Public registration
// ---------------------------------------------------------------------------

/**
 * Register DingTalk lifecycle hooks on the plugin API.
 *
 * Call once during plugin `register()`.
 */
export function registerDingTalkHooks(api: ClawdbotPluginApi): void {
  // Guard: `api.on` may not exist on older host versions.
  const on = (api as Record<string, unknown>).on as
    | ((name: string, handler: (...args: unknown[]) => unknown, opts?: { priority?: number }) => void)
    | undefined;

  if (!on) {
    console.log("[dingtalk:hook] api.on() not available — skipping hook registration");
    return;
  }

  on.call(api, "message_received", onMessageReceived, { priority: 100 });
  on.call(api, "message_sending", onMessageSending, { priority: 100 });
  on.call(api, "gateway_start", onGatewayStart, { priority: 100 });
  on.call(api, "gateway_stop", onGatewayStop, { priority: 100 });

  console.log("[dingtalk:hook] lifecycle hooks registered");
}
