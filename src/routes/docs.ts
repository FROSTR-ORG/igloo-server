import { readFileSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';
import { getSecureCorsHeaders, mergeVaryHeaders } from './utils.js';
import { getContentType } from './utils.js';

/**
 * API Documentation Route Handler
 * 
 * Serves OpenAPI documentation in multiple formats:
 * - /api/docs - Swagger UI interface
 * - /api/docs/openapi.json - OpenAPI spec in JSON format  
 * - /api/docs/openapi.yaml - OpenAPI spec in YAML format
 */

// Cache the OpenAPI spec
let openApiSpec: any = null;
let openApiYaml: string = '';

function loadOpenApiSpec() {
  if (!openApiSpec) {
    try {
      const yamlPath = resolve('docs/openapi.yaml');
      openApiYaml = readFileSync(yamlPath, 'utf8');
      openApiSpec = YAML.parse(openApiYaml);
    } catch (error) {
      console.error('Failed to load OpenAPI spec:', error);
      // Fallback minimal spec
      openApiSpec = {
        openapi: '3.0.3',
        info: {
          title: 'Igloo Server API',
          version: '0.1.5',
          description: 'OpenAPI specification not found'
        },
        paths: {}
      };
      openApiYaml = YAML.stringify(openApiSpec);
    }
  }
  return { spec: openApiSpec, yaml: openApiYaml };
}

// Allowed local asset names to serve for the docs UI
const ALLOWED_DOCS_ASSETS = new Set([
  'swagger-ui.css',
  'swagger-ui-bundle.js',
  'swagger-ui-standalone-preset.js'
]);

// Swagger UI HTML template (self-hosted assets under /api/docs/assets/*)
const swaggerUIHtml = (specUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Igloo Server API Documentation</title>
  <link rel="stylesheet" type="text/css" href="/api/docs/assets/swagger-ui.css" />
  <style>
    html {
      box-sizing: border-box;
      overflow: -moz-scrollbars-vertical;
      overflow-y: scroll;
    }
    *, *:before, *:after {
      box-sizing: inherit;
    }
    body {
      margin:0;
      background: #fafafa;
    }
    .swagger-ui .topbar {
      background-color: #1e293b;
    }
    .swagger-ui .topbar .download-url-wrapper .select-label {
      color: #f1f5f9;
    }
    .swagger-ui .topbar .download-url-wrapper input[type=text] {
      border: 2px solid #475569;
    }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api/docs/assets/swagger-ui-bundle.js"></script>
  <script src="/api/docs/assets/swagger-ui-standalone-preset.js"></script>
  <script>
    function renderDocsFallback() {
      var el = document.getElementById('swagger-ui') || document.body;
      el.innerHTML = \`<div style="max-width:960px;margin:40px auto;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;border:1px solid #e5e7eb;border-radius:12px;background:#fff">
        <h1 style="margin:0 0 12px;font-size:20px;color:#111827">API docs assets not found</h1>
        <p style="margin:0 0 12px;color:#374151">Run <code style="background:#f3f4f6;padding:2px 6px;border-radius:6px">bun run docs:vendor</code> to fetch Swagger UI files into <code style="background:#f3f4f6;padding:2px 6px;border-radius:6px">static/docs/</code>, then refresh this page.</p>
        <p style="margin:0;color:#374151">You can still view the raw spec: <a href="/api/docs/openapi.json" style="color:#2563eb;text-decoration:underline">openapi.json</a> or <a href="/api/docs/openapi.yaml" style="color:#2563eb;text-decoration:underline">openapi.yaml</a>.</p>
      </div>\`;
    }

    window.onload = function() {
      var hasBundle = typeof window.SwaggerUIBundle === 'function';
      var hasPreset = typeof window.SwaggerUIStandalonePreset !== 'undefined';
      if (!hasBundle || !hasPreset) {
        renderDocsFallback();
        return;
      }

      window.ui = SwaggerUIBundle({
        url: '${specUrl}',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        tryItOutEnabled: true,
        requestInterceptor: function(request) {
          return request;
        }
      });
    };
  </script>
</body>
</html>
`;

export async function handleDocsRoute(req: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/docs')) return null;

  const { spec, yaml } = loadOpenApiSpec();

  // CORS headers for documentation endpoints (use secure CORS)
  const corsHeaders = getSecureCorsHeaders(req);
  const mergedVary = mergeVaryHeaders(corsHeaders);
  
  const headers = {
    ...corsHeaders,
    'Vary': mergedVary,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers });
  }

  // Serve local self-hosted assets for the docs UI
  if (url.pathname.startsWith('/api/docs/assets/')) {
    const name = url.pathname.split('/').pop() || '';
    if (!ALLOWED_DOCS_ASSETS.has(name)) {
      return new Response('Not Found', { status: 404, headers });
    }
    const localPath = `static/docs/${name}`;
    const file = Bun.file(localPath);
    if (await file.exists()) {
      const contentType = getContentType(localPath);
      return new Response(file, { headers: { ...headers, 'Content-Type': contentType } });
    }
    // If assets are missing, guide the operator to vendor them
    return new Response(
      JSON.stringify({
        error: 'Docs assets not found',
        hint: 'Run: bun run docs:vendor to fetch swagger-ui assets into static/docs/'
      }),
      { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
    );
  }

  switch (url.pathname) {
    case '/api/docs':
    case '/api/docs/': {
      // Swagger UI interface
      // Use a relative URL to avoid mixed-content issues behind TLS-terminating proxies
      const specUrl = `/api/docs/openapi.json`;
      const secHeaders: Record<string, string> = {};
      if (process.env.NODE_ENV === 'production') {
        Object.assign(secHeaders, {
          'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'no-referrer',
          // Swagger UI needs inline styles/scripts; keep minimal CSP for UI to function
          'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
        });
      }
      return new Response(swaggerUIHtml(specUrl), {
        headers: {
          'Content-Type': 'text/html',
          ...headers,
          ...secHeaders
        }
      });
    }

    case '/api/docs/openapi.json':
      // OpenAPI spec in JSON format
      return Response.json(spec, { headers });

    case '/api/docs/openapi.yaml':
      // OpenAPI spec in YAML format
      return new Response(yaml, {
        headers: {
          'Content-Type': 'text/yaml',
          ...headers
        }
      });



    default:
      return null;
  }
} 
