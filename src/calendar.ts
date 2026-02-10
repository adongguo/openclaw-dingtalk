/**
 * Calendar APIs for DingTalk.
 *
 * Uses new API (api.dingtalk.com):
 * - POST /v1.0/calendar/users/{userId}/calendars/primary/events
 * - GET  /v1.0/calendar/users/{userId}/calendars/primary/events
 * - POST /v1.0/calendar/users/{userId}/getSchedule
 */

import type { DingTalkConfig } from "./types.js";
import { getAccessToken } from "./ai-card.js";

// ============ Constants ============

const DINGTALK_API = "https://api.dingtalk.com";

// ============ Types ============

export interface CalendarDateTime {
  dateTime?: string; // ISO 8601
  date?: string; // "yyyy-MM-dd" for all-day
  timeZone?: string;
}

export interface CalendarAttendee {
  id?: string;
  isOptional?: boolean;
}

export interface CreateCalendarEventParams {
  userId: string; // union id of the operator
  summary: string;
  start: CalendarDateTime;
  end: CalendarDateTime;
  description?: string;
  isAllDay?: boolean;
  attendees?: CalendarAttendee[];
  location?: { displayName?: string };
  reminders?: Array<{ method?: string; minutes?: number }>;
  recurrence?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface ListCalendarEventsParams {
  userId: string;
  timeMin?: string; // ISO 8601
  timeMax?: string;
  maxResults?: number;
  nextToken?: string;
}

export interface GetScheduleParams {
  userId: string;
  userIds: string[];
  startTime: string; // ISO 8601
  endTime: string;
}

export interface CalendarEvent {
  id?: string;
  summary?: string;
  start?: CalendarDateTime;
  end?: CalendarDateTime;
  description?: string;
  status?: string;
  attendees?: CalendarAttendee[];
  [key: string]: unknown;
}

export interface ScheduleItem {
  userId?: string;
  scheduleItems?: Array<{
    status?: string;
    start?: CalendarDateTime;
    end?: CalendarDateTime;
  }>;
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
    throw new Error(`[DingTalk][Calendar] ${method} ${path} failed: ${response.status} ${text}`);
  }

  // Some endpoints return 204 No Content
  const contentType = response.headers.get("content-type") ?? "";
  if (response.status === 204 || !contentType.includes("json")) {
    return {};
  }
  return response.json();
}

// ============ API Functions ============

/**
 * Create a calendar event.
 */
export async function createCalendarEvent(
  config: DingTalkConfig,
  params: CreateCalendarEventParams,
  accountId?: string,
): Promise<CalendarEvent> {
  const { userId, extra, ...eventBody } = params;
  const body: Record<string, unknown> = { ...eventBody, ...extra };

  const result = await dingtalkNewAPI(
    config,
    "POST",
    `/v1.0/calendar/users/${userId}/calendars/primary/events`,
    body,
    undefined,
    accountId,
  );
  return result as CalendarEvent;
}

/**
 * List calendar events.
 */
export async function listCalendarEvents(
  config: DingTalkConfig,
  params: ListCalendarEventsParams,
  accountId?: string,
): Promise<{ events: CalendarEvent[]; nextToken?: string }> {
  const { userId, ...queryParams } = params;
  const query: Record<string, string> = {};
  if (queryParams.timeMin) query.timeMin = queryParams.timeMin;
  if (queryParams.timeMax) query.timeMax = queryParams.timeMax;
  if (queryParams.maxResults) query.maxResults = String(queryParams.maxResults);
  if (queryParams.nextToken) query.nextToken = queryParams.nextToken;

  const result = (await dingtalkNewAPI(
    config,
    "GET",
    `/v1.0/calendar/users/${userId}/calendars/primary/events`,
    undefined,
    query,
    accountId,
  )) as { events?: CalendarEvent[]; nextToken?: string };

  return { events: result.events ?? [], nextToken: result.nextToken };
}

/**
 * Get user schedule (free/busy).
 */
export async function getSchedule(
  config: DingTalkConfig,
  params: GetScheduleParams,
  accountId?: string,
): Promise<ScheduleItem[]> {
  const { userId, ...body } = params;

  const result = (await dingtalkNewAPI(
    config,
    "POST",
    `/v1.0/calendar/users/${userId}/getSchedule`,
    body,
    undefined,
    accountId,
  )) as { scheduleInformation?: ScheduleItem[] };

  return result.scheduleInformation ?? [];
}
