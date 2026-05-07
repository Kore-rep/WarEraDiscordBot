import { CacheProvider } from "./WarEraApiClient";
import { logger } from "../../utils/logger";

interface CacheEntry {
  value: unknown;
  expiresAt?: number;
}

/**
 * Simple in-memory cache provider implementing the SDK's CacheProvider interface
 * Supports TTL (Time To Live) for cache entries
 */
export class InMemoryCacheProvider implements CacheProvider {
  private cache: Map<string, CacheEntry> = new Map();

  /**
   * Get a value from the cache by key
   * Logs a message when a value is successfully retrieved from cache
   * 
   * @param key - The cache key
   * @returns The cached value or undefined if not found or expired
   */
  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if entry has expired
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      // Entry expired, remove it
      const expiredAge = Date.now() - entry.expiresAt;
      logger.debug(`Cache entry expired for key: ${key} (expired ${Math.round(expiredAge / 1000)}s ago)`);
      this.cache.delete(key);
      return undefined;
    }

    // Log cache hit with remaining TTL if available
    if (entry.expiresAt) {
      const remainingMs = entry.expiresAt - Date.now();
      const remainingSeconds = Math.round(remainingMs / 1000);
      logger.debug(`Cache hit for key: ${key} (expires in ${remainingSeconds}s)`);
    } else {
      logger.debug(`Cache hit for key: ${key} (no expiration)`);
    }
    
    return entry.value as T;
  }

  /**
   * Set a value in the cache with optional TTL
   * 
   * @param key - The cache key
   * @param value - The value to cache
   * @param ttl - Optional time to live in milliseconds (SDK passes milliseconds)
   */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    // SDK passes TTL in milliseconds, so use it directly
    const expiresAt = ttl ? Date.now() + ttl : undefined;
    
    this.cache.set(key, {
      value,
      expiresAt,
    });

    // Log cache addition with TTL information
    if (ttl) {
      const ttlSeconds = Math.round(ttl / 1000);
      const ttlMinutes = Math.round(ttlSeconds / 60);
      if (ttlSeconds < 60) {
        logger.debug(`Cache set for key: ${key} (TTL: ${ttlSeconds}s)`);
      } else {
        logger.debug(`Cache set for key: ${key} (TTL: ${ttlMinutes}m ${ttlSeconds % 60}s)`);
      }
    } else {
      logger.debug(`Cache set for key: ${key} (no expiration)`);
    }
  }

  /**
   * Delete a value from the cache
   * 
   * @param key - The cache key to delete
   */
  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  async reset(): Promise<void> {
    this.cache.clear();
  }

  /**
   * Get the current size of the cache
   */
  size(): number {
    return this.cache.size;
  }
}
