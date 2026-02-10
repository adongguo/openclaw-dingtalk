/**
 * Attendance APIs for DingTalk.
 *
 * Uses legacy oapi.dingtalk.com endpoints:
 * - POST /topapi/attendance/listrecord  (punch records)
 * - POST /topapi/attendance/list        (attendance results)
 */

import type { DingTalkConfig } from "./types.js";
import { getAccessToken } from "./client.js";

// ============ Constants ============

const OAPI_BASE = "https://oapi.dingtalk.com";

// ============ Types ============

export interface AttendanceRecordParams {
  userIds: string[];
  checkDateFrom: string; // "yyyy-MM-dd HH:mm:ss"
  checkDateTo: string;
}

export interface AttendanceResultParams {
  workDateFrom: string; // "yyyy-MM-dd HH:mm:ss"
  workDateTo: string;
  userIdList: string[];
  offset?: number;
  limit?: number; // max 50
}

export interface AttendanceRecord {
  id: number;
  userId: string;
  userCheckTime: string;
  checkType: string;
  locationResult: string;
  timeResult: string;
  [key: string]: unknown;
}

export interface AttendanceResult {
  id: number;
  userId: string;
  workDate: string;
  checkType: string;
  timeResult: string;
  locationResult: string;
  [key: string]: unknown;
}

// ============ API Functions ============

/**
 * Get attendance punch records.
 * API: POST /topapi/attendance/listrecord
 */
export async function getAttendanceRecords(
  config: DingTalkConfig,
  params: AttendanceRecordParams,
  accountId?: string,
): Promise<AttendanceRecord[]> {
  const token = await getAccessToken(config, accountId);
  const url = `${OAPI_BASE}/topapi/attendance/listrecord?access_token=${token}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userIds: params.userIds,
      checkDateFrom: params.checkDateFrom,
      checkDateTo: params.checkDateTo,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[DingTalk][Attendance] listrecord failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    errcode: number;
    errmsg: string;
    recordresult?: AttendanceRecord[];
  };

  if (data.errcode !== 0) {
    throw new Error(`[DingTalk][Attendance] listrecord error: ${data.errcode} ${data.errmsg}`);
  }

  return data.recordresult ?? [];
}

/**
 * Get attendance results (includes late/absent status).
 * API: POST /topapi/attendance/list
 */
export async function getAttendanceResults(
  config: DingTalkConfig,
  params: AttendanceResultParams,
  accountId?: string,
): Promise<{ records: AttendanceResult[]; hasMore: boolean }> {
  const token = await getAccessToken(config, accountId);
  const url = `${OAPI_BASE}/topapi/attendance/list?access_token=${token}`;

  const limit = Math.min(params.limit ?? 50, 50);
  const offset = params.offset ?? 0;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workDateFrom: params.workDateFrom,
      workDateTo: params.workDateTo,
      userIdList: params.userIdList,
      offset,
      limit,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`[DingTalk][Attendance] list failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    errcode: number;
    errmsg: string;
    recordresult?: AttendanceResult[];
    hasMore?: boolean;
  };

  if (data.errcode !== 0) {
    throw new Error(`[DingTalk][Attendance] list error: ${data.errcode} ${data.errmsg}`);
  }

  return {
    records: data.recordresult ?? [],
    hasMore: data.hasMore ?? false,
  };
}
