import { RouteContext } from './types.js';
import { authenticate, AUTH_CONFIG } from './auth.js';
import { getSecureCorsHeaders } from './utils.js';

export function handleEventsRoute(req: Request, url: URL, context: RouteContext): Response | null {
  if (url.pathname !== '/api/events') return null;

  // Check authentication for EventSource (which can only send cookies, not custom headers)
  if (AUTH_CONFIG.ENABLED) {
    const authResult = authenticate(req);
    if (!authResult.authenticated) {
      const corsHeaders = getSecureCorsHeaders(req);
      return new Response('Unauthorized', { 
        status: 401,
        headers: {
          'Content-Type': 'text/plain',
          ...corsHeaders
        }
      });
    }
  }

  if (req.method === 'GET') {
    let streamController: ReadableStreamDefaultController | null = null;
    
    const stream = new ReadableStream({
      start(controller) {
        try {
          // Store reference to controller
          streamController = controller;
          // Add this controller to the set of active streams
          context.eventStreams.add(controller);
          
          // Send initial connection event
          const connectEvent = {
            type: 'system',
            message: 'Connected to event stream',
            timestamp: new Date().toLocaleTimeString(),
            id: Math.random().toString(36).substring(2, 11)
          };
          
          const eventData = `data: ${JSON.stringify(connectEvent)}\n\n`;
          controller.enqueue(new TextEncoder().encode(eventData));
        } catch (error) {
          console.error('EventSource start error:', error);
          try {
            controller.error(error);
          } catch (e) {
            // Ignore if controller is already closed
          }
        }
      },
      
      cancel(_reason) {
        try {
          // Remove this controller when the connection is closed
          if (streamController) {
            context.eventStreams.delete(streamController);
            streamController = null;
          }
        } catch (error) {
          console.error('EventSource cancel error:', error);
        }
      }
    });

    const corsHeaders = getSecureCorsHeaders(req);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...corsHeaders,
        'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
        'Access-Control-Allow-Methods': 'GET',
      }
    });
  }

  return null;
} 