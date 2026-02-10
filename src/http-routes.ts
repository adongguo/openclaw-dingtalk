/**
 * HTTP Routes for DingTalk
 *
 * Registers HTTP callback routes for DingTalk event subscriptions.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";

export type HttpRouteRegistrar = (params: {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}) => void;

export type HttpRoutesLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

/**
 * Parse JSON body from an incoming request.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Verify DingTalk callback signature.
 * DingTalk signs callbacks with HMAC-SHA256 using the appSecret.
 */
function verifySignature(
  timestamp: string,
  sign: string,
  appSecret: string,
): boolean {
  if (!timestamp || !sign || !appSecret) return false;
  try {
    const stringToSign = `${timestamp}\n${appSecret}`;
    const hmac = crypto.createHmac("sha256", appSecret);
    hmac.update(stringToSign);
    const expected = hmac.digest("base64");
    return expected === sign;
  } catch {
    return false;
  }
}

/**
 * Register DingTalk HTTP callback routes.
 */
export function registerDingTalkHttpRoutes(params: {
  registerHttpRoute: HttpRouteRegistrar;
  appSecret?: string;
  log?: HttpRoutesLogger;
}): void {
  const { registerHttpRoute, appSecret, log } = params;

  registerHttpRoute({
    path: "/dingtalk/callback",
    handler: async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Method not allowed" }));
        return;
      }

      try {
        const body = await readBody(req);
        const payload = JSON.parse(body) as Record<string, unknown>;

        // Verify signature if appSecret is configured
        const timestamp = (req.headers["timestamp"] ?? payload.timestamp) as string | undefined;
        const sign = (req.headers["sign"] ?? payload.sign) as string | undefined;

        if (appSecret && timestamp && sign) {
          if (!verifySignature(timestamp, sign, appSecret)) {
            log?.warn("[DingTalk][HTTP] Callback signature verification failed");
            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: "Invalid signature" }));
            return;
          }
        }

        const eventType = payload.EventType ?? payload.eventType ?? "unknown";
        log?.info(`[DingTalk][HTTP] Received callback event: ${eventType}`);

        // Return success to acknowledge receipt
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        log?.error(
          `[DingTalk][HTTP] Callback error: ${err instanceof Error ? err.message : String(err)}`,
        );
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Invalid request" }));
      }
    },
  });
}
