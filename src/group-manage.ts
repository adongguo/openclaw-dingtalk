/**
 * Group management operations for DingTalk.
 *
 * Uses the legacy /chat/update API (requires access_token as query parameter)
 * to rename groups and manage group membership.
 *
 * API docs: https://open.dingtalk.com/document/orgapp/modify-a-group-session
 */

import type { DingTalkConfig } from "./types.js";
import { getAccessToken } from "./ai-card.js";

const DINGTALK_OLD_API = "https://oapi.dingtalk.com";

// ============ Types ============

interface ChatUpdateResponse {
  errcode: number;
  errmsg: string;
}

// ============ Core ============

async function chatUpdate(
  config: DingTalkConfig,
  body: Record<string, unknown>,
): Promise<ChatUpdateResponse> {
  const token = await getAccessToken(config);
  const url = `${DINGTALK_OLD_API}/chat/update?access_token=${encodeURIComponent(token)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[DingTalk][GroupManage] chat/update failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as ChatUpdateResponse;
  if (data.errcode !== 0) {
    throw new Error(`[DingTalk][GroupManage] chat/update error: ${data.errcode} ${data.errmsg}`);
  }
  return data;
}

// ============ Public API ============

/**
 * Rename a group chat.
 */
export async function renameGroup(
  chatId: string,
  name: string,
  config: DingTalkConfig,
): Promise<void> {
  await chatUpdate(config, { chatid: chatId, name });
}

/**
 * Add members to a group chat.
 */
export async function addGroupMembers(
  chatId: string,
  userIds: string[],
  config: DingTalkConfig,
): Promise<void> {
  await chatUpdate(config, { chatid: chatId, add_useridlist: userIds });
}

/**
 * Remove members from a group chat.
 */
export async function removeGroupMembers(
  chatId: string,
  userIds: string[],
  config: DingTalkConfig,
): Promise<void> {
  await chatUpdate(config, { chatid: chatId, del_useridlist: userIds });
}
