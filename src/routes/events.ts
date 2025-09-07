import { RouteContext, RequestAuth } from './types.js';
import { authenticate, AUTH_CONFIG } from './auth.js';
import { getSecureCorsHeaders } from './utils.js';

export function handleEventsRoute(req: Request, url: URL, _context: RouteContext, _auth?: RequestAuth | null): Response | null {
  if (url.pathname !== '/api/events') return null;

  // Check authentication - prefer passed auth, fallback to authenticate()
  if (AUTH_CONFIG.ENABLED) {
    // Use provided auth if available, otherwise authenticate the request
    // Note: authenticate() always returns an AuthResult object, never null
    const authToUse = _auth ?? authenticate(req);
    
    // Explicit null check for extra safety (though authenticate never returns null)
    if (!authToUse || !authToUse.authenticated) {
      const corsHeaders = getSecureCorsHeaders(req);
      return Response.json({ error: 'Unauthorized' }, { 
        status: 403,
        headers: {
          ...corsHeaders
        }
      });
    }
  }

  if (req.method === 'GET') {
    const corsHeaders = getSecureCorsHeaders(req);
    
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
        ...corsHeaders
      }
    });
  }

  return null;
} 