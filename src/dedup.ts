/**
 * Message deduplication with TTL.
 * Prevents processing the same DingTalk message twice.
 */

const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEDUP_MAX_ENTRIES = 100;

// Map of msgId → timestamp
const seen = new Map<string, number>();

/**
 * Check if a message ID has been seen recently.
 * Returns true if duplicate (already seen within TTL).
 */
export function isDuplicate(msgId: string): boolean {
  if (!msgId) return false;

  const now = Date.now();
  const seenAt = seen.get(msgId);

  if (seenAt !== undefined && now - seenAt < DEDUP_TTL_MS) {
    return true;
  }

  // Cleanup if too many entries
  if (seen.size >= DEDUP_MAX_ENTRIES) {
    purgeExpired(now);
  }

  // Still too many after purge? Remove oldest
  if (seen.size >= DEDUP_MAX_ENTRIES) {
    removeOldest();
  }

  seen.set(msgId, now);
  return false;
}

/**
 * Clear all dedup entries. Useful for testing.
 */
export function clearDedup(): void {
  seen.clear();
}

/**
 * Get the number of tracked message IDs.
 */
export function getDedupSize(): number {
  return seen.size;
}

// ============ Private Functions ============

function purgeExpired(now: number): void {
  for (const [id, ts] of seen) {
    if (now - ts >= DEDUP_TTL_MS) {
      seen.delete(id);
    }
  }
}

function removeOldest(): void {
  let oldestKey: string | undefined;
  let oldestTs = Infinity;

  for (const [id, ts] of seen) {
    if (ts < oldestTs) {
      oldestTs = ts;
      oldestKey = id;
    }
  }

  if (oldestKey) {
    seen.delete(oldestKey);
  }
}
