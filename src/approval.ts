/**
 * Approval (审批) workflow operations for DingTalk.
 *
 * Uses the old-style oapi.dingtalk.com APIs:
 * - POST /topapi/processinstance/create
 * - POST /topapi/processinstance/get
 * - POST /topapi/processinstance/listids
 */

import type { DingTalkConfig } from "./types.js";
import { getAccessToken } from "./ai-card.js";
import type { ClawdbotPluginApi } from "openclaw/plugin-sdk";

const DINGTALK_OAPI = "https://oapi.dingtalk.com";

// ============ Types ============

export interface FormComponentValue {
  /** Field name (表单控件名称) */
  name: string;
  /** Field value */
  value: string;
}

export interface CreateApprovalParams {
  /** Approval process code */
  processCode: string;
  /** Originator user ID (staff ID) */
  originatorUserId: string;
  /** Department ID of the originator */
  deptId: number;
  /** Form values */
  formComponentValues: FormComponentValue[];
  /** Optional list of approver user IDs */
  approvers?: string;
  /** Optional CC user IDs */
  ccList?: string;
  /** Optional CC position: START, FINISH, START_FINISH */
  ccPosition?: string;
}

export interface CreateApprovalResult {
  processInstanceId: string;
}

export interface ApprovalDetail {
  title?: string;
  status?: string;
  result?: string;
  createTime?: string;
  finishTime?: string;
  originatorUserId?: string;
  originatorDeptName?: string;
  formComponentValues?: Array<{ name?: string; value?: string }>;
  operationRecords?: Array<{
    userId?: string;
    date?: string;
    type?: string;
    result?: string;
    remark?: string;
  }>;
  [key: string]: unknown;
}

export interface ListApprovalIdsParams {
  processCode: string;
  startTime: number;
  endTime?: number;
  size?: number;
  cursor?: number;
  userIds?: string[];
  statuses?: string[];
}

export interface ListApprovalIdsResult {
  list: string[];
  nextCursor?: number;
}

// ============ Helper ============

async function oapiPost<T>(
  config: DingTalkConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = await getAccessToken(config);
  const url = `${DINGTALK_OAPI}${path}?access_token=${token}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[DingTalk][approval] ${path} failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { errcode?: number; errmsg?: string } & T;
  if (data.errcode && data.errcode !== 0) {
    throw new Error(`[DingTalk][approval] ${path} error: ${data.errcode} ${data.errmsg}`);
  }

  return data;
}

// ============ Functions ============

/**
 * Create an approval instance.
 */
export async function createApproval(
  config: DingTalkConfig,
  params: CreateApprovalParams,
): Promise<CreateApprovalResult> {
  const body: Record<string, unknown> = {
    process_code: params.processCode,
    originator_user_id: params.originatorUserId,
    dept_id: params.deptId,
    form_component_values: params.formComponentValues.map((v) => ({
      name: v.name,
      value: v.value,
    })),
  };

  if (params.approvers) body.approvers = params.approvers;
  if (params.ccList) body.cc_list = params.ccList;
  if (params.ccPosition) body.cc_position = params.ccPosition;

  const data = await oapiPost<{ process_instance_id?: string }>(
    config,
    "/topapi/processinstance/create",
    body,
  );

  return { processInstanceId: data.process_instance_id ?? "" };
}

/**
 * Get approval instance detail.
 */
export async function getApprovalDetail(
  config: DingTalkConfig,
  processInstanceId: string,
): Promise<ApprovalDetail> {
  const data = await oapiPost<{ process_instance?: ApprovalDetail }>(
    config,
    "/topapi/processinstance/get",
    { process_instance_id: processInstanceId },
  );

  return data.process_instance ?? {};
}

/**
 * List approval instance IDs.
 */
export async function listApprovalIds(
  config: DingTalkConfig,
  params: ListApprovalIdsParams,
): Promise<ListApprovalIdsResult> {
  const body: Record<string, unknown> = {
    process_code: params.processCode,
    start_time: params.startTime,
  };

  if (params.endTime != null) body.end_time = params.endTime;
  if (params.size != null) body.size = params.size;
  if (params.cursor != null) body.cursor = params.cursor;
  if (params.userIds) body.userid_list = params.userIds.join(",");
  if (params.statuses) body.status_list = params.statuses.join(",");

  const data = await oapiPost<{
    result?: { list?: string[]; next_cursor?: number };
  }>(config, "/topapi/processinstance/listids", body);

  return {
    list: data.result?.list ?? [],
    nextCursor: data.result?.next_cursor,
  };
}

// ============ Tool Registration ============

/**
 * Register approval-related agent tools.
 */
export function registerApprovalTools(api: ClawdbotPluginApi): void {
  const registerTool = (api as Record<string, unknown>).registerTool as
    | ((tool: Record<string, unknown>) => void)
    | undefined;

  if (!registerTool) return;

  const config = (api as Record<string, unknown>).config as Record<string, unknown> | undefined;
  const dingtalkConfig = (config?.channels as Record<string, unknown>)?.dingtalk as
    | DingTalkConfig
    | undefined;

  registerTool({
    name: "dingtalk_create_approval",
    description:
      "发起钉钉审批实例。需要提供审批模板 processCode、发起人 userId、部门 ID 和表单字段值。",
    parameters: {
      type: "object",
      properties: {
        processCode: {
          type: "string",
          description: "审批模板的 processCode",
        },
        originatorUserId: {
          type: "string",
          description: "发起人的 staffId / userId",
        },
        deptId: {
          type: "number",
          description: "发起人所在部门 ID",
        },
        formComponentValues: {
          type: "array",
          description: "表单控件值列表",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "控件名称" },
              value: { type: "string", description: "控件值" },
            },
            required: ["name", "value"],
          },
        },
        approvers: {
          type: "string",
          description: "审批人 userId 列表（逗号分隔），可选",
        },
        ccList: {
          type: "string",
          description: "抄送人 userId 列表（逗号分隔），可选",
        },
        ccPosition: {
          type: "string",
          description: "抄送时机: START / FINISH / START_FINISH，可选",
        },
      },
      required: ["processCode", "originatorUserId", "deptId", "formComponentValues"],
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      if (!dingtalkConfig) {
        return { content: [{ type: "text", text: "Error: DingTalk config not available." }] };
      }
      try {
        const result = await createApproval(dingtalkConfig, {
          processCode: params.processCode as string,
          originatorUserId: params.originatorUserId as string,
          deptId: params.deptId as number,
          formComponentValues: params.formComponentValues as FormComponentValue[],
          approvers: params.approvers as string | undefined,
          ccList: params.ccList as string | undefined,
          ccPosition: params.ccPosition as string | undefined,
        });
        return {
          content: [
            {
              type: "text",
              text: `审批实例已创建，processInstanceId: ${result.processInstanceId}`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }] };
      }
    },
  });

  registerTool({
    name: "dingtalk_query_approval",
    description:
      "查询钉钉审批实例状态。可通过 processInstanceId 查询单个实例详情，" +
      "或通过 processCode + startTime 列出实例 ID 列表。",
    parameters: {
      type: "object",
      properties: {
        processInstanceId: {
          type: "string",
          description: "审批实例 ID（查询单个实例详情时使用）",
        },
        processCode: {
          type: "string",
          description: "审批模板 processCode（列出实例 ID 列表时使用）",
        },
        startTime: {
          type: "number",
          description: "起始时间戳（毫秒），列出实例时必填",
        },
        endTime: {
          type: "number",
          description: "结束时间戳（毫秒），可选",
        },
        size: {
          type: "number",
          description: "每页大小，默认 10，最大 20",
        },
        cursor: {
          type: "number",
          description: "分页游标",
        },
      },
    },
    execute: async (_toolCallId: string, params: Record<string, unknown>) => {
      if (!dingtalkConfig) {
        return { content: [{ type: "text", text: "Error: DingTalk config not available." }] };
      }
      try {
        // If processInstanceId is given, get detail
        if (params.processInstanceId) {
          const detail = await getApprovalDetail(
            dingtalkConfig,
            params.processInstanceId as string,
          );
          return {
            content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
          };
        }

        // Otherwise list IDs
        if (!params.processCode || params.startTime == null) {
          return {
            content: [
              {
                type: "text",
                text: "Error: 需要提供 processInstanceId（查询详情）或 processCode + startTime（列出实例）。",
              },
            ],
          };
        }

        const result = await listApprovalIds(dingtalkConfig, {
          processCode: params.processCode as string,
          startTime: params.startTime as number,
          endTime: params.endTime as number | undefined,
          size: params.size as number | undefined,
          cursor: params.cursor as number | undefined,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }] };
      }
    },
  });
}
