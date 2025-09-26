import { RouteContext, RequestAuth } from './types.js';
import { authenticate, AUTH_CONFIG } from './auth.js';
import { getSecureCorsHeaders, mergeVaryHeaders } from './utils.js';

export async function handleEventsRoute(req: Request, url: URL, _context: RouteContext, _auth?: RequestAuth | null): Promise<Response | null> {
  if (url.pathname !== '/api/events') return null;

  // Get secure CORS headers based on request origin
  const corsHeaders = getSecureCorsHeaders(req);
  
  const mergedVary = mergeVaryHeaders(corsHeaders);
  
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
    'Vary': mergedVary,
  };

  // Allow CORS preflight without authentication
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // Check authentication - prefer passed auth, fallback to authenticate()
  if (AUTH_CONFIG.ENABLED) {
    // Use provided auth if available, otherwise authenticate the request
    // Note: authenticate() always returns an AuthResult object, never null
    const authToUse = _auth ?? await authenticate(req);
    
    // Explicit null check for extra safety (though authenticate never returns null)
    if (!authToUse || !authToUse.authenticated) {
      return Response.json({ error: 'Authentication required' }, { 
        status: 401,
        headers
      });
    }
  }

  if (req.method === 'GET') {
    // Return instructions to use WebSocket instead of SSE
    return Response.json({
      error: 'Event streaming has been migrated to WebSocket',
      message: 'Please connect using WebSocket to ws://hostname:port/api/events instead of Server-Sent Events',
      upgrade: 'websocket',
      endpoint: '/api/events'
    }, {
      status: 426, // Upgrade Required
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        ...headers
      }
    });
  }

  return null;
} 