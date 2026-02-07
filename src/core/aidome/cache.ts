/**
 * TTL (Time-To-Live) cache for AIdome API responses.
 */

/**
 * Cache entry with expiration.
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Simple in-memory TTL cache.
 */
export class Cache<T> {
  private store = new Map<string, CacheEntry<T>>();

  constructor(private defaultTtlMs: number = 60000) {}

  /**
   * Sets a cache entry.
   * @param key Cache key
   * @param value Value to cache
   * @param ttlMs Optional TTL in milliseconds
   */
  set(key: string, value: T, ttlMs?: number): void {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.store.set(key, { value, expiresAt });
  }

  /**
   * Gets a cache entry if not expired.
   * @param key Cache key
   * @returns Cached value or undefined
   */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Checks if a key exists and is not expired.
   * @param key Cache key
   * @returns True if key exists and is valid
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Deletes a cache entry.
   * @param key Cache key
   */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Clears all cache entries.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Removes expired entries.
   */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}
