// Export all route handlers
export { handleStatusRoute } from './status.js';
export { handleEventsRoute } from './events.js';
export { handlePeersRoute } from './peers.js';
export { handleRecoveryRoute } from './recovery.js';
export { handleSharesRoute } from './shares.js';
export { handleEnvRoute } from './env.js';
export { handleStaticRoute } from './static.js';
export { handleSignRoute } from './sign.js';
export { handleNip44Route } from './nip44.js';
export { handleNip04Route } from './nip04.js';
export { handleNip46Route } from './nip46.js';

// Export types and utilities
export * from './types.js';
export * from './utils.js';

import { RouteContext, PrivilegedRouteContext, RequestAuth } from './types.js';
import { createRequestAuth } from './auth-factory.js';
import { handleStatusRoute } from './status.js';
import { handleEventsRoute } from './events.js';
import { handlePeersRoute } from './peers.js';
import { handleRecoveryRoute } from './recovery.js';
import { handleSharesRoute } from './shares.js';
import { handleEnvRoute } from './env.js';
import { handleStaticRoute } from './static.js';
import { handleSignRoute } from './sign.js';
import { handleNip44Route } from './nip44.js';
import { handleNip04Route } from './nip04.js';
import { handleNip46Route } from './nip46.js';
import { handleDocsRoute } from './docs.js';
import { handleOnboardingRoute } from './onboarding.js';
import { handleUserRoute } from './user.js';
import { handleAdminRoute } from './admin.js';
import { 
  handleLogin, 
  handleLogout, 
  getAuthStatus, 
  AUTH_CONFIG,
  authenticate,
  checkRateLimit 
} from './auth.js';
import { getSecureCorsHeaders, mergeVaryHeaders } from './utils.js';
import { HEADLESS } from '../const.js';

// Unified router function
export async function handleRequest(
  req: Request, 
  url: URL, 
  baseContext: RouteContext, 
  privilegedContext: PrivilegedRouteContext
): Promise<Response> {
  
  
  // Get secure CORS headers based on request origin
  const corsHeaders = getSecureCorsHeaders(req);
  
  const mergedVary = mergeVaryHeaders(corsHeaders);
  
  // Set CORS headers for all API endpoints
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
    'Vary': mergedVary,
  };

  // Handle preflight OPTIONS request for all API endpoints
  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    return new Response(null, { status: 200, headers });
  }

  // Handle onboarding endpoints first (bypass auth in non-headless mode)
  if (!HEADLESS && url.pathname.startsWith('/api/onboarding')) {
    // Apply rate limiting to protect ADMIN_SECRET validation from brute-force
    // Only rate limit validation and setup endpoints, not the status endpoint
    if (url.pathname === '/api/onboarding/validate-admin' || 
        url.pathname === '/api/onboarding/setup') {
      const rateLimit = await checkRateLimit(req);
      if (!rateLimit.allowed) {
        return Response.json({ 
          error: 'Rate limit exceeded. Try again later.' 
        }, { 
          status: 429,
          headers: {
            ...headers,
            'Retry-After': Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW || '900')).toString()
          }
        });
      }
    }
    
    const onboardingResult = await handleOnboardingRoute(req, url, baseContext);
    if (onboardingResult) return onboardingResult;
  }

  // Handle authentication endpoints (these bypass main auth)
  if (url.pathname === '/api/auth/login') {
    return handleLogin(req);
  }
  
  if (url.pathname === '/api/auth/logout') {
    return handleLogout(req);
  }
  
  if (url.pathname === '/api/auth/status') {
    return Response.json(getAuthStatus(), { headers });
  }

  // Handle API documentation (require auth in production for security)
  if (url.pathname.startsWith('/api/docs')) {
    // Require authentication for docs in production
    if (AUTH_CONFIG.ENABLED && process.env.NODE_ENV === 'production') {
      const authResult = await authenticate(req);
      if (!authResult.authenticated) {
        return Response.json({ 
          error: 'Authentication required for API documentation in production',
          authMethods: getAuthStatus()
        }, { 
          status: 401,
          headers 
        });
      }
    }
    
    const docsResult = await handleDocsRoute(req, url);
    if (docsResult) {
      return docsResult;
    }
  }

  // Handle static files - only serve frontend in database mode
  if (!url.pathname.startsWith('/api/')) {
    if (HEADLESS) {
      // In headless mode, no frontend is served - return 404 for all non-API routes
      return Response.json({ 
        error: 'Frontend disabled in headless mode',
        message: 'This server is running in headless mode. Only API endpoints are available.',
        availableEndpoints: '/api/*'
      }, { 
        status: 404,
        headers 
      });
    } else {
      // In database mode, serve frontend (needs to load to show login)
      const staticResult = await handleStaticRoute(req, url);
      if (staticResult) {
        return staticResult;
      }
    }
  }

  // Determine which context to use based on route
  const privilegedRoutes = ['/api/env', '/api/user']; // Routes that need updateNode access
  const needsPrivilegedAccess = privilegedRoutes.some(route => url.pathname.startsWith(route));
  const context = needsPrivilegedAccess ? privilegedContext : baseContext;

  // Authentication info for this request (not stored in shared context)
  let authInfo: RequestAuth | null = null;
  const finalizeAuth = () => {
    if (authInfo?.destroySecrets) {
      try {
        authInfo.destroySecrets();
      } catch (cleanupError) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[routes] Failed to destroy auth secrets:', cleanupError);
        }
      }
    }
    authInfo = null;
  };

  // Define endpoints that should be accessible without authentication
  const publicEndpoints = [
    '/api/auth/login',
    '/api/auth/logout', 
    '/api/auth/status',
    '/api/onboarding/status',
    '/api/onboarding/validate-admin',
    '/api/onboarding/setup'
  ];

  const isPublicEndpoint = publicEndpoints.some(endpoint => url.pathname === endpoint);

  // Special handling for /api/status: try authentication if headers present, but allow unauthenticated access
  const isStatusEndpoint = url.pathname === '/api/status';

  // Admin endpoints have their own ADMIN_SECRET authentication
  const isAdminEndpoint = url.pathname.startsWith('/api/admin');

  // Authentication check for API endpoints (skip public endpoints, status, and admin)
  if (url.pathname.startsWith('/api/') && AUTH_CONFIG.ENABLED && !isPublicEndpoint && !isStatusEndpoint && !isAdminEndpoint) {
    const authResult = await authenticate(req);
    
    if (authResult.rateLimited) {
      const response = Response.json({ 
        error: 'Rate limit exceeded. Try again later.' 
      }, { 
        status: 429,
        headers: {
          ...headers,
          'Retry-After': Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW || '900')).toString()
        }
      });
      finalizeAuth();
      return response;
    }
    
    if (!authResult.authenticated) {
      // Don't set WWW-Authenticate header to avoid browser's native auth dialog
      // The frontend will handle authentication through its own UI
      const response = Response.json({ 
        error: authResult.error || 'Authentication required',
        authMethods: getAuthStatus()
      }, { 
        status: 401,
        headers 
      });
      finalizeAuth();
      return response;
    }
    
    authInfo = createRequestAuth({
      userId: authResult.userId,
      authenticated: true,
      derivedKey: authResult.derivedKey ? authResult.derivedKey : undefined,
      sessionId: authResult.sessionId,
      hasPassword: authResult.hasPassword
    });
  } else if (isStatusEndpoint && AUTH_CONFIG.ENABLED) {
    // Special handling for /api/status: attempt authentication if headers are present
    // but don't require it (allow unauthenticated health checks)
    try {
      const authResult = await authenticate(req);
      
      // Only use auth info if authentication actually succeeded (not rate limited or failed)
      if (authResult.authenticated && !authResult.rateLimited) {
        // Create auth info with secure ephemeral storage for secrets
        authInfo = createRequestAuth({
          userId: authResult.userId,
          authenticated: true,
          derivedKey: authResult.derivedKey ? authResult.derivedKey : undefined,
          sessionId: authResult.sessionId,
          hasPassword: authResult.hasPassword
        });
      }
      // If authentication failed or was rate limited, authInfo remains null (unauthenticated access)
    } catch (error) {
      // If authentication throws an error, allow unauthenticated access
      // Authentication attempt failed, allowing unauthenticated access for health checks
    }
  }

  // Note: Authentication is now handled above for all non-public API endpoints

  // Handle user routes (database mode only)
  if (!HEADLESS && url.pathname.startsWith('/api/user')) {
    const userResult = await handleUserRoute(req, url, privilegedContext, authInfo);
    if (userResult) {
      finalizeAuth();
      return userResult;
    }
  }

  // Handle admin routes (database mode only, requires ADMIN_SECRET)
  if (!HEADLESS && url.pathname.startsWith('/api/admin')) {
    const adminResult = await handleAdminRoute(req, url, baseContext);
    if (adminResult) {
      finalizeAuth();
      return adminResult;
    }
  }
  
  // Handle privileged routes separately
  if (needsPrivilegedAccess && url.pathname.startsWith('/api/env')) {
    const result = await handleEnvRoute(req, url, privilegedContext, authInfo);
    if (result) {
      finalizeAuth();
      return result;
    }
  }

  if (!HEADLESS && url.pathname.startsWith('/api/nip46/')) {
    const nip46Result = await handleNip46Route(req, url, privilegedContext, authInfo);
    if (nip46Result) {
      finalizeAuth();
      return nip46Result;
    }
  }

  // Try each non-privileged route handler in order
  // Note: These handlers now accept auth as an optional parameter
  const routeHandlers = [
    handleStatusRoute,    // Allow unauthenticated for health checks
    handleEventsRoute,
    handlePeersRoute,
    handleSignRoute,
    handleNip44Route,
    handleNip04Route,
    handleRecoveryRoute,
    handleSharesRoute,
  ];

  for (const handler of routeHandlers) {
    const result = await handler(req, url, context, authInfo);
    if (result) {
      finalizeAuth();
      return result;
    }
  }

  // If no route matched, return 404
  const notFound = new Response('Not Found', { status: 404 });
  finalizeAuth();
  return notFound;
} 
