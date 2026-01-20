import { RateLimiterProvider, RateLimitConfig, RateLimitError } from "warera-sdk";

// Default rate limit configuration (matching SDK defaults)
const defaultRateLimitConfig: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 60000,
  backoffThreshold: 0.7,
  maxBackoffMs: 5000,
  throwOnLimit: false,
};

/**
 * Shared rate limiter that can be used across multiple API clients.
 * Ensures all clients share the same rate limit tracking, preventing conflicts
 * when multiple clients make requests concurrently.
 * 
 * This is thread-safe and uses the same sliding window algorithm as the SDK's
 * built-in RateLimiter, but allows multiple clients to share the same instance.
 */
export class SharedRateLimiter implements RateLimiterProvider {
  private config: RateLimitConfig;
  private requestTimestamps: number[] = [];
  private lock: Promise<void> = Promise.resolve();

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...defaultRateLimitConfig, ...config };
  }

  /**
   * Acquire a lock for thread-safe operations
   */
  private async acquireLock(): Promise<() => void> {
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const previousLock = this.lock;
    this.lock = previousLock.then(() => lockPromise);

    await previousLock;
    return releaseLock!;
  }

  /**
   * Clean up old timestamps outside the current window
   */
  private pruneOldTimestamps(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => ts > windowStart
    );
  }

  /**
   * Get current request count in the window
   */
  getRequestCount(): number {
    this.pruneOldTimestamps();
    return this.requestTimestamps.length;
  }

  /**
   * Get current usage as a percentage (0-1)
   */
  getUsageRatio(): number {
    if (this.config.maxRequests === 0) {
      return this.getRequestCount() > 0 ? Infinity : 0;
    }
    return this.getRequestCount() / this.config.maxRequests;
  }

  /**
   * Calculate backoff delay based on current usage.
   * Returns 0 if below threshold, scales up exponentially as approaching limit.
   */
  private calculateBackoffDelay(): number {
    const usage = this.getUsageRatio();

    // No delay if below backoff threshold
    if (usage < this.config.backoffThreshold) {
      return 0;
    }

    // Calculate how far we are into the backoff zone (0 to 1)
    const backoffZoneProgress =
      (usage - this.config.backoffThreshold) /
      (1 - this.config.backoffThreshold);

    // Exponential backoff: delay increases more steeply as we approach the limit
    // Using quadratic curve for smoother ramp-up
    const delayFactor = Math.pow(backoffZoneProgress, 2);

    return Math.round(delayFactor * this.config.maxBackoffMs);
  }

  /**
   * Wait for the calculated backoff delay
   */
  private async applyBackoff(): Promise<void> {
    const delay = this.calculateBackoffDelay();
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /**
   * Check if we're at or over the rate limit
   */
  isAtLimit(): boolean {
    return this.getRequestCount() >= this.config.maxRequests;
  }

  /**
   * Calculate time until a slot becomes available
   */
  getTimeUntilSlotAvailable(): number {
    if (!this.isAtLimit()) {
      return 0;
    }

    this.pruneOldTimestamps();
    if (this.requestTimestamps.length === 0) {
      return 0;
    }

    // Find when the oldest request will expire from the window
    const oldestTimestamp = Math.min(...this.requestTimestamps);
    const expiresAt = oldestTimestamp + this.config.windowMs;
    return Math.max(0, expiresAt - Date.now());
  }

  /**
   * Acquire permission to make a request.
   * Will apply backoff delay if approaching limit.
   * If at limit, will either throw or wait based on config.
   * This method is thread-safe and can be called concurrently from multiple clients.
   */
  async acquire(): Promise<void> {
    const releaseLock = await this.acquireLock();
    
    try {
      this.pruneOldTimestamps();

      // Apply gradual backoff as we approach the limit
      await this.applyBackoff();

      // Check if we're at the limit
      if (this.isAtLimit()) {
        const retryAfter = this.getTimeUntilSlotAvailable();

        if (this.config.throwOnLimit) {
          throw new RateLimitError(
            `Rate limit exceeded. Max ${this.config.maxRequests} requests per ${this.config.windowMs}ms.`,
            retryAfter
          );
        }

        // Wait for a slot to become available
        if (retryAfter > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryAfter + 10));
          this.pruneOldTimestamps();
        }
      }

      // Record this request
      this.requestTimestamps.push(Date.now());
    } finally {
      releaseLock();
    }
  }

  /**
   * Get current rate limit status for debugging/monitoring
   */
  getStatus(): {
    requestCount: number;
    maxRequests: number;
    usagePercent: number;
    isAtLimit: boolean;
    currentBackoffMs: number;
  } {
    this.pruneOldTimestamps();
    return {
      requestCount: this.requestTimestamps.length,
      maxRequests: this.config.maxRequests,
      usagePercent: Math.round(this.getUsageRatio() * 100),
      isAtLimit: this.isAtLimit(),
      currentBackoffMs: this.calculateBackoffDelay(),
    };
  }

  /**
   * Reset the rate limiter (clear all tracked requests)
   */
  reset(): void {
    this.requestTimestamps = [];
  }
}
