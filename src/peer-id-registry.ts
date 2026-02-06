/**
 * Peer ID case registry.
 * DingTalk peer IDs may have mixed case; this preserves original casing
 * for outbound messages while allowing case-insensitive lookups.
 */

// Map of lowercased ID → original case ID
const registry = new Map<string, string>();

/**
 * Register a peer ID, preserving its original case.
 */
export function registerPeerId(id: string | undefined | null): void {
  if (!id) return;
  registry.set(id.toLowerCase(), id);
}

/**
 * Resolve the original case of a peer ID.
 * Returns the original case if registered, otherwise returns input as-is.
 */
export function resolveOriginalCase(id: string): string {
  if (!id) return id;
  return registry.get(id.toLowerCase()) ?? id;
}

/**
 * Clear all registered peer IDs. Useful for testing.
 */
export function clearPeerIdRegistry(): void {
  registry.clear();
}

/**
 * Get the number of registered peer IDs.
 */
export function getPeerIdRegistrySize(): number {
  return registry.size;
}
