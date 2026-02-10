/**
 * Background Services for DingTalk
 *
 * Registers background services such as session cleanup.
 */

import { cleanupExpiredSessions, DEFAULT_SESSION_TIMEOUT } from "./session.js";

export type ServiceLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
};

/** Cleanup interval: every 5 minutes */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Create the DingTalk session cleanup service definition.
 */
export function createDingTalkSessionCleanupService(params?: {
  sessionTimeout?: number;
  intervalMs?: number;
}): {
  id: string;
  start: (ctx: { logger: ServiceLogger }) => void;
  stop?: () => void;
} {
  const timeout = params?.sessionTimeout ?? DEFAULT_SESSION_TIMEOUT;
  const interval = params?.intervalMs ?? CLEANUP_INTERVAL_MS;

  return {
    id: "dingtalk-session-cleanup",
    start: (ctx) => {
      ctx.logger.info(
        `[DingTalk][Service] Starting session cleanup service (interval: ${interval}ms, timeout: ${timeout}ms)`,
      );
      // Run once immediately
      try {
        const cleaned = cleanupExpiredSessions(timeout);
        if (cleaned > 0) {
          ctx.logger.info(`[DingTalk][Service] Cleaned up ${cleaned} expired sessions`);
        }
      } catch (err) {
        ctx.logger.error(
          `[DingTalk][Service] Cleanup error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Schedule periodic cleanup
      cleanupTimer = setInterval(() => {
        try {
          const cleaned = cleanupExpiredSessions(timeout);
          if (cleaned > 0) {
            ctx.logger.info(`[DingTalk][Service] Cleaned up ${cleaned} expired sessions`);
          }
        } catch (err) {
          ctx.logger.error(
            `[DingTalk][Service] Cleanup error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }, interval);

      // Don't block process exit
      if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
        cleanupTimer.unref();
      }
    },
    stop: () => {
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
    },
  };
}
