import { getContentType } from './utils.js';
import { resolve, relative } from 'path';
import { HEADLESS } from '../const.js';

// Load static files into memory
const index_page = Bun.file('static/index.html');
const style_file = Bun.file('static/styles.css');
const script_file = Bun.file('static/app.js');

// Define the static directory path for security validation
const STATIC_DIR = resolve('static');

// Helper function to sanitize and validate file paths
function sanitizePath(requestedPath: string): string | null {
  try {
    // Remove leading slash and normalize the path
    const cleanPath = requestedPath.replace(/^\/+/, '');
    
    // Reject paths containing traversal sequences
    if (cleanPath.includes('..') || cleanPath.includes('\\')) {
      return null;
    }
    
    // Resolve the full path
    const fullPath = resolve(STATIC_DIR, cleanPath);
    
    // Ensure the resolved path is within the static directory
    const relativePath = relative(STATIC_DIR, fullPath);
    if (relativePath.startsWith('..') || relativePath.includes('..')) {
      return null;
    }
    
    return fullPath;
  } catch {
    return null;
  }
}

// Helper function to get caching headers for static assets
function getCachingHeaders(filePath: string): Record<string, string> {
  const headers: Record<string, string> = {};
  
  // Set cache control based on file type and environment
  const ext = filePath.split('.').pop()?.toLowerCase();
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  if (ext && ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) {
    // Images can be cached for a long time
    headers['Cache-Control'] = isDevelopment 
      ? 'public, max-age=3600' // 1 hour in dev
      : 'public, max-age=31536000, immutable'; // 1 year in prod
  } else if (ext && ['css', 'js'].includes(ext)) {
    // CSS/JS files - no cache in development for easier updates
    headers['Cache-Control'] = isDevelopment 
      ? 'no-cache, no-store, must-revalidate' // No cache in dev
      : 'public, max-age=86400'; // 1 day in prod
    
    // Add ETag based on file modification time for cache busting
    if (isDevelopment) {
      headers['ETag'] = `"${Date.now()}"`;
    }
  } else {
    // Other static files
    headers['Cache-Control'] = isDevelopment 
      ? 'no-cache' // No cache in dev
      : 'public, max-age=3600'; // 1 hour in prod
  }
  
  return headers;
}

function getSecurityHeaders(): Record<string, string> {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) return {};
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    // Minimal CSP suitable for this app shell; allow secure WebSocket connections to this host and default Nostr relays (primal.net, damus.io)
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' wss://relay.primal.net wss://relay.damus.io;"
  };
}

export async function handleStaticRoute(_req: Request, url: URL): Promise<Response | null> {
  // Headless mode guard - frontend is disabled
  if (HEADLESS) {
    return new Response(JSON.stringify({
      error: 'Frontend disabled in headless mode',
      message: 'This server is running in headless mode. Static files are not served.',
      requestedPath: url.pathname
    }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  
  // Handle specific routes first
  switch (url.pathname) {
    case '/styles.css':
      return new Response(style_file, {
        headers: { 
          'Content-Type': 'text/css',
          ...getCachingHeaders('styles.css')
        }
      });

    case '/app.js':
      return new Response(script_file, {
        headers: { 
          'Content-Type': 'text/javascript',
          ...getCachingHeaders('app.js')
        }
      });
  }

  // Handle assets directory
  if (url.pathname.startsWith('/assets/')) {
    // Sanitize and validate the requested path
    const safePath = sanitizePath(url.pathname);
    
    if (!safePath) {
      return new Response('Invalid path', { status: 400 });
    }
    
    const file = Bun.file(safePath);
    
    if (await file.exists()) {
      const contentType = getContentType(safePath);
      return new Response(file, {
        headers: { 
          'Content-Type': contentType,
          ...getCachingHeaders(safePath)
        }
      });
    }
    
    return new Response('Asset not found', { status: 404 });
  }

  // Default to index.html for all other routes (SPA routing)
  if (!url.pathname.startsWith('/api/')) {
    return new Response(index_page, {
      headers: { 
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache', // HTML should not be cached for SPA routing
        ...getSecurityHeaders()
      }
    });
  }

  return null;
} 
