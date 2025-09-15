import { timingSafeEqual } from 'crypto';
import { ADMIN_SECRET, HEADLESS } from '../const.js';
import { isDatabaseInitialized, createUser } from '../db/database.js';
import { getSecureCorsHeaders, mergeVaryHeaders, parseJsonRequestBody } from './utils.js';
import { RouteContext } from './types.js';
import { VALIDATION } from '../config/crypto.js';

// Fixed delay to prevent timing attacks (milliseconds)
const UNIFORM_DELAY_MS = 150;

// Define route-to-methods mapping for proper 404/405 handling
const ROUTE_METHODS: Record<string, string[]> = {
  '/api/onboarding/status': ['GET'],
  '/api/onboarding/validate-admin': ['POST'],
  '/api/onboarding/setup': ['POST']
};

// Simple rate limiter for admin validation endpoints
const adminLimiter = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_ATTEMPTS_PER_WINDOW = 5;

// Periodic cleanup to bound memory for adminLimiter
const ADMIN_LIMITER_CLEANUP_INTERVAL_MS = 120000; // 2 minutes
let adminLimiterCleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Removes expired entries from the admin limiter Map.
 * Deletes any entry where resetAt is in the past.
 * @param now - Epoch ms used for comparison; defaults to current time
 */
function removeExpiredAdminLimiterEntries(now: number = Date.now()): void {
  for (const [ip, entry] of adminLimiter) {
    if (entry.resetAt <= now) adminLimiter.delete(ip);
  }
}

/**
 * Starts periodic cleanup of expired admin limiter entries.
 * Stores the timer so it can be cleared on shutdown.
 */
function startAdminLimiterCleanup(): void {
  if (adminLimiterCleanupTimer) return;
  adminLimiterCleanupTimer = setInterval(() => removeExpiredAdminLimiterEntries(), ADMIN_LIMITER_CLEANUP_INTERVAL_MS);
}

/**
 * Stops the periodic cleanup interval for admin limiter entries.
 */
export function stopAdminLimiterCleanup(): void {
  if (!adminLimiterCleanupTimer) return;
  clearInterval(adminLimiterCleanupTimer);
  adminLimiterCleanupTimer = null;
}

// Initialize cleanup when onboarding routes are active
if (!HEADLESS) startAdminLimiterCleanup();

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
function getClientIp(req: Request): string {
  // Check if we should trust proxy headers
  const trustProxy = process.env.TRUST_PROXY === 'true';

  if (trustProxy) {
    // Trust proxy headers when explicitly configured
    // Priority: X-Forwarded-For (standard), X-Real-IP (nginx), fallback
    const xForwardedFor = req.headers.get('x-forwarded-for');
    if (xForwardedFor) {
      // Take the first IP (original client) from comma-separated list
      return xForwardedFor.split(',')[0]?.trim() || 'unknown';
    }

    const xRealIp = req.headers.get('x-real-ip');
    if (xRealIp) {
      return xRealIp.trim();
    }
  }

  // When not trusting proxy or no proxy headers available,
  // use a combination of headers as a fingerprint for rate limiting
  // This prevents simple header spoofing attacks
  const userAgent = req.headers.get('user-agent') || '';
  const acceptLang = req.headers.get('accept-language') || '';
  const acceptEnc = req.headers.get('accept-encoding') || '';

  // Create a consistent fingerprint for rate limiting
  // Not perfect IP detection, but prevents trivial bypasses
  if (userAgent || acceptLang || acceptEnc) {
    // Use a simple hash to create a consistent identifier
    const fingerprint = `${userAgent}|${acceptLang}|${acceptEnc}`;
    // Simple hash to create shorter consistent ID
    let hash = 0;
    for (let i = 0; i < fingerprint.length; i++) {
      hash = ((hash << 5) - hash) + fingerprint.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `fp_${Math.abs(hash).toString(36)}`;
  }

  return 'unknown';
}

/**
 * Checks if the request should be rate limited based on client IP.
 * Uses the adminLimiter Map to track attempts per IP.
 * @param context - RouteContext (included for consistency, uses local state)
 * @param req - The incoming request
 * @returns true if the request should be rate limited, false otherwise
 */
async function checkPerIpRateLimit(context: RouteContext, req: Request): Promise<boolean> {
  const clientIp = getClientIp(req);
  const now = Date.now();
  
  // Prune expired entries proactively
  removeExpiredAdminLimiterEntries(now);

  let limiterEntry = adminLimiter.get(clientIp);
  
  if (limiterEntry) {
    if (now >= limiterEntry.resetAt) {
      // Window expired on access: delete the stale entry, then treat as first attempt
      adminLimiter.delete(clientIp);
      limiterEntry = undefined;
    } else if (limiterEntry.count >= MAX_ATTEMPTS_PER_WINDOW) {
      // Rate limit exceeded
      return true;
    } else {
      // Still within the window, increment count
      limiterEntry.count++;
      return false;
    }
  }
  
  // First attempt from this IP or expired entry was deleted
  adminLimiter.set(clientIp, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  return false;
}

// Uniform error response for all authentication failures
const UNIFORM_AUTH_ERROR = { error: 'Authentication failed' };

// Uniform error response for setup/creation failures
const UNIFORM_SETUP_ERROR = { error: 'Setup failed' };

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
          // Apply rate limiting BEFORE delay to prevent resource exhaustion
          const rateLimited = await checkPerIpRateLimit(_context, req);
          if (rateLimited) {
            // Still add delay to rate-limited responses for timing consistency
            await addUniformDelay();
            return Response.json(
              UNIFORM_AUTH_ERROR,
              { status: 401, headers }
            );
          }

          // Add uniform delay to all non-rate-limited responses
          await addUniformDelay();
          
          // Check if already initialized
          let initialized = false;
          try {
            initialized = isDatabaseInitialized();
          } catch (err: any) {
            console.error('[onboarding] Database initialization check failed in validate-admin:', err);
            return Response.json(
              { error: 'Database initialization check failed' },
              { status: 500, headers }
            );
          }
          
          if (initialized) {
            return Response.json(
              UNIFORM_AUTH_ERROR,
              { status: 401, headers }
            );
          }

          // Extract admin secret from Authorization header
          const authHeader = req.headers.get('Authorization');
          let adminSecret: string | undefined;
          if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
            adminSecret = authHeader.substring(7).trim();
          }

          // Use the helper function for validation
          const isValid = await validateAdminSecret(adminSecret);
          
          if (!isValid) {
            return Response.json(
              UNIFORM_AUTH_ERROR,
              { status: 401, headers }
            );
          }

          // Admin secret is valid, allow setup
          return Response.json(
            { success: true, message: 'Admin secret validated' },
            { headers }
          );
        }
        break;

      case '/api/onboarding/setup':
        if (req.method === 'POST') {
          // Apply rate limiting BEFORE delay to prevent resource exhaustion
          const rateLimited = await checkPerIpRateLimit(_context, req);
          if (rateLimited) {
            // Still add delay to rate-limited responses for timing consistency
            await addUniformDelay();
            return Response.json(
              UNIFORM_AUTH_ERROR,
              { status: 401, headers }
            );
          }

          // Add uniform delay to all non-rate-limited responses
          await addUniformDelay();
          
          // Check if already initialized
          let initialized = false;
          try {
            initialized = isDatabaseInitialized();
          } catch (err: any) {
            console.error('[onboarding] Database initialization check failed in setup:', err);
            return Response.json(
              { error: 'Database initialization check failed' },
              { status: 500, headers }
            );
          }
          
          if (initialized) {
            return Response.json(
              UNIFORM_AUTH_ERROR,
              { status: 401, headers }
            );
          }

          // Extract admin secret from Authorization header
          const authHeader = req.headers.get('Authorization');
          let adminSecret: string | undefined;
          if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
            adminSecret = authHeader.substring(7).trim();
          }

          let body;
          try {
            body = await parseJsonRequestBody(req);
          } catch (error) {
            console.error('Failed to parse JSON in onboarding/setup:', error);
            return Response.json(
              { error: error instanceof Error ? error.message : 'Invalid request body' },
              { status: 400, headers }
            );
          }
          const { username, password } = body;

          // Check for missing required fields first (these are validation errors, not auth errors)
          if (!username || !password) {
            return Response.json(
              { 
                error: 'validation_error', 
                message: 'Username and password are required' 
              },
              { status: 400, headers }
            );
          }

          // Validate admin secret using helper function
          const isAdminValid = await validateAdminSecret(adminSecret);
          
          if (!isAdminValid) {
            return Response.json(
              UNIFORM_AUTH_ERROR,
              { status: 401, headers }
            );
          }

          // Validate username (validation error, not auth error)
          if (username.length < 3 || username.length > 50) {
            return Response.json(
              { 
                error: 'invalid_username', 
                message: 'Username must be between 3 and 50 characters' 
              },
              { status: 400, headers }
            );
          }

          // Validate password strength with username check (validation error, not auth error)
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

          // Create the first user
          const result = await createUser(username, password);

          if (!result.success) {
            // Check for duplicate username
            if (result.error === 'Username already exists') {
              return Response.json(
                { error: 'Username already taken' },
                { status: 409, headers }
              );
            }
            // Use setup error for other creation failures
            return Response.json(
              UNIFORM_SETUP_ERROR,
              { status: 500, headers }
            );
          }

          return Response.json(
            {
              success: true,
              message: 'User created successfully',
              userId: result.userId,
            },
            { headers }
          );
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