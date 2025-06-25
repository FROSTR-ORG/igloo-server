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

// Unified router function
export async function handleRequest(req: Request, url: URL, context: RouteContext): Promise<Response> {
  // Set CORS headers for all API endpoints
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight OPTIONS request for all API endpoints
  if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    return new Response(null, { status: 200, headers });
  }

  // Try each route handler in order
  const routeHandlers = [
    handleStatusRoute,
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

  // Handle static files last (catch-all)
  const staticResult = await handleStaticRoute(req, url);
  if (staticResult) {
    return staticResult;
  }

  // If no route matched, return 404
  return new Response('Not Found', { status: 404 });
} 