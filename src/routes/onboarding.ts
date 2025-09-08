import { timingSafeEqual } from 'crypto';
import { ADMIN_SECRET, HEADLESS } from '../const.js';
import { isDatabaseInitialized, createUser } from '../db/database.js';
import { getSecureCorsHeaders } from './utils.js';
import { RouteContext } from './types.js';

// Fixed delay to prevent timing attacks (milliseconds)
const UNIFORM_DELAY_MS = 150;

// Helper function to add uniform delay to responses
async function addUniformDelay(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, UNIFORM_DELAY_MS));
}

// Uniform error response for all authentication failures
const UNIFORM_AUTH_ERROR = { error: 'Authentication failed' };

// Password validation regex - requires at least one of each:
// - Uppercase letter
// - Lowercase letter
// - Digit
// - Special character
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

// Common weak passwords that should be rejected
const COMMON_PASSWORDS = new Set([
  'password1!', 'password123!', 'admin123!', 'qwerty123!',
  'password!', 'letmein1!', 'welcome1!', 'monkey123!',
  'dragon123!', 'master123!', 'abc123!@#', 'password1',
  'p@ssw0rd', 'p@ssword1', 'passw0rd!', 'admin@123'
]);

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
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long';
  }

  if (!PASSWORD_REGEX.test(password)) {
    return 'Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character (@$!%*?&)';
  }

  // Check against common passwords (case-insensitive)
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'This password is too common. Please choose a more unique password';
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
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  try {
    switch (url.pathname) {
      case '/api/onboarding/status':
        if (req.method === 'GET') {
          // Check if database is initialized
          const initialized = isDatabaseInitialized();
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
          // Add uniform delay to all responses
          await addUniformDelay();
          
          // Check if already initialized
          if (isDatabaseInitialized()) {
            return Response.json(
              UNIFORM_AUTH_ERROR,
              { status: 401, headers }
            );
          }

          // Extract admin secret from Authorization header
          const authHeader = req.headers.get('Authorization');
          let adminSecret: string | undefined;
          if (authHeader && authHeader.startsWith('Bearer ')) {
            adminSecret = authHeader.substring(7);
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
          // Add uniform delay to all responses
          await addUniformDelay();
          
          // Check if already initialized
          if (isDatabaseInitialized()) {
            return Response.json(
              UNIFORM_AUTH_ERROR,
              { status: 401, headers }
            );
          }

          // Extract admin secret from Authorization header
          const authHeader = req.headers.get('Authorization');
          let adminSecret: string | undefined;
          if (authHeader && authHeader.startsWith('Bearer ')) {
            adminSecret = authHeader.substring(7);
          }

          let body;
          try {
            body = await req.json();
          } catch (e) {
            console.error('Failed to parse JSON in onboarding/setup:', e);
            return Response.json(
              { error: 'Invalid JSON request body' },
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
            // Use uniform error response even for creation failures
            return Response.json(
              UNIFORM_AUTH_ERROR,
              { status: 401, headers }
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

    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers }
    );
  } catch (error) {
    console.error('Onboarding API Error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500, headers }
    );
  }
}