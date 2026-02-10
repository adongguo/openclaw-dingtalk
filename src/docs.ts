/**
 * Document APIs for DingTalk.
 *
 * Uses new API (api.dingtalk.com):
 * - POST /v1.0/doc/workspaces/{workspaceId}/docs
 * - GET  /v1.0/doc/workspaces/{workspaceId}/docs
 */

import type { DingTalkConfig } from "./types.js";
import { getAccessToken } from "./ai-card.js";

// ============ Constants ============

const DINGTALK_API = "https://api.dingtalk.com";

// ============ Types ============

export interface CreateDocumentParams {
  workspaceId: string;
  name: string;
  docType?: string; // e.g. "alidoc", "document"
  operatorId: string; // union id of the creator
  parentNodeId?: string;
  extra?: Record<string, unknown>;
}

export interface ListDocumentsParams {
  workspaceId: string;
  operatorId: string;
  maxResults?: number;
  nextToken?: string;
  parentNodeId?: string;
}

export interface DocumentInfo {
  nodeId?: string;
  name?: string;
  docType?: string;
  url?: string;
  [key: string]: unknown;
}

// ============ Helper ============

async function dingtalkNewAPI(
  config: DingTalkConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, string>,
  accountId?: string,
): Promise<unknown> {
  const token = await getAccessToken(config, accountId);
  let url = `${DINGTALK_API}${path}`;
  if (query && Object.keys(query).length > 0) {
    url += "?" + new URLSearchParams(query).toString();
  }

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": token,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[DingTalk][Docs] ${method} ${path} failed: ${response.status} ${text}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 204 || !contentType.includes("json")) {
    return {};
  }
  return response.json();
}

// ============ API Functions ============

/**
 * Create a document in a workspace.
 */
export async function createDocument(
  config: DingTalkConfig,
  params: CreateDocumentParams,
  accountId?: string,
): Promise<DocumentInfo> {
  const { workspaceId, operatorId, extra, ...docBody } = params;
  const body: Record<string, unknown> = { ...docBody, ...extra };

  const result = await dingtalkNewAPI(
    config,
    "POST",
    `/v1.0/doc/workspaces/${workspaceId}/docs`,
    body,
    { operatorId },
    accountId,
  );
  return result as DocumentInfo;
}

/**
 * List documents in a workspace.
 */
export async function listDocuments(
  config: DingTalkConfig,
  params: ListDocumentsParams,
  accountId?: string,
): Promise<{ nodes: DocumentInfo[]; nextToken?: string }> {
  const { workspaceId, operatorId, ...rest } = params;
  const query: Record<string, string> = { operatorId };
  if (rest.maxResults) query.maxResults = String(rest.maxResults);
  if (rest.nextToken) query.nextToken = rest.nextToken;
  if (rest.parentNodeId) query.parentNodeId = rest.parentNodeId;

  const result = (await dingtalkNewAPI(
    config,
    "GET",
    `/v1.0/doc/workspaces/${workspaceId}/docs`,
    undefined,
    query,
    accountId,
  )) as { nodes?: DocumentInfo[]; nextToken?: string };

  return { nodes: result.nodes ?? [], nextToken: result.nextToken };
}
