import type { Database } from 'bun:sqlite';
import { HEADLESS } from '../const.js';

interface RateLimitConfig {
  windowMs: number;     // Time window in milliseconds
  maxAttempts: number;  // Maximum attempts allowed per window
  bucket: string;       // Rate limit bucket name (e.g., 'auth', 'onboarding')
}

interface RateLimitResult {
  allowed: boolean;     // Whether the request is allowed
  count: number;        // Current attempt count
  resetAt: number;      // When the window resets (Unix timestamp ms)
  remaining: number;    // Remaining attempts in window
}

type MemoryEntry = { count: number; windowStart: number };

const SQLITE_BUSY_ERRNOS = new Set([5, 6]);
const SQLITE_BUSY_CODES = new Set(['SQLITE_BUSY', 'SQLITE_LOCKED']);
const MAX_BUSY_RETRIES = 3;
const BASE_BUSY_DELAY_MS = 25;

export class RateLimiterUnavailableError extends Error {
  readonly status = 503;
  readonly code = 'RATE_LIMITER_UNAVAILABLE';

  constructor(message = 'Rate limiter temporarily unavailable') {
    super(message);
    this.name = 'RateLimiterUnavailableError';
    Object.setPrototypeOf(this, RateLimiterUnavailableError.prototype);
  }
}

function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as { code?: string; errno?: number; name?: string; message?: string };
  const code = candidate.code || candidate.name;
  if (typeof code === 'string' && SQLITE_BUSY_CODES.has(code.toUpperCase())) {
    return true;
  }

  if (typeof candidate.errno === 'number' && SQLITE_BUSY_ERRNOS.has(candidate.errno)) {
    return true;
  }

  if (typeof candidate.message === 'string') {
    const upper = candidate.message.toUpperCase();
    if (upper.includes('SQLITE_BUSY') || upper.includes('SQLITE_LOCKED')) {
      return true;
    }
  }

  return false;
}

function backoffDelay(attempt: number): number {
  return BASE_BUSY_DELAY_MS * Math.pow(2, attempt);
}

async function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

/**
 * SQLite-backed rate limiter that persists across server restarts.
 * Falls back to in-memory storage if database is unavailable.
 */
export class PersistentRateLimiter {
  private db: Database | null = null;
  private fallbackStore = new Map<string, MemoryEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(db?: Database, fallbackState?: Map<string, MemoryEntry>) {
    // Only initialize if not in headless mode and DB provided
    if (!HEADLESS && db) {
      this.db = db;
      this.startCleanup();
    }

    if (fallbackState && fallbackState.size > 0) {
      // Preserve any in-memory state so new instances retain prior counts if needed
      this.fallbackStore = new Map(fallbackState);
    }
  }

  /**
   * Check and update rate limit for an identifier
   * @param identifier - Unique identifier (IP, user ID, fingerprint, etc.)
   * @param config - Rate limit configuration
   * @returns Rate limit result with allowed status and metadata
   */
  async checkLimit(identifier: string, config: RateLimitConfig): Promise<RateLimitResult> {
    if (!this.db) {
      const now = Date.now();
      return this.checkMemoryLimit(identifier, config, now);
    }

    for (let attempt = 0; attempt <= MAX_BUSY_RETRIES; attempt++) {
      const now = Date.now();
      const windowStart = now - config.windowMs;

      try {
        // Start transaction for atomic read-update
        this.db.exec('BEGIN IMMEDIATE');

        try {
          // Check existing rate limit entry
          const existing = this.db.prepare(`
            SELECT count, window_start, last_attempt
            FROM rate_limits
            WHERE identifier = ? AND bucket = ?
          `).get(identifier, config.bucket) as {
            count: number;
            window_start: number;
            last_attempt: number;
          } | undefined;

          let count = 1;
          let currentWindowStart = now;

          if (existing) {
            // Check if we're still in the same window
            if (existing.window_start > windowStart) {
              // Same window, increment count
              count = existing.count + 1;
              currentWindowStart = existing.window_start;

              // Update existing entry
              this.db.prepare(`
                UPDATE rate_limits
                SET count = ?, last_attempt = ?, updated_at = CURRENT_TIMESTAMP
                WHERE identifier = ? AND bucket = ?
              `).run(count, now, identifier, config.bucket);
            } else {
              // Window expired, reset to new window
              this.db.prepare(`
                UPDATE rate_limits
                SET count = 1, window_start = ?, last_attempt = ?, updated_at = CURRENT_TIMESTAMP
                WHERE identifier = ? AND bucket = ?
              `).run(now, now, identifier, config.bucket);
            }
          } else {
            // First attempt, create new entry
            this.db.prepare(`
              INSERT INTO rate_limits (identifier, bucket, count, window_start, last_attempt)
              VALUES (?, ?, 1, ?, ?)
            `).run(identifier, config.bucket, now, now);
          }

          this.db.exec('COMMIT');

          const allowed = count <= config.maxAttempts;
          const resetAt = currentWindowStart + config.windowMs;
          const remaining = Math.max(0, config.maxAttempts - count);

          return { allowed, count, resetAt, remaining };
        } catch (transactionError) {
          try {
            this.db.exec('ROLLBACK');
          } catch (rollbackError) {
            console.error('[RateLimiter] Failed to rollback transaction:', rollbackError);
          }
          throw transactionError;
        }
      } catch (error) {
        if (isSqliteBusyError(error)) {
          if (attempt === MAX_BUSY_RETRIES) {
            console.warn('[RateLimiter] Database busy after retries; returning service unavailable.');
            throw new RateLimiterUnavailableError();
          }

          const delayMs = backoffDelay(attempt);
          await sleep(delayMs);
          continue;
        }

        console.error('[RateLimiter] Database error, falling back to memory:', error);
        return this.checkMemoryLimit(identifier, config, now);
      }
    }

    throw new RateLimiterUnavailableError();
  }

  /**
   * In-memory fallback for rate limiting
   */
  private checkMemoryLimit(
    identifier: string,
    config: RateLimitConfig,
    now: number
  ): RateLimitResult {
    const key = `${config.bucket}:${identifier}`;
    const windowStart = now - config.windowMs;
    const entry = this.fallbackStore.get(key);

    let count = 1;
    let currentWindowStart = now;

    if (entry) {
      if (entry.windowStart > windowStart) {
        // Same window
        count = entry.count + 1;
        currentWindowStart = entry.windowStart;
        entry.count = count;
      } else {
        // Window expired, reset
        this.fallbackStore.set(key, { count: 1, windowStart: now });
      }
    } else {
      // New entry
      this.fallbackStore.set(key, { count: 1, windowStart: now });
    }

    const allowed = count <= config.maxAttempts;
    const resetAt = currentWindowStart + config.windowMs;
    const remaining = Math.max(0, config.maxAttempts - count);

    return { allowed, count, resetAt, remaining };
  }

  /**
   * Clear rate limit for an identifier
   * @param identifier - Unique identifier to clear
   * @param bucket - Optional bucket to clear (if not provided, clears all buckets)
   */
  async clearLimit(identifier: string, bucket?: string): Promise<void> {
    if (this.db) {
      try {
        if (bucket) {
          this.db.prepare('DELETE FROM rate_limits WHERE identifier = ? AND bucket = ?')
            .run(identifier, bucket);
        } else {
          this.db.prepare('DELETE FROM rate_limits WHERE identifier = ?')
            .run(identifier);
        }
      } catch (error) {
        console.error('[RateLimiter] Failed to clear limit:', error);
      }
    }

    // Clear from memory fallback
    if (bucket) {
      this.fallbackStore.delete(`${bucket}:${identifier}`);
    } else {
      // Clear all buckets for this identifier
      for (const key of this.fallbackStore.keys()) {
        if (key.endsWith(`:${identifier}`)) {
          this.fallbackStore.delete(key);
        }
      }
    }
  }

  /**
   * Clean up expired rate limit entries
   * @param maxAge - Maximum age in milliseconds (default: 24 hours)
   */
  private cleanupExpired(maxAge = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAge;

    if (this.db) {
      try {
        this.db
          .prepare('DELETE FROM rate_limits WHERE last_attempt < ?')
          .run(cutoff);

        // Only log if entries were deleted
        const changes = this.db.query('SELECT changes() as c').get() as { c: number } | null;
        if (changes && changes.c > 0) {
          console.log(`[RateLimiter] Cleaned up ${changes.c} expired entries`);
        }
      } catch (error) {
        console.error('[RateLimiter] Cleanup failed:', error);
      }
    }

    // Clean up memory fallback
    for (const [key, entry] of this.fallbackStore.entries()) {
      if (entry.windowStart < cutoff) {
        this.fallbackStore.delete(key);
      }
    }
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanup(): void {
    if (this.cleanupTimer) return;

    // Run cleanup every hour
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, 60 * 60 * 1000);

    // Also run cleanup immediately to clear any old entries
    this.cleanupExpired();
  }

  /**
   * Stop periodic cleanup (call on shutdown)
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Indicates whether this limiter is currently using a database backend.
   */
  isDatabaseBacked(): boolean {
    return this.db !== null;
  }

  /**
   * Snapshot current in-memory fallback state for migration to a new instance.
   */
  snapshotFallbackState(): Map<string, MemoryEntry> {
    return new Map(this.fallbackStore);
  }
}

// Global instance for shared use
let globalRateLimiter: PersistentRateLimiter | null = null;

/**
 * Initialize the global rate limiter with a database connection
 * @param db - Database connection to use
 */
export function initializeRateLimiter(db?: Database): void {
  const hasDatabaseConnection = !!db && !HEADLESS;

  if (!globalRateLimiter) {
    globalRateLimiter = new PersistentRateLimiter(db);
    return;
  }

  if (!hasDatabaseConnection) {
    // Nothing to upgrade to without a usable database
    return;
  }

  if (globalRateLimiter.isDatabaseBacked()) {
    // Already using a persistent backend
    return;
  }

  const previousLimiter = globalRateLimiter;
  const fallbackSnapshot = previousLimiter.snapshotFallbackState();
  const upgradedLimiter = new PersistentRateLimiter(db, fallbackSnapshot);

  globalRateLimiter = upgradedLimiter;

  // Stop cleanup loop on the retired limiter once the swap is complete
  previousLimiter.stopCleanup();
}

/**
 * Get the global rate limiter instance
 * @returns The global rate limiter (creates one if not initialized)
 */
export function getRateLimiter(): PersistentRateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new PersistentRateLimiter();
  }
  return globalRateLimiter;
}

/**
 * Clean up rate limiter on shutdown
 */
export function cleanupRateLimiter(): void {
  if (globalRateLimiter) {
    globalRateLimiter.stopCleanup();
    globalRateLimiter = null;
  }
}
