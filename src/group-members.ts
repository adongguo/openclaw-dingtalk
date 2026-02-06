/**
 * Passive group member tracking.
 * Builds a roster of group members from incoming messages.
 * No active API calls - purely observational from message flow.
 */

// groupId → (userId → nickname)
const groupRosters = new Map<string, Map<string, string>>();

/**
 * Track a group member from an incoming message.
 * Updates the nickname if the user is already known.
 */
export function trackGroupMember(
  groupId: string,
  userId: string,
  nickname: string,
): void {
  if (!groupId || !userId) return;

  let roster = groupRosters.get(groupId);
  if (!roster) {
    roster = new Map<string, string>();
    groupRosters.set(groupId, roster);
  }

  roster.set(userId, nickname || userId);
}

/**
 * Get a formatted string of known group members.
 * Returns "Name1 (id1), Name2 (id2), ..." format for AI context.
 */
export function getGroupMembers(groupId: string): string {
  const roster = groupRosters.get(groupId);
  if (!roster || roster.size === 0) return "";

  const entries: string[] = [];
  for (const [userId, nickname] of roster) {
    entries.push(nickname !== userId ? `${nickname} (${userId})` : userId);
  }

  return entries.join(", ");
}

/**
 * Get the count of known members in a group.
 */
export function getGroupMemberCount(groupId: string): number {
  return groupRosters.get(groupId)?.size ?? 0;
}

/**
 * Get all tracked group IDs.
 */
export function getTrackedGroupIds(): string[] {
  return [...groupRosters.keys()];
}

/**
 * Clear all group member data. Useful for testing.
 */
export function clearGroupMembers(): void {
  groupRosters.clear();
}
