/**
 * OpenAPI-based message sending for DingTalk.
 *
 * Supports proactive messaging (without sessionWebhook) via:
 * - POST /v1.0/robot/oToMessages/batchSend  (BatchSendOTO for 1:1 DM)
 * - POST /v1.0/robot/groupMessages/send      (orgGroupSend for groups)
 */

import type { DingTalkConfig } from "./types.js";
import { getAccessToken } from "./ai-card.js";

// ============ Constants ============

const DINGTALK_API = "https://api.dingtalk.com";

// ============ Types ============

export type OpenAPISendTarget =
  | { kind: "user"; id: string }
  | { kind: "group"; id: string };

export type OpenAPIMsgKey =
  | "sampleText"
  | "sampleMarkdown"
  | "sampleImageMsg"
  | "sampleFile"
  | "sampleActionCard"
  | "sampleLink";

export type OpenAPISendRequest = {
  config: DingTalkConfig;
  target: OpenAPISendTarget;
  msgKey: OpenAPIMsgKey;
  msgParam: Record<string, unknown>;
};

export type OpenAPISendResult = {
  processQueryKey: string;
};

interface Logger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

// ============ Core Send Function ============

export async function sendViaOpenAPI(
  request: OpenAPISendRequest,
  log?: Logger,
): Promise<OpenAPISendResult> {
  const { config, target, msgKey, msgParam } = request;
  const token = await getAccessToken(config);
  const robotCode = config.robotCode?.trim() || config.appKey?.trim() || "";

  if (!robotCode) {
    throw new Error("[DingTalk][OpenAPI] robotCode or appKey is required");
  }

  const msgParamStr = JSON.stringify(msgParam);

  if (target.kind === "user") {
    return sendBatchOTO({ token, robotCode, staffId: target.id, msgKey, msgParamStr, log });
  }

  return sendGroupMessage({ token, robotCode, conversationId: target.id, msgKey, msgParamStr, log });
}

// ============ Convenience Functions ============

export async function sendTextViaOpenAPI(params: {
  config: DingTalkConfig;
  target: OpenAPISendTarget;
  content: string;
  log?: Logger;
}): Promise<OpenAPISendResult> {
  return sendViaOpenAPI(
    {
      config: params.config,
      target: params.target,
      msgKey: "sampleText",
      msgParam: { content: params.content },
    },
    params.log,
  );
}

export async function sendMarkdownViaOpenAPI(params: {
  config: DingTalkConfig;
  target: OpenAPISendTarget;
  title: string;
  text: string;
  log?: Logger;
}): Promise<OpenAPISendResult> {
  return sendViaOpenAPI(
    {
      config: params.config,
      target: params.target,
      msgKey: "sampleMarkdown",
      msgParam: { title: params.title, text: params.text },
    },
    params.log,
  );
}

export async function sendImageViaOpenAPI(params: {
  config: DingTalkConfig;
  target: OpenAPISendTarget;
  photoURL: string;
  log?: Logger;
}): Promise<OpenAPISendResult> {
  return sendViaOpenAPI(
    {
      config: params.config,
      target: params.target,
      msgKey: "sampleImageMsg",
      msgParam: { photoURL: params.photoURL },
    },
    params.log,
  );
}

export async function sendFileViaOpenAPI(params: {
  config: DingTalkConfig;
  target: OpenAPISendTarget;
  mediaId: string;
  fileName: string;
  fileType: string;
  log?: Logger;
}): Promise<OpenAPISendResult> {
  return sendViaOpenAPI(
    {
      config: params.config,
      target: params.target,
      msgKey: "sampleFile",
      msgParam: { mediaId: params.mediaId, fileName: params.fileName, fileType: params.fileType },
    },
    params.log,
  );
}

export async function sendActionCardViaOpenAPI(params: {
  config: DingTalkConfig;
  target: OpenAPISendTarget;
  title: string;
  text: string;
  singleTitle?: string;
  singleURL?: string;
  log?: Logger;
}): Promise<OpenAPISendResult> {
  const msgParam: Record<string, unknown> = {
    title: params.title,
    text: params.text,
  };
  if (params.singleTitle) {
    msgParam.singleTitle = params.singleTitle;
  }
  if (params.singleURL) {
    msgParam.singleURL = params.singleURL;
  }
  return sendViaOpenAPI(
    {
      config: params.config,
      target: params.target,
      msgKey: "sampleActionCard",
      msgParam,
    },
    params.log,
  );
}

// ============ Private Helpers ============

async function sendBatchOTO(params: {
  token: string;
  robotCode: string;
  staffId: string;
  msgKey: string;
  msgParamStr: string;
  log?: Logger;
}): Promise<OpenAPISendResult> {
  const { token, robotCode, staffId, msgKey, msgParamStr, log } = params;

  log?.info?.(`[DingTalk][OpenAPI] BatchSendOTO to user=${staffId}, msgKey=${msgKey}`);

  const response = await fetch(`${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": token,
    },
    body: JSON.stringify({
      robotCode,
      userIds: [staffId],
      msgKey,
      msgParam: msgParamStr,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[DingTalk][OpenAPI] BatchSendOTO failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { processQueryKey?: string };
  return { processQueryKey: data.processQueryKey ?? "" };
}

async function sendGroupMessage(params: {
  token: string;
  robotCode: string;
  conversationId: string;
  msgKey: string;
  msgParamStr: string;
  log?: Logger;
}): Promise<OpenAPISendResult> {
  const { token, robotCode, conversationId, msgKey, msgParamStr, log } = params;

  log?.info?.(`[DingTalk][OpenAPI] GroupSend to group=${conversationId}, msgKey=${msgKey}`);

  const response = await fetch(`${DINGTALK_API}/v1.0/robot/groupMessages/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": token,
    },
    body: JSON.stringify({
      robotCode,
      openConversationId: conversationId,
      msgKey,
      msgParam: msgParamStr,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[DingTalk][OpenAPI] GroupSend failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { processQueryKey?: string };
  return { processQueryKey: data.processQueryKey ?? "" };
}
