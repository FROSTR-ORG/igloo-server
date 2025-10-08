import { randomBytes, timingSafeEqual, pbkdf2Sync } from 'crypto';
import { existsSync, mkdirSync, readFileSync, statSync, openSync, writeSync, fsyncSync, renameSync, unlinkSync, closeSync, chmodSync } from 'fs';
import path from 'path';
import { HEADLESS } from '../const.js';
import { authenticateUser, isDatabaseInitialized, verifyApiKeyToken, markApiKeyUsed, hasActiveApiKeys } from '../db/database.js';
import { PBKDF2_CONFIG } from '../config/crypto.js';
import { getSecureCorsHeaders, mergeVaryHeaders, parseJsonRequestBody } from './utils.js';
import { getRateLimiter } from '../utils/rate-limiter.js';
import { zeroizeUint8, zeroizeAndDelete as zeroizeUint8MapEntry } from '../util/zeroize.js';

// Session secret persistence configuration
// Properly handle DB_PATH whether it's a file or directory
function getSessionSecretDir(): string {
  const dbPath = process.env.DB_PATH;
  if (!dbPath) {
    return path.join(process.cwd(), 'data');
  }

  try {
    const stats = statSync(dbPath);
    return stats.isFile() ? path.dirname(dbPath) : dbPath;
  } catch {
    // If path doesn't exist, infer more robustly
    const normalized = path.normalize(dbPath);
    const endsWithSep = normalized.endsWith(path.sep);
    if (endsWithSep) return normalized;

    const base = path.basename(normalized);
    // Check for common database file extensions
    const dbExtensions = ['.db', '.sqlite', '.sqlite3'];
    if (dbExtensions.some(ext => base.toLowerCase().endsWith(ext))) {
      return path.dirname(normalized);
    }
    // Default to directory in ambiguous cases
    return normalized;
  }
}

const SESSION_SECRET_DIR = getSessionSecretDir();
const SESSION_SECRET_FILE = path.join(SESSION_SECRET_DIR, '.session-secret');

// Load or generate a persistent SESSION_SECRET
function loadOrGenerateSessionSecret(): string | null {
  try {
    // Ensure data directory exists with strict permissions
    if (!existsSync(SESSION_SECRET_DIR)) {
      mkdirSync(SESSION_SECRET_DIR, { recursive: true, mode: 0o700 });
    }
    // Enforce strict permissions on the directory (0700)
    try {
      chmodSync(SESSION_SECRET_DIR, 0o700);
    } catch (e) {
      if (process.platform !== 'win32') {
        throw e;
      }
      // On Windows, chmod may be a no-op or limited; proceed best-effort
      console.warn('⚠️  Windows platform: Unable to enforce 0700 on session secret directory.');
    }
    
    // Check if secret already exists
    if (existsSync(SESSION_SECRET_FILE)) {
      const secret = readFileSync(SESSION_SECRET_FILE, 'utf-8').trim();
      // Validate format: must be exactly 64 hex characters (32 bytes)
      if (/^[0-9a-f]{64}$/i.test(secret)) {
        console.log('🔑 SESSION_SECRET loaded from secure storage');
        return secret;
      }
      console.warn('⚠️  Existing SESSION_SECRET is invalid format, generating new one');
    }
    
    // Generate new secret (32 bytes = 64 hex characters)
    const newSecret = randomBytes(32).toString('hex');
    
    // Atomically write the new secret with unique temp file
    const tempFileName = `.session-secret.tmp.${process.pid}.${randomBytes(8).toString('hex')}`;
    const tempFilePath = path.join(SESSION_SECRET_DIR, tempFileName);
    let tempFileHandle: number | undefined;
    let dirHandle: number | undefined;

    try {
      // Open temp file with exclusive flag to prevent races
      tempFileHandle = openSync(tempFilePath, 'wx', 0o600);
      // Write the secret to the temp file
      writeSync(tempFileHandle, newSecret, 0, 'utf8');

      // Open directory handle for fsync
      try {
        dirHandle = openSync(SESSION_SECRET_DIR, 'r');
      } catch (e) {
        if (process.platform !== 'win32') {
          throw e;
        }
        // Windows doesn't support opening directories for fsync
        console.warn('⚠️  Windows platform detected: Directory fsync not available. Session secret may be lost in case of system crash before filesystem cache flush.');
        dirHandle = undefined;
      }

      // First, ensure the temp file is on disk
      fsyncSync(tempFileHandle);

      // Atomically rename the temp file to the final destination
      renameSync(tempFilePath, SESSION_SECRET_FILE);

      // Enforce strict permissions on the final secret file (0600)
      try {
        chmodSync(SESSION_SECRET_FILE, 0o600);
      } catch (e) {
        if (process.platform !== 'win32') {
          throw e;
        }
        console.warn('⚠️  Windows platform: Unable to enforce 0600 on session secret file.');
      }

      // Finally, fsync the directory to durably record the rename (best-effort on Windows)
      if (dirHandle !== undefined) {
        try {
          fsyncSync(dirHandle);
        } catch (e) {
          if (process.platform !== 'win32') {
            throw e;
          }
          // Windows fsync on directory handle may fail even after successful open
          console.warn('⚠️  Windows platform: Directory fsync failed. Session secret rename may not be durable until filesystem cache flush.');
        }
      }

    } catch (error) {
      console.error('Failed to write session secret atomically:', error);
      // Clean up the temporary file if it exists
      if (existsSync(tempFilePath)) {
        try {
          unlinkSync(tempFilePath);
        } catch (cleanupError) {
          console.error('Failed to clean up temporary session secret file:', cleanupError);
        }
      }
      throw error; // Re-throw the original error
    } finally {
      if (tempFileHandle !== undefined) closeSync(tempFileHandle);
      if (dirHandle !== undefined) closeSync(dirHandle);
    }
    
    // Final assurance of correct permissions after write/rename
    try {
      chmodSync(SESSION_SECRET_DIR, 0o700);
    } catch (e) {
      if (process.platform !== 'win32') {
        throw e;
      }
      console.warn('⚠️  Windows platform: Unable to enforce 0700 on session secret directory.');
    }
    try {
      chmodSync(SESSION_SECRET_FILE, 0o600);
    } catch (e) {
      if (process.platform !== 'win32') {
        throw e;
      }
      console.warn('⚠️  Windows platform: Unable to enforce 0600 on session secret file.');
    }

    console.log('✨ SESSION_SECRET auto-generated and saved to secure storage');
    console.log('   Sessions will now persist across server restarts');
    
    return newSecret;
  } catch (error) {
    console.error('Failed to load/generate SESSION_SECRET:', error);
    return null;
  }
}

// Validate SESSION_SECRET configuration
function validateSessionSecret(): string | null {
  let sessionSecret = process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // If no SESSION_SECRET provided, attempt to auto-generate or load
  if (!sessionSecret) {
    const generatedSecret = loadOrGenerateSessionSecret();
    
    if (!generatedSecret) {
      // Generation failed
      const message = 'Failed to auto-generate SESSION_SECRET';
      if (isProduction) {
        console.error(`❌ SECURITY ERROR: ${message}. Sessions cannot be enabled.`);
        process.exit(1);
      } else {
        console.warn(`⚠️  WARNING: ${message}. Sessions will be disabled. Check file permissions on data directory.`);
        return null;
      }
    }
    // Use the generated secret
    sessionSecret = generatedSecret;
    process.env.SESSION_SECRET = generatedSecret;
  } else {
    // Validate provided SESSION_SECRET from environment
    // Must be exactly 64 hex characters (32 bytes)
    if (!/^[0-9a-f]{64}$/i.test(sessionSecret)) {
      const message = 'SESSION_SECRET must be a 64-character hex string (32 bytes)';
      console.error(`❌ SECURITY ERROR: ${message}`);
      
      // In production, exit immediately for security
      if (isProduction) {
        process.exit(1);
      }
      
      // In development, attempt to auto-generate a valid secret
      console.warn('⚠️  Attempting to auto-generate a valid SESSION_SECRET...');
      const generatedSecret = loadOrGenerateSessionSecret();
      
      if (!generatedSecret) {
        console.error('❌ Failed to auto-generate SESSION_SECRET. Sessions will be disabled.');
        return null;
      }
      
      sessionSecret = generatedSecret;
      process.env.SESSION_SECRET = generatedSecret;
    } else {
      console.log('🔐 SESSION_SECRET configured via environment variable');
    }
  }
  
  return sessionSecret;
}

const DEFAULT_RATE_LIMIT_MAX = HEADLESS ? 300 : 600;

// Authentication configuration from environment variables
export const AUTH_CONFIG = {
  // Enable/disable authentication (default: true for security)
  ENABLED: process.env.AUTH_ENABLED !== 'false',
  
  // Authentication methods
  API_KEY: HEADLESS ? process.env.API_KEY : undefined,
  BASIC_AUTH_USER: process.env.BASIC_AUTH_USER,
  BASIC_AUTH_PASS: process.env.BASIC_AUTH_PASS,
  
  // Session configuration
  SESSION_SECRET: validateSessionSecret(),
  SESSION_TIMEOUT: parseInt(process.env.SESSION_TIMEOUT || '3600') * 1000, // Default 1 hour
  
  // Rate limiting
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== 'false',
  RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW || '900') * 1000, // 15 minutes
  // Default is 300 per 15m in headless mode, 600 per 15m when backed by the database; override for production
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || String(DEFAULT_RATE_LIMIT_MAX)),
};

// Use centralized crypto constants for consistency

// Derive an ephemeral key from password and salt, returning as Uint8Array
function deriveKeyFromPassword(password: string, salt: Uint8Array | string): Uint8Array {
  let saltBuffer: Buffer;
  
  if (typeof salt === 'string') {
    // Strict validation for hex salt strings
    const EXPECTED_HEX_LENGTH = 64; // 32 bytes = 64 hex chars (SALT_CONFIG.LENGTH * 2)
    if (salt.length !== EXPECTED_HEX_LENGTH) {
      throw new Error(
        `Invalid salt length: expected 32 bytes (${EXPECTED_HEX_LENGTH} hex chars), got ${salt.length} chars`
      );
    }
    if (!/^[0-9a-fA-F]+$/.test(salt)) {
      throw new Error('Invalid salt format: must be hexadecimal string');
    }
    saltBuffer = Buffer.from(salt, 'hex');
  } else {
    // For Uint8Array, validate length
    if (salt.length !== 32) {
      throw new Error(`Invalid salt length: expected 32 bytes, got ${salt.length} bytes`);
    }
    saltBuffer = Buffer.from(salt);
  }
  
  const key = pbkdf2Sync(
    password,
    saltBuffer,
    PBKDF2_CONFIG.ITERATIONS,
    PBKDF2_CONFIG.KEY_LENGTH,
    PBKDF2_CONFIG.ALGORITHM
  );
  // Return as Uint8Array for binary safety
  return new Uint8Array(key);
}

// In-memory session store (consider Redis for production clustering)
// Note: Rate limiting now uses persistent SQLite storage via rate-limiter.ts
const sessionStore = new Map<string, {
  userId: string | number | bigint; // Support string (env auth), number, and bigint (database user id)
  createdAt: number;
  lastAccess: number;
  ipAddress: string;
  salt?: string; // Store salt as hex string for non-database users (env auth)
  hasPassword?: boolean; // Flag indicating if password-based derived key is available in vault
  rehydrationsUsed: number; // Count of cache-driven rehydrations performed for this session
  // Note: for database users, salt comes from the database
}>();

// Cache of session-scoped derived keys to support rehydration after vault expiry
// Values are kept in-memory only for the lifespan of the session and wiped on cleanup/logout
const sessionDerivedKeyCache = new Map<string, Uint8Array>();

// Ephemeral derived key vault: TTL + bounded reads; zeroizes on removal
const AUTH_DERIVED_KEY_TTL_MS = Math.max(10_000, Math.min(10 * 60_000, parseInt(process.env.AUTH_DERIVED_KEY_TTL_MS || '120000')));
const AUTH_DERIVED_KEY_MAX_READS = Math.max(1, Math.min(1000, parseInt(process.env.AUTH_DERIVED_KEY_MAX_READS || '100')));
const AUTH_DERIVED_KEY_MAX_REHYDRATIONS = Math.max(0, Math.min(100, parseInt(process.env.AUTH_DERIVED_KEY_MAX_REHYDRATIONS || '3')));

// Configurable cleanup interval for vault entries (default 2 minutes)
const VAULT_CLEANUP_INTERVAL_MS = Math.max(
  30_000,  // minimum 30 seconds
  Math.min(
    10 * 60_000,  // maximum 10 minutes
    parseInt(process.env.VAULT_CLEANUP_INTERVAL_MS || '120000')  // default 2 minutes
  )
);

type VaultEntry = { key: Uint8Array; expiresAt: number; remainingReads: number };
const derivedKeyVault = new Map<string, VaultEntry>();

function vaultSet(sessionId: string, key: Uint8Array, ttlMs = AUTH_DERIVED_KEY_TTL_MS, maxReads = AUTH_DERIVED_KEY_MAX_READS) {
  // Store a fresh copy to avoid external references
  const copy = new Uint8Array(key);
  const existing = derivedKeyVault.get(sessionId);
  if (existing) zeroizeUint8(existing.key);
  derivedKeyVault.set(sessionId, { key: copy, expiresAt: Date.now() + ttlMs, remainingReads: maxReads });
}

function cacheDerivedKeyForSession(sessionId: string, key: Uint8Array): void {
  const existing = sessionDerivedKeyCache.get(sessionId);
  if (existing) zeroizeUint8(existing);
  sessionDerivedKeyCache.set(sessionId, new Uint8Array(key));
}

function clearCachedDerivedKey(sessionId: string): void {
  zeroizeUint8MapEntry(sessionDerivedKeyCache, sessionId);
}

export function refreshSessionDerivedKey(sessionId: string, key: Uint8Array): void {
  cacheDerivedKeyForSession(sessionId, key);
  vaultSet(sessionId, key);
}

export function rehydrateSessionDerivedKey(sessionId: string): Uint8Array | undefined {
  if (AUTH_DERIVED_KEY_MAX_REHYDRATIONS === 0) {
    const cachedDisabled = sessionDerivedKeyCache.get(sessionId);
    if (cachedDisabled) {
      zeroizeUint8(cachedDisabled);
      sessionDerivedKeyCache.delete(sessionId);
    }
    zeroizeVaultEntryAndDelete(sessionId);
    return undefined;
  }

  const session = sessionStore.get(sessionId);
  if (!session) {
    const cachedOrphan = sessionDerivedKeyCache.get(sessionId);
    if (cachedOrphan) {
      zeroizeUint8(cachedOrphan);
      sessionDerivedKeyCache.delete(sessionId);
    }
    zeroizeVaultEntryAndDelete(sessionId);
    return undefined;
  }

  const cached = sessionDerivedKeyCache.get(sessionId);
  if (!cached) return undefined;

  const used = session.rehydrationsUsed ?? 0;
  if (used >= AUTH_DERIVED_KEY_MAX_REHYDRATIONS) {
    console.warn('[auth] Session rehydration quota exceeded; denying rehydrate request.');
    zeroizeUint8(cached);
    sessionDerivedKeyCache.delete(sessionId);
    zeroizeVaultEntryAndDelete(sessionId);
    return undefined;
  }

  session.rehydrationsUsed = used + 1;

  const copy = new Uint8Array(cached);
  zeroizeUint8(cached);
  sessionDerivedKeyCache.set(sessionId, copy);
  vaultSet(sessionId, copy);
  return new Uint8Array(copy);
}

function zeroizeVaultEntryAndDelete(sessionId: string) {
  const entry = derivedKeyVault.get(sessionId);
  if (entry) {
    zeroizeUint8(entry.key);
    derivedKeyVault.delete(sessionId);
  }
}

export function vaultGetOnce(sessionId: string): Uint8Array | undefined {
  const entry = derivedKeyVault.get(sessionId);
  if (!entry) return undefined;
  const now = Date.now();
  if (now > entry.expiresAt) {
    zeroizeVaultEntryAndDelete(sessionId);
    return undefined;
  }
  // Return a copy to the caller
  const out = new Uint8Array(entry.key);
  entry.remainingReads -= 1;
  if (entry.remainingReads <= 0) zeroizeVaultEntryAndDelete(sessionId);
  return out;
}

// Clean up expired vault entries proactively to prevent memory accumulation
function cleanupExpiredVaultEntries(): void {
  const now = Date.now();
  for (const [sessionId, entry] of Array.from(derivedKeyVault.entries())) {
    if (now > entry.expiresAt) {
      // Reuse existing zeroization logic
      zeroizeVaultEntryAndDelete(sessionId);
    }
  }
}

export interface AuthResult {
  authenticated: boolean;
  userId?: string | number; // Only JSON-serializable types
  error?: string;
  rateLimited?: boolean;
  derivedKey?: Uint8Array; // Derived key for decryption operations (ephemeral - cleared after extraction)
  sessionId?: string; // Session ID for lazy vault retrieval
  hasPassword?: boolean; // Flag indicating if password-based derived key is available
}

// Get client IP address from various headers
function getClientIP(req: Request): string {
  const xForwardedFor = req.headers.get('x-forwarded-for');
  const xRealIP = req.headers.get('x-real-ip');
  const cfConnectingIP = req.headers.get('cf-connecting-ip');
  
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }
  if (xRealIP) return xRealIP;
  if (cfConnectingIP) return cfConnectingIP;
  
  return 'unknown';
}

// Rate limiting implementation using persistent SQLite storage
export async function checkRateLimit(
  req: Request,
  bucket: string = 'auth',
  opts?: { windowMs?: number; max?: number }
): Promise<{ allowed: boolean; remaining: number }> {
  if (!AUTH_CONFIG.RATE_LIMIT_ENABLED) {
    return { allowed: true, remaining: AUTH_CONFIG.RATE_LIMIT_MAX };
  }

  const clientIP = getClientIP(req);
  const rateLimiter = getRateLimiter();

  const result = await rateLimiter.checkLimit(clientIP, {
    windowMs: opts?.windowMs ?? AUTH_CONFIG.RATE_LIMIT_WINDOW,
    maxAttempts: opts?.max ?? AUTH_CONFIG.RATE_LIMIT_MAX,
    bucket
  });

  return {
    allowed: result.allowed,
    remaining: result.remaining
  };
}

function extractApiKey(req: Request): string | null {
  const headerKey = req.headers.get('x-api-key');
  if (headerKey && headerKey.trim().length > 0) {
    return headerKey.trim();
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token.length > 0) {
      return token;
    }
  }

  return null;
}

// API Key authentication (headless mode via environment variable)
function authenticateHeadlessApiKey(req: Request): AuthResult {
  if (!AUTH_CONFIG.API_KEY) {
    return { authenticated: false, error: 'API key authentication not configured' };
  }

  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return { authenticated: false, error: 'API key required' };
  }

  const providedKey = Buffer.from(apiKey);
  const expectedKey = Buffer.from(AUTH_CONFIG.API_KEY);

  if (providedKey.length !== expectedKey.length) {
    return { authenticated: false, error: 'Invalid API key' };
  }

  if (timingSafeEqual(providedKey, expectedKey)) {
    return { authenticated: true, userId: 'api-user' };
  }

  return { authenticated: false, error: 'Invalid API key' };
}

// API Key authentication (database-backed multi-key support)
function authenticateDatabaseApiKey(req: Request): AuthResult {
  if (!hasActiveApiKeys()) {
    return { authenticated: false, error: 'API key authentication not configured' };
  }

  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return { authenticated: false, error: 'API key required' };
  }

  const verification = verifyApiKeyToken(apiKey);
  if (!verification.success) {
    const errorMessage = verification.reason === 'revoked'
      ? 'API key revoked'
      : 'Invalid API key';
    return { authenticated: false, error: errorMessage };
  }

  const clientIp = getClientIP(req);
  markApiKeyUsed(verification.apiKeyId, clientIp === 'unknown' ? null : clientIp);

  return { authenticated: true, userId: `api-key:${verification.prefix}` };
}

// Basic Auth authentication
function authenticateBasicAuth(req: Request): AuthResult {
  if (!AUTH_CONFIG.BASIC_AUTH_USER || !AUTH_CONFIG.BASIC_AUTH_PASS) {
    return { authenticated: false, error: 'Basic auth not configured' };
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return { authenticated: false, error: 'Basic auth required' };
  }

  try {
    const credentials = atob(authHeader.slice(6));
    const [username, password] = credentials.split(':');
    
    const userValid = timingSafeEqual(
      Buffer.from(username || ''),
      Buffer.from(AUTH_CONFIG.BASIC_AUTH_USER)
    );
    const passValid = timingSafeEqual(
      Buffer.from(password || ''),
      Buffer.from(AUTH_CONFIG.BASIC_AUTH_PASS)
    );
    
    if (userValid && passValid) {
      return { authenticated: true, userId: username };
    }
    
    return { authenticated: false, error: 'Invalid credentials' };
  } catch (error) {
    return { authenticated: false, error: 'Invalid authorization header' };
  }
}

// Session authentication for web UI
function authenticateSession(req: Request): AuthResult {
  // If no SESSION_SECRET is configured, session auth is not available
  if (!AUTH_CONFIG.SESSION_SECRET) {
    return { authenticated: false, error: 'Session authentication not available (SESSION_SECRET not configured)' };
  }
  
  const sessionId = req.headers.get('x-session-id') || extractSessionFromCookie(req);
  
  if (!sessionId) {
    return { authenticated: false, error: 'No session provided' };
  }

  const session = sessionStore.get(sessionId);
  if (!session) {
    return { authenticated: false, error: 'Invalid session' };
  }

  const now = Date.now();
  const lastActivity = session.lastAccess ?? session.createdAt;
  if (now - lastActivity > AUTH_CONFIG.SESSION_TIMEOUT) {
    sessionStore.delete(sessionId);
    clearCachedDerivedKey(sessionId);
    zeroizeVaultEntryAndDelete(sessionId);
    return { authenticated: false, error: 'Session expired' };
  }

  session.lastAccess = now;
  // Don't consume vault reads during authentication - pass sessionId for lazy retrieval
  // Convert bigint to string for JSON safety (handles legacy sessions)
  const userId = typeof session.userId === 'bigint' ? session.userId.toString() : session.userId;
  // Include hasPassword flag to indicate if password-based derived key is available
  return { authenticated: true, userId, sessionId, hasPassword: session.hasPassword };
}

// Extract session ID from cookie header
function extractSessionFromCookie(req: Request): string | null {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith('session=')) {
      return cookie.slice(8);
    }
  }
  return null;
}

// Create new session
export function createSession(
  userId: string | number, // Only JSON-serializable types
  ipAddress: string,
  password?: string,
  dbSalt?: string  // Optional database salt for database users
): string | null {
  // If no SESSION_SECRET is configured, sessions are not available
  if (!AUTH_CONFIG.SESSION_SECRET) {
    return null;
  }

  const sessionId = randomBytes(32).toString('hex');
  const now = Date.now();

  // Generate derived key if password is provided
  let derivedKey: Uint8Array | undefined;
  let sessionSalt: string | undefined; // Salt to store for non-database users
  let hasPassword = false; // Track if password-based auth is available

  if (password) {
    hasPassword = true;
    if (dbSalt) {
      // Database users: Use persistent salt from database
      // This ensures the derived key can be recreated consistently across sessions
      derivedKey = deriveKeyFromPassword(password, dbSalt);
      // Don't store salt in session for database users (it's in the database)
    } else {
      // Non-database users (env auth): Generate ephemeral salt for this session
      // SECURITY DESIGN: This salt is intentionally session-specific and ephemeral.
      // Non-database users (Basic Auth/API Key users with string userIds) are 
      // explicitly blocked from accessing credential storage endpoints (/api/user/*).
      // This prevents data loss since they cannot save encrypted credentials anyway.
      // The ephemeral salt ensures session-scoped operations remain secure without
      // creating false expectations of data persistence.
      const salt = randomBytes(32);
      const saltHex = salt.toString('hex');
      sessionSalt = saltHex; // Store salt for this session's lifetime only
      derivedKey = deriveKeyFromPassword(password, saltHex);
    }
  }
  
  // Store derivedKey in ephemeral vault (TTL + bounded reads); do not persist on session
  if (derivedKey) {
    cacheDerivedKeyForSession(sessionId, derivedKey);
    vaultSet(sessionId, derivedKey);
    // Zeroize local copy after storing
    zeroizeUint8(derivedKey);
    derivedKey = undefined;
  }
  sessionStore.set(sessionId, {
    userId,
    createdAt: now,
    lastAccess: now,
    ipAddress,
    salt: sessionSalt, // Store salt for non-database users
    hasPassword, // Flag to indicate password-based auth
    rehydrationsUsed: 0
  });
  
  cleanupExpiredSessions();
  return sessionId;
}

// Note: Rate limit cleanup is now handled by the persistent rate limiter in rate-limiter.ts

// Cleanup expired sessions periodically
function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of Array.from(sessionStore.entries())) {
    const lastActivity = session.lastAccess ?? session.createdAt;
    if (now - lastActivity > AUTH_CONFIG.SESSION_TIMEOUT) {
      sessionStore.delete(sessionId);
      clearCachedDerivedKey(sessionId);
      // Ensure any lingering derived key is destroyed
      zeroizeVaultEntryAndDelete(sessionId);
    }
  }
}

// Set up periodic cleanup to prevent memory leaks from expired entries
// Run cleanup every 10 minutes (600,000 ms)
// Note: Rate limit cleanup is now handled by persistent rate limiter
const CLEANUP_INTERVAL = 10 * 60 * 1000;
let sessionCleanupTimer: ReturnType<typeof setInterval> | null = null;
let vaultCleanupTimer: ReturnType<typeof setInterval> | null = null;

// Start session cleanup timer
sessionCleanupTimer = setInterval(() => {
  cleanupExpiredSessions();
}, CLEANUP_INTERVAL);

// Start vault cleanup timer
vaultCleanupTimer = setInterval(() => {
  cleanupExpiredVaultEntries();
}, VAULT_CLEANUP_INTERVAL_MS);

// Export cleanup function for graceful shutdown
export function stopAuthCleanup(): void {
  // Clear timers
  if (sessionCleanupTimer) {
    clearInterval(sessionCleanupTimer);
    sessionCleanupTimer = null;
  }
  if (vaultCleanupTimer) {
    clearInterval(vaultCleanupTimer);
    vaultCleanupTimer = null;
  }

  // Zeroize all remaining vault entries on shutdown
  for (const sessionId of Array.from(derivedKeyVault.keys())) {
    zeroizeVaultEntryAndDelete(sessionId);
  }

  for (const sessionId of Array.from(sessionDerivedKeyCache.keys())) {
    clearCachedDerivedKey(sessionId);
  }
}

// Main authentication function
export async function authenticate(req: Request): Promise<AuthResult> {
  // In headless mode or when auth is disabled, use traditional auth
  if (!AUTH_CONFIG.ENABLED || HEADLESS) {
    if (!AUTH_CONFIG.ENABLED) {
      return { authenticated: true, userId: 'anonymous' };
    }
    // Continue with env-based auth in headless mode
  } else {
    // In non-headless mode, check if database is initialized
    // If not initialized, allow access to onboarding routes only
    const isOnboardingRoute = req.url.includes('/api/onboarding');
    try {
      const initialized = isDatabaseInitialized();
      if (!initialized && !isOnboardingRoute) {
        return { authenticated: false, error: 'Database not initialized. Please complete onboarding.' };
      }
    } catch (err: any) {
      console.error('[auth] Database initialization check failed:', err.message);
      // Treat database errors as "not initialized" to enforce onboarding
      if (!isOnboardingRoute) {
        return { authenticated: false, error: 'Database not initialized. Please complete onboarding.' };
      }
    }
  }

  const rateLimit = await checkRateLimit(req);
  if (!rateLimit.allowed) {
    return { authenticated: false, error: 'Rate limit exceeded', rateLimited: true };
  }

  // Try API Key first
  if (HEADLESS) {
    if (AUTH_CONFIG.API_KEY) {
      const apiResult = authenticateHeadlessApiKey(req);
      if (apiResult.authenticated) {
        return apiResult;
      }
    }
  } else {
    const apiResult = authenticateDatabaseApiKey(req);
    if (apiResult.authenticated) {
      return apiResult;
    }
  }
  
  // Try Basic Auth
  if (AUTH_CONFIG.BASIC_AUTH_USER && AUTH_CONFIG.BASIC_AUTH_PASS) {
    const basicResult = authenticateBasicAuth(req);
    if (basicResult.authenticated) {
      return basicResult;
    }
  }
  
  // Try Session
  const sessionResult = authenticateSession(req);
  if (sessionResult.authenticated) {
    return sessionResult;
  }

  return { authenticated: false, error: 'Authentication required' };
}

// Login endpoint
export async function handleLogin(req: Request): Promise<Response> {
  // Get CORS headers for cross-origin support
  const corsHeaders = getSecureCorsHeaders(req);
  const mergedVary = mergeVaryHeaders(corsHeaders);
  
  const baseHeaders = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Vary': mergedVary,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: baseHeaders });
  }
  
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: baseHeaders });
  }

  try {
    let body;
    try {
      body = await parseJsonRequestBody(req);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Invalid request body' },
        { status: 400, headers: {
          ...baseHeaders,
          'Set-Cookie': `session=; HttpOnly; Path=/; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}SameSite=Strict; Max-Age=0`
        } }
      );
    }
    
    const { username, password, apiKey } = body;

    let authenticated = false;
    let userId: string | number | bigint = '';
    let userPassword: string | undefined; // Store for database users

    if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
      if (HEADLESS && AUTH_CONFIG.API_KEY) {
        const providedKey = Buffer.from(apiKey);
        const expectedKey = Buffer.from(AUTH_CONFIG.API_KEY);

        if (providedKey.length !== expectedKey.length) {
          // Invalid API key, continue to next auth method
        } else if (timingSafeEqual(providedKey, expectedKey)) {
          authenticated = true;
          userId = 'api-user';
        }
      } else if (!HEADLESS) {
        const verification = verifyApiKeyToken(apiKey);
        if (verification.success) {
          authenticated = true;
          userId = `api-key:${verification.prefix}`;
          const clientIp = getClientIP(req);
          markApiKeyUsed(verification.apiKeyId, clientIp === 'unknown' ? null : clientIp);
        }
      }
    }
    
    // Try database authentication first (unless in headless mode)
    let userSalt: string | undefined; // Store user's database salt
    let dbInitialized = false;
    if (!HEADLESS) {
      try {
        dbInitialized = isDatabaseInitialized();
      } catch (err: any) {
        console.error('[auth] Database initialization check failed during session validation:', err.message);
        dbInitialized = false; // Treat errors as not initialized
      }
    }
    if (!authenticated && !HEADLESS && username && password && dbInitialized) {
      // Check rate limit for database authentication attempts
      const rate = await checkRateLimit(req);
      if (!rate.allowed) {
        return Response.json(
          { error: 'Too many login attempts. Please try again later.' },
          {
            status: 429,
            headers: {
              ...baseHeaders,
              'Retry-After': Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW || '900')).toString(),
              'Set-Cookie': `session=; HttpOnly; Path=/; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}SameSite=Strict; Max-Age=0`
            }
          }
        );
      }

      try {
        const dbResult = await authenticateUser(username, password);
        // authenticateUser returns a structured result, not throwing for auth failures
        if (dbResult && typeof dbResult === 'object' && dbResult.success === true && dbResult.user && dbResult.user.id != null) {
          authenticated = true;
          // Convert bigint to string for JSON-safe userId
          userId = typeof dbResult.user.id === 'bigint' ? dbResult.user.id.toString() : dbResult.user.id;
          userPassword = password; // Store for later decryption needs
          userSalt = dbResult.user.salt; // Store user's salt for key derivation
        }
        // If dbResult.success is false, it's an expected auth failure, not an error
        // We simply leave authenticated=false and continue
      } catch (err: any) {
        // Only real database errors should reach here (authenticateUser re-throws DB errors)
        // Check for specific SQLite error codes
        if (err?.code === 'SQLITE_BUSY' || 
            err?.code === 'SQLITE_LOCKED' || 
            err?.code === 'SQLITE_IOERR' ||
            err?.code === 'SQLITE_CORRUPT' ||
            err?.code === 'SQLITE_FULL') {
          // Critical database error - log and re-throw
          console.error('[auth] Database error during login:', {
            code: err.code,
            message: err.message,
            stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
          });
          
          // Return a generic error to the client (don't expose DB details)
          return Response.json({ 
            success: false, 
            error: 'Database temporarily unavailable. Please try again.' 
          }, { status: 503 }); // 503 Service Unavailable
        }
        
        // For unexpected errors, log but don't expose details
        console.error('[auth] Unexpected error during database authentication:', {
          type: typeof err,
          message: err?.message || 'Unknown error'
        });
        
        // Treat as auth failure (fail-closed approach for security)
        // We leave authenticated=false and continue
      }
    }
    
    // Try env-based basic auth (headless mode or fallback)
    if (!authenticated && username && password && AUTH_CONFIG.BASIC_AUTH_USER && AUTH_CONFIG.BASIC_AUTH_PASS) {
      const userValid = timingSafeEqual(
        Buffer.from(username),
        Buffer.from(AUTH_CONFIG.BASIC_AUTH_USER)
      );
      const passValid = timingSafeEqual(
        Buffer.from(password),
        Buffer.from(AUTH_CONFIG.BASIC_AUTH_PASS)
      );
      
      if (userValid && passValid) {
        authenticated = true;
        userId = username;
      }
    }

    if (!authenticated) {
      return Response.json({ 
        success: false, 
        error: 'Invalid credentials' 
      }, { status: 401, headers: baseHeaders });
    }

    const clientIP = getClientIP(req);
    // Convert bigint to string for JSON-safe storage
    const sessionUserId = typeof userId === 'bigint' ? userId.toString() : userId;
    const sessionId = createSession(sessionUserId, clientIP, userPassword, userSalt);

    if (!sessionId) {
      // Session creation failed (no SESSION_SECRET configured)
      return Response.json({
        success: true,
        userId,
        warning: 'Session not created - SESSION_SECRET not configured. Authentication will be required for each request.'
      }, { headers: baseHeaders });
    }

    return Response.json({
      success: true,
      sessionId,
      userId,
      expiresIn: AUTH_CONFIG.SESSION_TIMEOUT
    }, {
      headers: {
        ...baseHeaders,
        'Set-Cookie': `session=${sessionId}; HttpOnly; Path=/; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}SameSite=Strict; Max-Age=${AUTH_CONFIG.SESSION_TIMEOUT / 1000}`
      }
    });

  } catch (error) {
    return Response.json({ 
      success: false, 
      error: 'Invalid request body' 
    }, { status: 400, headers: baseHeaders });
  }
}

// Logout endpoint
export function handleLogout(req: Request): Response {
  // Get CORS headers for cross-origin support
  const corsHeaders = getSecureCorsHeaders(req);
  const mergedVary = mergeVaryHeaders(corsHeaders);
  
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Vary': mergedVary,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-ID',
    'Set-Cookie': `session=; HttpOnly; Path=/; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}SameSite=Strict; Max-Age=0`
  };
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }
  
  const sessionId = req.headers.get('x-session-id') || extractSessionFromCookie(req);
  
  if (sessionId) {
    sessionStore.delete(sessionId);
    clearCachedDerivedKey(sessionId);
    // Wipe any ephemeral derived key bound to this session
    try { zeroizeVaultEntryAndDelete(sessionId) } catch {}
  }

  return Response.json({ success: true }, { headers });
}

// Authentication middleware wrapper (deprecated - use explicit auth parameters instead)
// This function is not currently used but kept for reference
export function requireAuth(handler: Function) {
  return async (req: Request, url: URL, context: any): Promise<Response> => {
    const authResult = await authenticate(req);
    
    if (authResult.rateLimited) {
      return Response.json({ 
        error: 'Rate limit exceeded. Try again later.' 
      }, { 
        status: 429,
        headers: {
          'Retry-After': Math.ceil(AUTH_CONFIG.RATE_LIMIT_WINDOW / 1000).toString()
        }
      });
    }
    
    if (!authResult.authenticated) {
      // Don't set WWW-Authenticate header to avoid browser's native auth dialog
      // The frontend will handle authentication through its own UI
      return Response.json({ 
        error: authResult.error || 'Authentication required',
        authMethods: getAvailableAuthMethods()
      }, { 
        status: 401,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    
    // Note: Auth should be passed as explicit parameter, not mutating context
    // Create auth info to pass to handler
    // Store derived key for the duration of this request only
    // The vault read has already been consumed by authenticate()
    const requestScopedDerivedKey = authResult.derivedKey;

    const authInfo = {
      userId: authResult.userId,
      authenticated: true,
      // Removed direct storage of sensitive data to prevent exposure
      // Use secure getter functions instead

      // Secure getter function that returns the key for this request
      // Key is available for multiple calls within the same request
      // but vault read has already been consumed
      getDerivedKey(): Uint8Array | undefined {
        return requestScopedDerivedKey;
      }
    };

    return handler(req, url, context, authInfo);
  };
}

// Get available authentication methods
function getAvailableAuthMethods(): string[] {
  const methods: string[] = [];
  
  const apiKeyEnabled = HEADLESS ? !!AUTH_CONFIG.API_KEY : hasActiveApiKeys();
  if (apiKeyEnabled) methods.push('api-key');
  if (AUTH_CONFIG.BASIC_AUTH_USER && AUTH_CONFIG.BASIC_AUTH_PASS) methods.push('basic-auth');
  if (AUTH_CONFIG.SESSION_SECRET) methods.push('session');
  
  return methods;
}

// Status endpoint for authentication info
export function getAuthStatus(): object {
  return {
    enabled: AUTH_CONFIG.ENABLED,
    methods: getAvailableAuthMethods(),
    rateLimiting: AUTH_CONFIG.RATE_LIMIT_ENABLED,
    sessionTimeout: AUTH_CONFIG.SESSION_TIMEOUT / 1000,
  };
} 
