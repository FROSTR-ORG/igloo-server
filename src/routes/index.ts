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

// Export types and utilities
export * from './types.js';
export * from './utils.js';

import { RouteContext, PrivilegedRouteContext } from './types.js';
import { handleStatusRoute } from './status.js';
import { handleEventsRoute } from './events.js';
import { handlePeersRoute } from './peers.js';
import { handleRecoveryRoute } from './recovery.js';
import { handleSharesRoute } from './shares.js';
import { handleEnvRoute } from './env.js';
import { handleStaticRoute } from './static.js';
import { handleDocsRoute } from './docs.js';
import { handleSignRoute } from './sign.js';
import { handleNip44Route } from './nip44.js';
import { 
  handleLogin, 
  handleLogout, 
  getAuthStatus, 
  AUTH_CONFIG,
  authenticate 
} from './auth.js';
import { getSecureCorsHeaders } from './utils.js';

// Unified router function
export async function handleRequest(
  req: Request, 
  url: URL, 
  baseContext: RouteContext, 
  privilegedContext: PrivilegedRouteContext
): Promise<Response> {
  // Get secure CORS headers based on request origin
  const corsHeaders = getSecureCorsHeaders(req);
  
  // Set CORS headers for all API endpoints
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
  };

  // Handle preflight OPTIONS request for all API endpoints
  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    return new Response(null, { status: 200, headers });
  }

  // Handle authentication endpoints first (these bypass main auth)
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
      const authResult = authenticate(req);
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

  // Handle static files without auth (frontend needs to load to show login)
  if (!url.pathname.startsWith('/api/')) {
    const staticResult = await handleStaticRoute(req, url);
    if (staticResult) {
      return staticResult;
    }
  }

  // Determine which context to use based on route
  const privilegedRoutes = ['/api/env']; // Only /api/env needs updateNode access
  const needsPrivilegedAccess = privilegedRoutes.some(route => url.pathname.startsWith(route));
  const context = needsPrivilegedAccess ? privilegedContext : baseContext;

  // Define endpoints that should be accessible without authentication
  const publicEndpoints = [
    '/api/auth/login',
    '/api/auth/logout', 
    '/api/auth/status',
    '/api/status'  // Health check endpoint should be public
  ];

  const isPublicEndpoint = publicEndpoints.some(endpoint => url.pathname === endpoint);

  // Authentication check for API endpoints (skip public endpoints)
  if (url.pathname.startsWith('/api/') && AUTH_CONFIG.ENABLED && !isPublicEndpoint) {
    const authResult = authenticate(req);
    
    if (authResult.rateLimited) {
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
    
    if (!authResult.authenticated) {
      // Don't set WWW-Authenticate header to avoid browser's native auth dialog
      // The frontend will handle authentication through its own UI
      return Response.json({ 
        error: authResult.error || 'Authentication required',
        authMethods: getAuthStatus()
      }, { 
        status: 401,
        headers 
      });
    }
    
    // Add auth info to context
    context.auth = {
      userId: authResult.userId,
      authenticated: true
    };
  }

  // Note: Authentication is now handled above for all non-public API endpoints

  // Handle privileged routes separately
  if (needsPrivilegedAccess && url.pathname.startsWith('/api/env')) {
    const result = await handleEnvRoute(req, url, privilegedContext);
    if (result) {
      return result;
    }
  }

  // Try each non-privileged route handler in order
  const routeHandlers = [
    handleStatusRoute,    // Allow unauthenticated for health checks
    handleEventsRoute,
    handlePeersRoute,
    handleRecoveryRoute,
    handleSharesRoute,
    handleSignRoute,      // Simple signing endpoint
    handleNip44Route,     // NIP-44 encryption/decryption endpoints
  ];

  for (const handler of routeHandlers) {
    const result = await handler(req, url, baseContext);
    if (result) {
      return result;
    }
  }

  // If no route matched, return 404
  return new Response('Not Found', { status: 404 });
} 