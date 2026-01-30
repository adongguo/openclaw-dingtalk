/**
 * Gateway SSE Streaming for DingTalk
 *
 * Connects to local Moltbot/Clawdbot Gateway for streaming chat completions.
 * Implements Server-Sent Events (SSE) client for real-time response streaming.
 */

// ============ Types ============

export interface GatewayOptions {
  userContent: string;
  systemPrompts: string[];
  sessionKey: string;
  gatewayUrl?: string; // Full URL or just hostname/port will be resolved
  gatewayPort?: number;
  gatewayAuth?: string; // token or password, both use Bearer format
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
}

// ============ Gateway Streaming ============

/**
 * Stream content from Gateway via SSE (Server-Sent Events).
 * Yields content chunks as they arrive.
 *
 * @param options - Gateway connection and message options
 * @returns AsyncGenerator yielding content chunks
 */
export async function* streamFromGateway(options: GatewayOptions): AsyncGenerator<string, void, unknown> {
  const { userContent, systemPrompts, sessionKey, gatewayUrl, gatewayPort, gatewayAuth, log } = options;

  // Resolve gateway URL
  let url: string;
  if (gatewayUrl) {
    url = gatewayUrl;
  } else {
    const port = gatewayPort || 18789;
    url = `http://127.0.0.1:${port}/v1/chat/completions`;
  }

  // Build messages
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  for (const prompt of systemPrompts) {
    messages.push({ role: "system", content: prompt });
  }
  messages.push({ role: "user", content: userContent });

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (gatewayAuth) {
    headers.Authorization = `Bearer ${gatewayAuth}`;
  }

  log?.info?.(`[DingTalk][Gateway] POST ${url}, session=${sessionKey}, messages=${messages.length}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "default",
        messages,
        stream: true,
        user: sessionKey,
      }),
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log?.error?.(`[DingTalk][Gateway] Connection failed: ${errMsg}`);
    throw new Error(`Gateway connection failed: ${errMsg}`);
  }

  log?.info?.(`[DingTalk][Gateway] Response status=${response.status}, ok=${response.ok}, hasBody=${!!response.body}`);

  if (!response.ok || !response.body) {
    let errText = "";
    try {
      errText = await response.text();
    } catch {
      errText = "(no body)";
    }
    log?.error?.(`[DingTalk][Gateway] Error response: ${errText}`);
    throw new Error(`Gateway error: ${response.status} - ${errText}`);
  }

  // Parse SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;

        const data = line.slice(6).trim();
        if (data === "[DONE]") return;

        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        } catch {
          // Ignore JSON parse errors for malformed chunks
          log?.warn?.(`[DingTalk][Gateway] Failed to parse chunk: ${data.slice(0, 100)}`);
        }
      }
    }

    // Handle any remaining buffered data
    if (buffer && buffer.startsWith("data: ")) {
      const data = buffer.slice(6).trim();
      if (data !== "[DONE]") {
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            yield content;
          }
        } catch {
          // Ignore
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Make a single (non-streaming) request to Gateway and get full response.
 */
export async function getGatewayCompletion(options: GatewayOptions): Promise<string> {
  let fullResponse = "";
  for await (const chunk of streamFromGateway(options)) {
    fullResponse += chunk;
  }
  return fullResponse;
}
