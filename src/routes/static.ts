import { getContentType } from './utils.js';

// Load static files into memory
const index_page = Bun.file('static/index.html');
const style_file = Bun.file('static/styles.css');
const script_file = Bun.file('static/app.js');

export async function handleStaticRoute(req: Request, url: URL): Promise<Response | null> {
  // Handle specific routes first
  switch (url.pathname) {
    case '/styles.css':
      return new Response(style_file, {
        headers: { 'Content-Type': 'text/css' }
      });

    case '/app.js':
      return new Response(script_file, {
        headers: { 'Content-Type': 'text/javascript' }
      });
  }

  // Handle assets directory
  if (url.pathname.startsWith('/assets/')) {
    // Serve files from assets directory
    const assetPath = url.pathname.substring(1); // Remove leading slash
    const file = Bun.file(`static/${assetPath}`);
    
    if (await file.exists()) {
      const contentType = getContentType(assetPath);
      return new Response(file, {
        headers: { 'Content-Type': contentType }
      });
    }
    
    return new Response('Asset not found', { status: 404 });
  }

  // Default to index.html for all other routes (SPA routing)
  if (!url.pathname.startsWith('/api/')) {
    return new Response(index_page, {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  return null;
} 