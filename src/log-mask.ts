/**
 * Sensitive data masking utility for log output.
 * Masks tokens, secrets, and passwords to prevent leaking in logs.
 */

const SENSITIVE_KEYS = new Set([
  "token",
  "accesstoken",
  "access_token",
  "appsecret",
  "appkey",
  "password",
  "secret",
  "gatewaytoken",
  "gatewaypassword",
]);

/**
 * Mask a sensitive string value.
 * Shows first 3 + *** + last 3 chars. For short values (< 8 chars), shows first 2 + ***.
 */
export function maskSensitive(value: string): string {
  if (!value) return value;
  if (value.length < 8) {
    return `${value.slice(0, 2)}***`;
  }
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

/**
 * Create a new object with sensitive fields masked.
 * Does not mutate the input object.
 */
export function maskLogObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && isSensitiveKey(key)) {
      result[key] = maskSensitive(value);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = maskLogObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ============ Private Functions ============

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}
