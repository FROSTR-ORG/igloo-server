import { randomBytes, timingSafeEqual, pbkdf2Sync } from 'crypto';
import { existsSync, mkdirSync, readFileSync, chmodSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { HEADLESS } from '../const.js';
import { authenticateUser, isDatabaseInitialized } from '../db/database.js';

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
    // Ensure data directory exists
    if (!existsSync(SESSION_SECRET_DIR)) {
      mkdirSync(SESSION_SECRET_DIR, { recursive: true });
    }
    
    // Check if secret already exists
    if (existsSync(SESSION_SECRET_FILE)) {
      const secret = readFileSync(SESSION_SECRET_FILE, 'utf-8').trim();
      if (secret && secret.length >= 32) {
        console.log('🔑 SESSION_SECRET loaded from secure storage');
        return secret;
      }
    }
    
    // Generate new secret (32 bytes = 64 hex characters)
    const newSecret = randomBytes(32).toString('hex');
    
    // Securely write the new secret using Node's fs API
    try {
      writeFileSync(SESSION_SECRET_FILE, newSecret, { encoding: 'utf8', mode: 0o600 });
      // Ensure file permissions on Unix-like systems
      if (process.platform !== 'win32') {
        try {
          chmodSync(SESSION_SECRET_FILE, 0o600);
        } catch (e) {
          console.warn('Could not set file permissions for session secret:', e);
        }
      }
    } catch (error) {
      console.error('Failed to write session secret:', error);
      throw error;
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
    // Using provided SESSION_SECRET from environment
    console.log('🔐 SESSION_SECRET configured via environment variable');
  }
  
  // Validate length
  if (sessionSecret && sessionSecret.length < 32) {
    const message = 'SESSION_SECRET should be at least 32 characters long for security';
    if (isProduction) {
      console.error(`❌ SECURITY ERROR: ${message}`);
      process.exit(1);
    } else {
      console.warn(`⚠️  WARNING: ${message}`);
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

// Key derivation for secure password handling
const DERIVED_KEY_ITERATIONS = 100000;
const DERIVED_KEY_LENGTH = 32;
const DERIVED_KEY_ALGORITHM = 'sha256';

// Derive an ephemeral key from password and salt
function deriveKeyFromPassword(password: string, salt: Uint8Array | string): Uint8Array {
  // Convert salt to Buffer if it's a hex string (for backward compatibility)
  const saltBuffer = typeof salt === 'string' ? Buffer.from(salt, 'hex') : salt;
  const key = pbkdf2Sync(
    password,
    saltBuffer,
    DERIVED_KEY_ITERATIONS,
    DERIVED_KEY_LENGTH,
    DERIVED_KEY_ALGORITHM
  );
  return new Uint8Array(key);
}

// In-memory stores (consider Redis for production clustering)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const sessionStore = new Map<string, { 
  userId: string | number; // Support both string (env auth) and number (database user id)
  createdAt: number; 
  lastAccess: number;
  ipAddress: string;
  derivedKey?: Uint8Array; // Store derived key as binary (database users only)
  salt?: Uint8Array; // Random salt for key derivation (more secure than using sessionId)
}>();

export interface AuthResult {
  authenticated: boolean;
  userId?: string | number; // Support both string and number IDs
  error?: string;
  rateLimited?: boolean;
  password?: string; // Still returned for immediate use, but not stored
  derivedKey?: Uint8Array; // Derived key for decryption operations (binary)
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
  userId: string | number, 
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
  
  // Generate separate random salt for key derivation
  let derivedKey: Uint8Array | undefined;
  let salt: Uint8Array | undefined;
  if (password) {
    if (dbSalt) {
      // Use the provided database salt for database users
      // Convert hex string to Uint8Array
      salt = new Uint8Array(Buffer.from(dbSalt, 'hex'));
      derivedKey = deriveKeyFromPassword(password, salt);
    } else {
      // Generate a cryptographically secure random salt for non-database auth
      salt = new Uint8Array(randomBytes(32));
      derivedKey = deriveKeyFromPassword(password, salt);
    }
  }
  
  sessionStore.set(sessionId, {
    userId,
    createdAt: now,
    lastAccess: now,
    ipAddress,
    derivedKey, // Store derived key instead of password
    salt // Store salt for future verification
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
export function authenticate(req: Request): AuthResult {
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
    if (!isDatabaseInitialized() && !isOnboardingRoute) {
      return { authenticated: false, error: 'Database not initialized. Please complete onboarding.' };
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
    let userId: string | number = '';
    let userPassword: string | undefined; // Store for database users

    if (apiKey && AUTH_CONFIG.API_KEY) {
      if (timingSafeEqual(Buffer.from(apiKey), Buffer.from(AUTH_CONFIG.API_KEY))) {
        authenticated = true;
        userId = 'api-user';
      }
    }
    
    // Try database authentication first (unless in headless mode)
    let userSalt: string | undefined; // Store user's database salt
    if (!authenticated && !HEADLESS && username && password && isDatabaseInitialized()) {
      try {
        const dbResult = await authenticateUser(username, password);
        if (dbResult && typeof dbResult === 'object' && dbResult.success === true && dbResult.user && dbResult.user.id != null) {
          authenticated = true;
          userId = dbResult.user.id;
          userPassword = password; // Store for later decryption needs
          userSalt = dbResult.user.salt; // Store user's salt for key derivation
        }
      } catch (err) {
        // Log specific error types for better debugging
        if (err instanceof Error) {
          console.error('Database authentication error:', err.message);
          // Re-throw if it's a critical database error
          if (err.message.includes('SQLITE_BUSY') || err.message.includes('SQLITE_LOCKED')) {
            throw err;
          }
        } else {
          console.error('Database authentication threw unexpected error:', err);
        }
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
    const authResult = authenticate(req);
    
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
    let password = authResult.password;
    let derivedKey = authResult.derivedKey;
    
    const authInfo = {
      userId: authResult.userId,
      authenticated: true,
      // Removed direct storage of sensitive data to prevent exposure
      // Use secure getter functions instead
      
      // Secure getter functions that clear sensitive data after first access
      getPassword(): string | undefined {
        const value = password;
        password = undefined; // Clear after access
        return value;
      },
      
      getDerivedKey(): Uint8Array | ArrayBuffer | undefined {
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