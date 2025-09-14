import type { RouteContext, RequestAuth } from './types.js';
import { getSecureCorsHeaders, mergeVaryHeaders } from './utils.js';
import { checkRateLimit } from './auth.js';
import { getEventHash, type EventTemplate } from 'nostr-tools';

type SignRequestBody = {
  message?: string; // 32-byte hex event id
  event?: Partial<EventTemplate> & { kind: number; created_at: number; content: string; tags: any[] };
};

function normalizeHex(input: string): string | null {
  const hex = input.trim().toLowerCase();
  return /^[0-9a-f]+$/.test(hex) ? hex : null;
}

function computeEventId(body: SignRequestBody): { id: string } | { error: string } {
  if (body.message) {
    const hex = normalizeHex(body.message);
    if (!hex || hex.length !== 64) return { error: 'Invalid message: expected 32-byte hex event id' };
    return { id: hex };
  }

  if (body.event) {
    try {
      // Minimal shape validation; `pubkey` is not required for hashing
      const template: any = {
        pubkey: body.event.pubkey || ''.padStart(64, '0'),
        kind: body.event.kind,
        created_at: body.event.created_at,
        content: body.event.content ?? '',
        tags: Array.isArray(body.event.tags) ? body.event.tags : [],
      };
      const id = getEventHash(template);
      return { id };
    } catch (e) {
      return { error: 'Invalid event: could not compute id' };
    }
  }

  return { error: 'Request must include `message` or `event`' };
}

export async function handleSignRoute(req: Request, url: URL, context: RouteContext, _auth?: RequestAuth | null) {
  if (url.pathname !== '/api/sign') return null;

  const corsHeaders = getSecureCorsHeaders(req);
  const mergedVary = mergeVaryHeaders(corsHeaders);
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
    'Vary': mergedVary,
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });

  if (!context.node) {
    return Response.json({ error: 'Node not available' }, { status: 503, headers });
  }

  // Basic rate limit to protect signing endpoint
  const rate = checkRateLimit(req);
  if (!rate.allowed) {
    return Response.json({ error: 'Rate limit exceeded. Try again later.' }, {
      status: 429,
      headers: { ...headers, 'Retry-After': Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW || '900')).toString() }
    });
  }

  let body: SignRequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  const { id, error } = computeEventId(body) as any;
  if (error) return Response.json({ error }, { status: 400, headers });

  try {
    // Bifrost sign request returns { ok, data: SignatureEntry[] }
    const result = await (context.node as any).req.sign(id);
    if (!result || result.ok !== true) {
      const reason = (result && (result.err || result.error)) || 'signing failed';
      return Response.json({ error: reason }, { status: 502, headers });
    }

    // Expect an array like: [[sighash, pubkey, signature]]
    let signatureHex: string | null = null;
    try {
      if (Array.isArray(result.data)) {
        const entry = result.data.find((e: any) => Array.isArray(e) && e[0] === id) || result.data[0];
        signatureHex = Array.isArray(entry) ? entry[2] : null;
      }
    } catch {}

    if (!signatureHex || typeof signatureHex !== 'string') {
      return Response.json({ error: 'invalid signature response from node' }, { status: 502, headers });
    }

    return Response.json({ id, signature: signatureHex }, { status: 200, headers });
  } catch (e: any) {
    const message = e?.message || 'Internal error during sign';
    return Response.json({ error: message }, { status: 500, headers });
  }
}
