import { RouteContext } from './types.js';

export function handleEventsRoute(req: Request, url: URL, context: RouteContext): Response | null {
  if (url.pathname !== '/api/events') return null;

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
      
      cancel(reason) {
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

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Cache-Control',
        'Access-Control-Allow-Methods': 'GET',
      }
    });
  }

  return null;
} 