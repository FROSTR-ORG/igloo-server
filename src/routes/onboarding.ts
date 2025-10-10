import { timingSafeEqual } from 'crypto';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { ADMIN_SECRET, HEADLESS } from '../const.js';
import { isDatabaseInitialized, createUser } from '../db/database.js';
import { getSecureCorsHeaders, mergeVaryHeaders, parseJsonRequestBody, getTrustedClientIp, isContentLengthWithin, DEFAULT_MAX_JSON_BODY } from './utils.js';
import { RouteContext } from './types.js';
import { VALIDATION } from '../config/crypto.js';
import { getRateLimiter } from '../utils/rate-limiter.js';

// Fixed delay to prevent timing attacks (milliseconds)
const UNIFORM_DELAY_MS = 150;

// Define route-to-methods mapping for proper 404/405 handling
const ROUTE_METHODS: Record<string, string[]> = {
  '/api/onboarding/status': ['GET'],
  '/api/onboarding/validate-admin': ['POST'],
  '/api/onboarding/setup': ['POST']
};

// Rate limiting configuration for admin validation endpoints
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_ATTEMPTS_PER_WINDOW = 5;

// Stable client identifier cache (maps canonical fingerprint input -> stable ID)
const clientIdCache = new Map<string, { id: string; expiresAt: number }>();
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const CLIENT_ID_TTL_MS = Math.max(10 * 60_000, Math.min(SEVEN_DAYS_MS, parseInt(process.env.CLIENT_ID_TTL_MS || '86400000')));
const FINGERPRINT_SECRET = process.env.FINGERPRINT_SECRET || '';
const LOG_FINGERPRINT_FALLBACK = process.env.LOG_FINGERPRINT_FALLBACK === 'true';
let clientIdCleanupTimer: ReturnType<typeof setInterval> | null = null;


/**
 * Removes expired entries from the client identifier cache to bound memory.
 */
function removeExpiredClientIds(now: number = Date.now()): void {
  for (const [key, entry] of clientIdCache) {
    if (entry.expiresAt <= now) clientIdCache.delete(key);
  }
}

// Start periodic cleanup for client ID cache
function startClientIdCleanup(): void {
  if (clientIdCleanupTimer) return;
  clientIdCleanupTimer = setInterval(() => removeExpiredClientIds(), Math.min(CLIENT_ID_TTL_MS, 5 * 60_000));
}

// Initialize cleanup when onboarding routes are active
if (!HEADLESS) {
  startClientIdCleanup();
}

async function processOnboardingSecretRequest(
  req: Request,
  headers: Record<string, string>,
  context: RouteContext,
  mode: 'validate' | 'setup'
): Promise<Response> {
  if (mode === 'setup' && !isContentLengthWithin(req, DEFAULT_MAX_JSON_BODY)) {
    return Response.json({ error: 'Request too large' }, { status: 413, headers });
  }
  const rateLimited = await checkPerIpRateLimit(context, req);
  if (rateLimited) {
    await addUniformDelay();
    return Response.json(UNIFORM_AUTH_ERROR, { status: 401, headers });
  }

  await addUniformDelay();

  let initialized = false;
  try {
    initialized = isDatabaseInitialized();
  } catch (err: any) {
    console.error('[onboarding] Database initialization check failed:', err);
    return Response.json(
      { error: 'Database initialization check failed' },
      { status: 500, headers }
    );
  }

  if (initialized) {
    return Response.json(UNIFORM_AUTH_ERROR, { status: 401, headers });
  }

  const authHeader = req.headers.get('Authorization');
  let adminSecret: string | undefined;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    adminSecret = authHeader.substring(7).trim();
  }

  const isAdminValid = await validateAdminSecret(adminSecret);
  if (!isAdminValid) {
    return Response.json(UNIFORM_AUTH_ERROR, { status: 401, headers });
  }

  if (mode === 'validate') {
    return Response.json(
      { success: true, message: 'Admin secret validated' },
      { headers }
    );
  }

  let body;
  try {
    body = await parseJsonRequestBody(req);
  } catch (error) {
    console.error('Failed to parse JSON in onboarding/setup:', error);
    const message = error instanceof Error ? error.message : 'Invalid JSON body';
    return Response.json(
      { error: 'invalid_request', message },
      { status: 400, headers }
    );
  }

  const { username, password } = body;

  if (!username || !password) {
    return Response.json(
      {
        error: 'validation_error',
        message: 'Username and password are required'
      },
      { status: 400, headers }
    );
  }

  if (username.length < 3 || username.length > 50) {
    return Response.json(
      {
        error: 'invalid_username',
        message: 'Username must be between 3 and 50 characters'
      },
      { status: 400, headers }
    );
  }

  const passwordError = validatePasswordStrength(password, username);
  if (passwordError) {
    return Response.json(
      {
        error: 'invalid_password',
        message: passwordError
      },
      { status: 400, headers }
    );
  }

  const result = await createUser(username, password, { role: 'admin' });

  if (!result.success) {
    if (result.error === 'Username already exists') {
      return Response.json(
        { error: 'Username already taken' },
        { status: 409, headers }
      );
    }

    console.error('[onboarding] Failed to create initial user:', result.error);
    const errorMessage = result.error ?? 'Setup failed';
    return Response.json({ error: errorMessage }, { status: 500, headers });
  }

  return Response.json(
    { success: true, message: 'Setup complete' },
    { headers }
  );
}

// Helper function to add uniform delay to responses
async function addUniformDelay(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, UNIFORM_DELAY_MS));
}

/**
 * Extracts client IP from request headers with proxy trust validation.
 * Only trusts proxy headers when TRUST_PROXY environment variable is set.
 *
 * Security Note: In production behind a proxy (nginx, cloudflare, etc), set
 * TRUST_PROXY=true. Without a trusted proxy, we cannot reliably determine
 * the client IP, so we use a hash of headers for rate limiting consistency.
 */
function getClientIp(req: Request, fallbackFromServer?: string | null): string {
  // Use shared helper; preserves TRUST_PROXY semantics and server-provided IP
  const ip = getTrustedClientIp(req, fallbackFromServer);
  if (ip !== 'unknown') return ip;
  // Fallback to stable fingerprinting when no IP is available at all
  // (reuse existing mechanism and cache to avoid memory growth)
  // Avoid per-request volatile headers (e.g., 'cf-ray') that would churn identities
  const headerKeys = [
    'user-agent', 'accept-language', 'accept-encoding', 'accept', 'dnt',
    'sec-ch-ua', 'sec-ch-ua-platform', 'sec-ch-ua-mobile', 'sec-ch-ua-arch', 'sec-ch-ua-model',
    'x-forwarded-proto', 'cf-ipcountry'
  ];
  const parts: Array<[string, string]> = [];
  for (const key of headerKeys) {
    const val = req.headers.get(key);
    if (val) parts.push([key, val]);
  }
  if (parts.length === 0) return 'unknown';
  parts.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const canonical = JSON.stringify(parts);
  const now = Date.now();
  const cached = clientIdCache.get(canonical);
  if (cached && cached.expiresAt > now) return cached.id;
  const encoder = new TextEncoder();
  const digest = FINGERPRINT_SECRET
    ? hmac(sha256, encoder.encode(FINGERPRINT_SECRET), encoder.encode(canonical))
    : sha256(encoder.encode(canonical));
  const hex = Buffer.from(digest).toString('hex');
  const id = `fp_${hex.slice(0, 32)}`;
  clientIdCache.set(canonical, { id, expiresAt: now + CLIENT_ID_TTL_MS });
  if (process.env.NODE_ENV === 'production' && LOG_FINGERPRINT_FALLBACK) {
    console.warn('[onboarding] Using fingerprint fallback for client identification. Consider enabling TRUST_PROXY for IP propagation.');
  }
  return id;
}

/**
 * Checks if the request should be rate limited based on client IP.
 * Uses persistent SQLite-backed rate limiting that survives server restarts.
 * @param context - RouteContext (included for consistency, uses local state)
 * @param req - The incoming request
 * @returns true if the request should be rate limited, false otherwise
 */
async function checkPerIpRateLimit(_context: RouteContext, req: Request): Promise<boolean> {
  const clientIp = getClientIp(req, _context.clientIp ?? null);
  const rateLimiter = getRateLimiter();

  const result = await rateLimiter.checkLimit(clientIp, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxAttempts: MAX_ATTEMPTS_PER_WINDOW,
    bucket: 'onboarding_admin'
  });

  // Return true if rate limited (not allowed)
  return !result.allowed;
}

// Uniform error response for all authentication failures
const UNIFORM_AUTH_ERROR = { error: 'Authentication failed' };

// Password validation regex - requires at least one of each:
// - Uppercase letter
// - Lowercase letter
// - Digit
// - Special character (at least one of @$!%*?&, but allows any special chars)
// Note: Length validation is handled by VALIDATION.MIN_PASSWORD_LENGTH and VALIDATION.MAX_PASSWORD_LENGTH
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])\S*$/;

/**
 * Validates the admin secret in a timing-safe manner
 * @param adminSecret - The admin secret to validate
 * @returns true if valid, false otherwise
 */
export async function validateAdminSecret(adminSecret: string | undefined): Promise<boolean> {
  // Check if admin secret is configured
  if (!ADMIN_SECRET) {
    return false;
  }

  // Check if admin secret was provided
  if (!adminSecret) {
    return false;
  }

  try {
    // Coerce to string to prevent type errors
    const adminSecretStr = String(adminSecret);
    const providedSecret = Buffer.from(adminSecretStr);
    const expectedSecret = Buffer.from(ADMIN_SECRET);

    // Timing-safe comparison
    if (providedSecret.length !== expectedSecret.length) {
      return false;
    }
    
    return timingSafeEqual(providedSecret, expectedSecret);
  } catch {
    // On any error, perform dummy comparison to maintain consistent timing
    const expectedSecret = Buffer.from(String(ADMIN_SECRET));
    const dummySecret = Buffer.alloc(expectedSecret.length);
    try {
      timingSafeEqual(dummySecret, expectedSecret);
    } catch {}
    return false;
  }
}

/**
 * Checks for sequential or repeated characters
 * @param str - The string to check
 * @returns true if sequential/repeated patterns found
 */
function hasSequentialOrRepeated(str: string): boolean {
  // Check for repeated characters (e.g., "aaa", "111")
  if (/(.)(\1){2,}/.test(str)) {
    return true;
  }
  
  // Check for sequential characters (e.g., "abc", "123")
  for (let i = 0; i < str.length - 2; i++) {
    const char1 = str.charCodeAt(i);
    const char2 = str.charCodeAt(i + 1);
    const char3 = str.charCodeAt(i + 2);
    
    if (char2 - char1 === 1 && char3 - char2 === 1) {
      return true; // Ascending sequence
    }
    if (char1 - char2 === 1 && char2 - char3 === 1) {
      return true; // Descending sequence
    }
  }
  
  return false;
}

/**
 * Validates password strength with enhanced security checks
 * @param password - The password to validate
 * @param username - Optional username to check similarity
 * @returns An error message if invalid, null if valid
 */
function validatePasswordStrength(password: string, username?: string): string | null {
  if (!password || password.length < VALIDATION.MIN_PASSWORD_LENGTH || password.length > VALIDATION.MAX_PASSWORD_LENGTH) {
    return `Password must be between ${VALIDATION.MIN_PASSWORD_LENGTH} and ${VALIDATION.MAX_PASSWORD_LENGTH} characters`;
  }

  if (!PASSWORD_REGEX.test(password)) {
    return 'Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character (must include at least one of @$!%*?&)';
  }

  // Check for sequential or repeated characters
  if (hasSequentialOrRepeated(password)) {
    return 'Password must not contain sequential (e.g., "123", "abc") or repeated characters (e.g., "aaa")';
  }

  // Check similarity to username if provided
  if (username) {
    const lowerPassword = password.toLowerCase();
    const lowerUsername = username.toLowerCase();
    
    // Check if password contains username
    if (lowerPassword.includes(lowerUsername) || lowerUsername.includes(lowerPassword)) {
      return 'Password must not be similar to username';
    }
    
    // Check if password is username with simple substitutions
    const substituted = lowerUsername
      .replace(/a/g, '@')
      .replace(/e/g, '3')
      .replace(/i/g, '1')
      .replace(/o/g, '0')
      .replace(/s/g, '$');
    
    if (lowerPassword.includes(substituted)) {
      return 'Password must not be a simple variation of username';
    }
  }

  return null;
}

export async function handleOnboardingRoute(
  req: Request,
  url: URL,
  _context: RouteContext // Unused but required for consistent interface
): Promise<Response | null> {
  // Skip onboarding routes in headless mode
  if (HEADLESS) {
    return null;
  }

  if (!url.pathname.startsWith('/api/onboarding')) return null;

  const corsHeaders = getSecureCorsHeaders(req);
  const mergedVary = mergeVaryHeaders(corsHeaders);
  
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'Expires': '0',
    ...corsHeaders,
    'Vary': mergedVary,
  };

  if (req.method === 'OPTIONS') {
    const optionsHeaders = {
      ...headers,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Vary': mergedVary,  // Use merged value to prevent cache key collisions
    };
    return new Response(null, { status: 200, headers: optionsHeaders });
  }

  try {
    switch (url.pathname) {
      case '/api/onboarding/status':
        if (req.method === 'GET') {
          // Check if database is initialized
          let initialized = false;
          try {
            initialized = isDatabaseInitialized();
          } catch (err: any) {
            console.error('[onboarding] Database initialization check failed:', err);
            return Response.json(
              { error: 'Database initialization check failed' },
              { status: 500, headers }
            );
          }
          
          const hasAdminSecret = !!ADMIN_SECRET;
          
          return Response.json(
            {
              initialized,
              hasAdminSecret,
              headlessMode: false, // We already checked above
            },
            { headers }
          );
        }
        break;

      case '/api/onboarding/validate-admin':
        if (req.method === 'POST') {
          return processOnboardingSecretRequest(req, headers, _context, 'validate');
        }
        break;

      case '/api/onboarding/setup':
        if (req.method === 'POST') {
          return processOnboardingSecretRequest(req, headers, _context, 'setup');
        }
        break;
    }

    // Check if the route exists
    const allowedMethods = ROUTE_METHODS[url.pathname];
    if (!allowedMethods) {
      // Route doesn't exist
      return Response.json(
        { error: 'Not found' },
        { status: 404, headers }
      );
    }

    // Route exists but method not allowed
    return Response.json(
      { error: 'Method not allowed' },
      { 
        status: 405, 
        headers: {
          ...headers,
          'Allow': allowedMethods.join(', ')
        }
      }
    );
  } catch (error) {
    console.error('Onboarding API Error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500, headers }
    );
  }
}
