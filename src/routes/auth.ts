import { randomBytes, timingSafeEqual, pbkdf2Sync } from 'crypto';
import { existsSync, mkdirSync, readFileSync, statSync, openSync, writeSync, fsyncSync, renameSync, unlinkSync, closeSync, chmodSync } from 'fs';
import path from 'path';
import { HEADLESS } from '../const.js';
import { authenticateUser, isDatabaseInitialized } from '../db/database.js';
import { PBKDF2_CONFIG } from '../config/crypto.js';

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
    const endsWithSep = normalized.endsWith(path.sep) || normalized.endsWith(path.win32.sep);
    if (endsWithSep) return normalized;

    const base = path.basename(normalized);
    // Treat as file only if basename contains a non-leading dot (e.g., "file.ext")
    const firstDot = base.indexOf('.');
    const isHidden = firstDot === 0; // leading dot like .config
    const hasNonLeadingDot = firstDot > 0; // any dot not at position 0
    if (hasNonLeadingDot && !isHidden) {
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

// Authentication configuration from environment variables
export const AUTH_CONFIG = {
  // Enable/disable authentication (default: true for security)
  ENABLED: process.env.AUTH_ENABLED !== 'false',
  
  // Authentication methods
  API_KEY: process.env.API_KEY,
  BASIC_AUTH_USER: process.env.BASIC_AUTH_USER,
  BASIC_AUTH_PASS: process.env.BASIC_AUTH_PASS,
  
  // Session configuration
  SESSION_SECRET: validateSessionSecret(),
  SESSION_TIMEOUT: parseInt(process.env.SESSION_TIMEOUT || '3600') * 1000, // Default 1 hour
  
  // Rate limiting
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== 'false',
  RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW || '900') * 1000, // 15 minutes
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '100'), // 100 requests per window
};

// Use centralized crypto constants for consistency

// Derive an ephemeral key from password and salt, returning as Uint8Array
function deriveKeyFromPassword(password: string, salt: Uint8Array | string): Uint8Array {
  // Convert salt to Buffer if it's a hex string (for backward compatibility)
  const saltBuffer = typeof salt === 'string' ? Buffer.from(salt, 'hex') : salt;
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

// In-memory stores (consider Redis for production clustering)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const sessionStore = new Map<string, { 
  userId: string | number | bigint; // Support string (env auth), number, and bigint (database user id)
  createdAt: number; 
  lastAccess: number;
  ipAddress: string;
  derivedKey?: Uint8Array; // Store derived key as binary (will be moved to ephemeral storage per request)
  salt?: string; // Store salt as hex string for non-database users (env auth)
  // Note: for database users, salt comes from the database
}>();

export interface AuthResult {
  authenticated: boolean;
  userId?: string | number | bigint; // Support string, number, and bigint IDs
  error?: string;
  rateLimited?: boolean;
  derivedKey?: Uint8Array; // Derived key for decryption operations (ephemeral - cleared after extraction)
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

// Rate limiting implementation
export function checkRateLimit(req: Request): { allowed: boolean; remaining: number } {
  if (!AUTH_CONFIG.RATE_LIMIT_ENABLED) {
    return { allowed: true, remaining: AUTH_CONFIG.RATE_LIMIT_MAX };
  }

  const clientIP = getClientIP(req);
  const now = Date.now();
  const key = `rate_limit:${clientIP}`;
  
  const current = rateLimitStore.get(key);
  
  if (!current || now > current.resetTime) {
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + AUTH_CONFIG.RATE_LIMIT_WINDOW
    });
    return { allowed: true, remaining: AUTH_CONFIG.RATE_LIMIT_MAX - 1 };
  }
  
  if (current.count >= AUTH_CONFIG.RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }
  
  current.count++;
  return { allowed: true, remaining: AUTH_CONFIG.RATE_LIMIT_MAX - current.count };
}

// API Key authentication
function authenticateAPIKey(req: Request): AuthResult {
  if (!AUTH_CONFIG.API_KEY) {
    return { authenticated: false, error: 'API key authentication not configured' };
  }

  const apiKey = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');
  
  if (!apiKey) {
    return { authenticated: false, error: 'API key required' };
  }

  // Timing-safe comparison to prevent timing attacks
  const providedKey = Buffer.from(apiKey);
  const expectedKey = Buffer.from(AUTH_CONFIG.API_KEY);
  
  if (providedKey.length !== expectedKey.length || !timingSafeEqual(providedKey, expectedKey)) {
    return { authenticated: false, error: 'Invalid API key' };
  }

  return { authenticated: true, userId: 'api-user' };
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
  if (now - session.createdAt > AUTH_CONFIG.SESSION_TIMEOUT) {
    sessionStore.delete(sessionId);
    return { authenticated: false, error: 'Session expired' };
  }

  session.lastAccess = now;
  return { authenticated: true, userId: session.userId, derivedKey: session.derivedKey };
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
  userId: string | number | bigint, 
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
  
  if (password) {
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
  
  // SECURITY NOTE: derivedKey is currently stored persistently in sessionStore,
  // which violates the ephemeral storage pattern used elsewhere in the codebase.
  // This is a known limitation that requires architectural changes to fix properly.
  // Ideally, derivedKey should either:
  // 1. Be re-derived on each request from the password (performance cost), or
  // 2. Be stored in truly ephemeral storage with auto-clear after first access
  // The current implementation stores it for the entire session duration.
  sessionStore.set(sessionId, {
    userId,
    createdAt: now,
    lastAccess: now,
    ipAddress,
    derivedKey, // Store derived key as binary (NOTE: not truly ephemeral - see above)
    salt: sessionSalt // Store salt for non-database users
  });
  
  cleanupExpiredSessions();
  return sessionId;
}

// Cleanup expired rate limit entries periodically
function cleanupExpiredRateLimits(): void {
  const now = Date.now();
  for (const [key, entry] of Array.from(rateLimitStore.entries())) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

// Cleanup expired sessions periodically
function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of Array.from(sessionStore.entries())) {
    if (now - session.createdAt > AUTH_CONFIG.SESSION_TIMEOUT) {
      sessionStore.delete(sessionId);
    }
  }
}

// Set up periodic cleanup to prevent memory leaks from expired entries
// Run cleanup every 10 minutes (600,000 ms)
const CLEANUP_INTERVAL = 10 * 60 * 1000;
setInterval(() => {
  cleanupExpiredRateLimits();
  cleanupExpiredSessions();
}, CLEANUP_INTERVAL);

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

  const rateLimit = checkRateLimit(req);
  if (!rateLimit.allowed) {
    return { authenticated: false, error: 'Rate limit exceeded', rateLimited: true };
  }

  // Try API Key first
  if (AUTH_CONFIG.API_KEY) {
    const apiResult = authenticateAPIKey(req);
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
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const { username, password, apiKey } = body;

    let authenticated = false;
    let userId: string | number | bigint = '';
    let userPassword: string | undefined; // Store for database users

    if (apiKey && AUTH_CONFIG.API_KEY) {
      if (timingSafeEqual(Buffer.from(apiKey), Buffer.from(AUTH_CONFIG.API_KEY))) {
        authenticated = true;
        userId = 'api-user';
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
      try {
        const dbResult = await authenticateUser(username, password);
        // authenticateUser returns a structured result, not throwing for auth failures
        if (dbResult && typeof dbResult === 'object' && dbResult.success === true && dbResult.user && dbResult.user.id != null) {
          authenticated = true;
          userId = dbResult.user.id;
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
      }, { status: 401 });
    }

    const clientIP = getClientIP(req);
    const sessionId = createSession(userId, clientIP, userPassword, userSalt);

    if (!sessionId) {
      // Session creation failed (no SESSION_SECRET configured)
      return Response.json({
        success: true,
        userId,
        warning: 'Session not created - SESSION_SECRET not configured. Authentication will be required for each request.'
      });
    }

    return Response.json({
      success: true,
      sessionId,
      userId,
      expiresIn: AUTH_CONFIG.SESSION_TIMEOUT
    }, {
      headers: {
        'Set-Cookie': `session=${sessionId}; HttpOnly; Path=/; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}SameSite=Strict; Max-Age=${AUTH_CONFIG.SESSION_TIMEOUT / 1000}`,
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    return Response.json({ 
      success: false, 
      error: 'Invalid request body' 
    }, { status: 400 });
  }
}

// Logout endpoint
export function handleLogout(req: Request): Response {
  const sessionId = req.headers.get('x-session-id') || extractSessionFromCookie(req);
  
  if (sessionId) {
    sessionStore.delete(sessionId);
  }

  return Response.json({ success: true }, {
    headers: {
      'Set-Cookie': `session=; HttpOnly; Path=/; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}SameSite=Strict; Max-Age=0`,
      'Content-Type': 'application/json'
    }
  });
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
    // Store sensitive values that will be cleared after first access
    let derivedKey = authResult.derivedKey;
    
    const authInfo = {
      userId: authResult.userId,
      authenticated: true,
      // Removed direct storage of sensitive data to prevent exposure
      // Use secure getter functions instead
      
      // Secure getter function that clears sensitive data after first access
      getDerivedKey(): Uint8Array | undefined {
        const value = derivedKey;
        derivedKey = undefined; // Clear after access
        return value;
      }
    };
    
    return handler(req, url, context, authInfo);
  };
}

// Get available authentication methods
function getAvailableAuthMethods(): string[] {
  const methods: string[] = [];
  
  if (AUTH_CONFIG.API_KEY) methods.push('api-key');
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