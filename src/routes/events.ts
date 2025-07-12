import { RouteContext } from './types.js';
import { authenticate, AUTH_CONFIG } from './auth.js';
import { getSecureCorsHeaders } from './utils.js';

export function handleEventsRoute(req: Request, url: URL, context: RouteContext): Response | null {
  if (url.pathname !== '/api/events') return null;

  // Check authentication first
  if (AUTH_CONFIG.ENABLED) {
    const authResult = authenticate(req);
    if (!authResult.authenticated) {
      const corsHeaders = getSecureCorsHeaders(req);
      return new Response('Unauthorized', { 
        status: 401,
        headers: {
          'Content-Type': 'application/json',
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