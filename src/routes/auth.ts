import { createHash, randomBytes, timingSafeEqual } from 'crypto';

// Validate SESSION_SECRET configuration
function validateSessionSecret(): string | null {
  const sessionSecret = process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (!sessionSecret) {
    const message = 'SESSION_SECRET environment variable is not set';
    if (isProduction) {
      console.error(`❌ SECURITY ERROR: ${message}. This is required in production to prevent session invalidation on server restarts.`);
      process.exit(1);
    } else {
      console.warn(`⚠️  WARNING: ${message}. Sessions will be invalidated on server restart. Set SESSION_SECRET for persistent sessions.`);
      return null;
    }
  }
  
  if (sessionSecret.length < 32) {
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

// In-memory stores (consider Redis for production clustering)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const sessionStore = new Map<string, { 
  userId: string; 
  createdAt: number; 
  lastAccess: number;
  ipAddress: string;
}>();

export interface AuthResult {
  authenticated: boolean;
  userId?: string;
  error?: string;
  rateLimited?: boolean;
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
  return { authenticated: true, userId: session.userId };
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
export function createSession(userId: string, ipAddress: string): string | null {
  // If no SESSION_SECRET is configured, sessions are not available
  if (!AUTH_CONFIG.SESSION_SECRET) {
    return null;
  }
  
  const sessionId = randomBytes(32).toString('hex');
  const now = Date.now();
  
  sessionStore.set(sessionId, {
    userId,
    createdAt: now,
    lastAccess: now,
    ipAddress
  });
  
  cleanupExpiredSessions();
  return sessionId;
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

// Set up periodic cleanup to prevent memory leaks from expired sessions
// Run cleanup every 10 minutes (600,000 ms)
const CLEANUP_INTERVAL = 10 * 60 * 1000;
setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL);

// Main authentication function
export function authenticate(req: Request): AuthResult {
  if (!AUTH_CONFIG.ENABLED) {
    return { authenticated: true, userId: 'anonymous' };
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
    let userId = '';

    if (apiKey && AUTH_CONFIG.API_KEY) {
      if (timingSafeEqual(Buffer.from(apiKey), Buffer.from(AUTH_CONFIG.API_KEY))) {
        authenticated = true;
        userId = 'api-user';
      }
    }
    
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
    const sessionId = createSession(userId, clientIP);

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
        'Set-Cookie': `session=${sessionId}; HttpOnly; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}SameSite=Strict; Max-Age=${AUTH_CONFIG.SESSION_TIMEOUT / 1000}`,
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
      'Set-Cookie': `session=; HttpOnly; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}SameSite=Strict; Max-Age=0`,
      'Content-Type': 'application/json'
    }
  });
}

// Authentication middleware wrapper
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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      if (AUTH_CONFIG.BASIC_AUTH_USER && AUTH_CONFIG.BASIC_AUTH_PASS) {
        headers['WWW-Authenticate'] = 'Basic realm="Igloo Server"';
      }
      
      return Response.json({ 
        error: authResult.error || 'Authentication required',
        authMethods: getAvailableAuthMethods()
      }, { 
        status: 401,
        headers 
      });
    }
    
    context.auth = {
      userId: authResult.userId,
      authenticated: true
    };
    
    return handler(req, url, context);
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