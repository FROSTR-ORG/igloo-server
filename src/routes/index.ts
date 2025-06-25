// Export all route handlers
export { handleStatusRoute } from './status.js';
export { handleEventsRoute } from './events.js';
export { handlePeersRoute } from './peers.js';
export { handleRecoveryRoute } from './recovery.js';
export { handleSharesRoute } from './shares.js';
export { handleEnvRoute } from './env.js';
export { handleStaticRoute } from './static.js';

// Export types and utilities
export * from './types.js';
export * from './utils.js';

import { RouteContext } from './types.js';
import { handleStatusRoute } from './status.js';
import { handleEventsRoute } from './events.js';
import { handlePeersRoute } from './peers.js';
import { handleRecoveryRoute } from './recovery.js';
import { handleSharesRoute } from './shares.js';
import { handleEnvRoute } from './env.js';
import { handleStaticRoute } from './static.js';
import { 
  requireAuth, 
  handleLogin, 
  handleLogout, 
  getAuthStatus, 
  AUTH_CONFIG,
  authenticate 
} from './auth.js';

// Unified router function
export async function handleRequest(req: Request, url: URL, context: RouteContext): Promise<Response> {
  // Set CORS headers for all API endpoints
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
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

  // Handle static files without auth (frontend needs to load to show login)
  if (!url.pathname.startsWith('/api/')) {
    const staticResult = await handleStaticRoute(req, url);
    if (staticResult) {
      return staticResult;
    }
  }

  // Authentication check for API endpoints
  if (url.pathname.startsWith('/api/') && AUTH_CONFIG.ENABLED) {
    const authResult = authenticate(req);
    
    if (authResult.rateLimited) {
      return Response.json({ 
        error: 'Rate limit exceeded. Try again later.' 
      }, { 
        status: 429,
        headers: {
          ...headers,
          'Retry-After': Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW || '900')) / 60).toString()
        }
      });
    }
    
    if (!authResult.authenticated) {
      const authHeaders: Record<string, string> = { ...headers };
      
      if (AUTH_CONFIG.BASIC_AUTH_USER && AUTH_CONFIG.BASIC_AUTH_PASS) {
        authHeaders['WWW-Authenticate'] = 'Basic realm="Igloo Server"';
      }
      
      return Response.json({ 
        error: authResult.error || 'Authentication required',
        authMethods: getAuthStatus()
      }, { 
        status: 401,
        headers: authHeaders 
      });
    }
    
    // Add auth info to context
    context.auth = {
      userId: authResult.userId,
      authenticated: true
    };
  }

  // Define which endpoints need protection (all except status for health checks)
  const protectedRoutes = [
    '/api/env',
    '/api/peers',
    '/api/recover', 
    '/api/shares',
    '/api/events'
  ];

  // Apply additional protection to sensitive endpoints
  const isSensitiveRoute = protectedRoutes.some(route => url.pathname.startsWith(route));
  
  if (isSensitiveRoute && AUTH_CONFIG.ENABLED && !context.auth?.authenticated) {
    return Response.json({ 
      error: 'Authentication required for this endpoint',
      hint: 'This endpoint requires authentication. Use API key, basic auth, or login first.'
    }, { 
      status: 401,
      headers 
    });
  }

  // Try each route handler in order
  const routeHandlers = [
    handleStatusRoute,    // Allow unauthenticated for health checks
    handleEventsRoute,
    handlePeersRoute,
    handleRecoveryRoute,
    handleSharesRoute,
    handleEnvRoute,
  ];

  for (const handler of routeHandlers) {
    const result = await handler(req, url, context);
    if (result) {
      return result;
    }
  }

  // If no route matched, return 404
  return new Response('Not Found', { status: 404 });
} 