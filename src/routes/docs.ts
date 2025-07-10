import { readFileSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';
import { getSecureCorsHeaders } from './utils.js';

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

// Swagger UI HTML template
const swaggerUIHtml = (specUrl: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Igloo Server API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css" />
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
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
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
  const headers = {
    ...corsHeaders,
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

  switch (url.pathname) {
    case '/api/docs':
    case '/api/docs/': {
      // Swagger UI interface
      const specUrl = `${url.origin}/api/docs/openapi.json`;
      return new Response(swaggerUIHtml(specUrl), {
        headers: {
          'Content-Type': 'text/html',
          ...headers
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