import type { RouteContext, RequestAuth } from './types.js';
import { getSecureCorsHeaders, mergeVaryHeaders, getOpTimeoutMs, parseJsonRequestBody } from './utils.js';
import { checkRateLimit } from './auth.js';
import { xOnly, deriveSharedSecret } from './crypto-utils.js';
import { nip44 } from 'nostr-tools';

type Nip44Body = {
  peer_pubkey: string; // x-only hex (32 bytes) or compressed (02/03 + x)
  content: string;     // plaintext (encrypt) or ciphertext (decrypt)
};

export async function handleNip44Route(req: Request, url: URL, context: RouteContext, requestAuth?: RequestAuth | null) {
  if (!url.pathname.startsWith('/api/nip44/')) return null;

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

  const authContext = requestAuth ?? context.auth;
  if (!authContext?.authenticated) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  if (!context.node) return Response.json({ error: 'Node not available' }, { status: 503, headers });

  // Basic rate limit for e2e crypto ops
  // Separate bucket for e2e crypto ops
  const rate = await checkRateLimit(req, 'crypto');
  if (!rate.allowed) {
    return Response.json({ error: 'Rate limit exceeded. Try again later.' }, {
      status: 429,
      headers: { ...headers, 'Retry-After': Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW || '900')).toString() }
    });
  }

  let body: Nip44Body;
  try {
    body = await parseJsonRequestBody(req);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid request body' },
      { status: 400, headers }
    );
  }

  const { peer_pubkey, content } = body as Nip44Body;
  const peer = typeof peer_pubkey === 'string' ? xOnly(peer_pubkey) : null;
  if (!peer) return Response.json({ error: 'Invalid peer_pubkey' }, { status: 400, headers });
  if (typeof content !== 'string') return Response.json({ error: 'Invalid content' }, { status: 400, headers });

  const timeoutMs = getOpTimeoutMs();
  try {
    const secretHex = await deriveSharedSecret(context.node, peer, timeoutMs);
    const mode = url.pathname.endsWith('/encrypt') ? 'encrypt' : url.pathname.endsWith('/decrypt') ? 'decrypt' : null;
    if (!mode) return Response.json({ error: 'Unknown operation' }, { status: 404, headers });

    // Platform-agnostic hex to Uint8Array conversion
    const hexBytes = secretHex.match(/.{1,2}/g);
    if (!hexBytes) {
      throw new Error('Invalid hex string format');
    }
    const key = new Uint8Array(hexBytes.map(byte => parseInt(byte, 16)));
    if (mode === 'encrypt') {
      const ciphertext = await nip44.encrypt(content, key);
      return Response.json({ result: ciphertext }, { status: 200, headers });
    } else {
      const plaintext = await nip44.decrypt(content, key);
      return Response.json({ result: plaintext }, { status: 200, headers });
    }
  } catch (e: any) {
    const message = e?.message || 'NIP-44 operation failed';
    if (message === 'ECDH_TIMEOUT') {
      try { context.addServerLog('warning', 'NIP-44 ECDH timeout', { peer }); } catch {}
      return Response.json({ error: `NIP-44 ECDH timed out after ${timeoutMs}ms` }, { status: 504, headers });
    }
    return Response.json({ error: message }, { status: 500, headers });
  }
}
