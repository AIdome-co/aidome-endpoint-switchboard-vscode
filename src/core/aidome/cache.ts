/**
 * TTL (Time-To-Live) cache for AIdome API responses.
 */

/**
 * Cache entry with expiration.
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  timeoutId?: NodeJS.Timeout;
}

/**
 * Simple in-memory TTL cache.
 */
export class Cache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 60000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Sets a cache entry with optional TTL.
   * @param key Cache key
   * @param value Value to cache
   * @param ttlMs Optional TTL in milliseconds
   */
  set(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = Date.now() + ttl;
    
    // Clear existing timeout if key already exists
    const existing = this.store.get(key);
    if (existing?.timeoutId) {
      clearTimeout(existing.timeoutId);
    }
    
    // Set auto-expiry timeout
    const timeoutId = setTimeout(() => {
      this.store.delete(key);
    }, ttl);
    
    this.store.set(key, { value, expiresAt, timeoutId });
  }

  /**
   * Gets a cache entry if not expired.
   * @param key Cache key
   * @returns Cached value or undefined
   */
  get<U = T>(key: string): U | undefined {
    const entry = this.store.get(key) as CacheEntry<U> | undefined;
    
    if (!entry) {
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.invalidate(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Invalidates (removes) a cache entry.
   * @param key Cache key
   */
  invalidate(key: string): void {
    const entry = this.store.get(key);
    if (entry?.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    this.store.delete(key);
  }

  /**
   * Clears all cache entries.
   */
  clear(): void {
    // Clear all timeouts
    for (const entry of this.store.values()) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
    }
    this.store.clear();
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
   * Removes expired entries.
   */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.invalidate(key);
      }
    }
  }
}
