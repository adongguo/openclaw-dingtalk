/**
 * Message operations for DingTalk: recall, read receipt, pin.
 */

import type { DingTalkConfig } from "./types.js";
import { getAccessToken } from "./ai-card.js";

const DINGTALK_API = "https://api.dingtalk.com";
const DINGTALK_OAPI = "https://oapi.dingtalk.com";

// ============ Types ============

export interface RecallMessageParams {
  /** The processQueryKey returned when the message was sent via OpenAPI */
  processQueryKey: string;
  /** The openConversationId of the group */
  openConversationId: string;
}

export interface ReadReceiptParams {
  /** The task_id from corpconversation async send */
  taskId: string;
  /** Agent ID for work notification */
  agentId: string;
}

export interface ReadReceiptResult {
  readUserIdList: string[];
  unreadUserIdList: string[];
}

export interface PinMessageParams {
  /** Message ID to pin */
  messageId: string;
  /** Open conversation ID */
  openConversationId: string;
}

// ============ Functions ============

/**
 * Recall a robot group message.
 * POST /v1.0/robot/groupMessages/recall
 */
export async function recallMessage(
  config: DingTalkConfig,
  params: RecallMessageParams,
): Promise<void> {
  const token = await getAccessToken(config);
  const robotCode = config.robotCode?.trim() || config.appKey?.trim() || "";

  if (!robotCode) {
    throw new Error("[DingTalk][recallMessage] robotCode or appKey is required");
  }

  const response = await fetch(`${DINGTALK_API}/v1.0/robot/groupMessages/recall`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": token,
    },
    body: JSON.stringify({
      robotCode,
      openConversationId: params.openConversationId,
      processQueryKeys: [params.processQueryKey],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[DingTalk][recallMessage] failed: ${response.status} ${text}`);
  }
}

/**
 * Get read receipt for a work notification (corpconversation).
 * POST /topapi/message/corpconversation/getsendresult
 */
export async function getReadReceipt(
  config: DingTalkConfig,
  params: ReadReceiptParams,
): Promise<ReadReceiptResult> {
  const token = await getAccessToken(config);

  const response = await fetch(
    `${DINGTALK_OAPI}/topapi/message/corpconversation/getsendresult?access_token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: params.agentId,
        task_id: params.taskId,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[DingTalk][getReadReceipt] failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    errcode?: number;
    errmsg?: string;
    send_result?: {
      read_user_id_list?: string[];
      unread_user_id_list?: string[];
    };
  };

  if (data.errcode && data.errcode !== 0) {
    throw new Error(`[DingTalk][getReadReceipt] API error: ${data.errcode} ${data.errmsg}`);
  }

  return {
    readUserIdList: data.send_result?.read_user_id_list ?? [],
    unreadUserIdList: data.send_result?.unread_user_id_list ?? [],
  };
}

/**
 * Pin a message (stub — DingTalk may not expose this API publicly).
 */
export async function pinMessage(
  _config: DingTalkConfig,
  _params: PinMessageParams,
): Promise<{ ok: boolean; message: string }> {
  return {
    ok: false,
    message: "Message pinning is not yet supported by the DingTalk bot API.",
  };
}
