/**
 * Fetch retry utility with exponential backoff.
 * Retries on 429 (rate limit) and 5xx (server error) responses.
 */

export type RetryConfig = {
  maxRetries?: number;
  baseDelayMs?: number;
  retryOnStatuses?: number[];
};

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 100,
  retryOnStatuses: [429, 500, 502, 503, 504],
};

/**
 * Fetch with automatic retry on transient failures.
 * Uses exponential backoff between retries.
 */
export async function fetchWithRetry(
  url: string | URL,
  options?: RequestInit,
  config?: RetryConfig,
): Promise<Response> {
  const { maxRetries, baseDelayMs, retryOnStatuses } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (attempt < maxRetries && shouldRetry(response.status, retryOnStatuses)) {
        await delay(baseDelayMs * Math.pow(2, attempt));
        continue;
      }

      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await delay(baseDelayMs * Math.pow(2, attempt));
        continue;
      }
    }
  }

  throw lastError ?? new Error("fetchWithRetry: all retries exhausted");
}

// ============ Private Functions ============

function shouldRetry(status: number, retryStatuses: number[]): boolean {
  return retryStatuses.includes(status);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
