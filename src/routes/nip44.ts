import type { RouteContext, RequestAuth, ServerBifrostNode } from './types.js';
import { getSecureCorsHeaders, mergeVaryHeaders, getOpTimeoutMs, withTimeout } from './utils.js';
import { checkRateLimit } from './auth.js';
import { nip44 } from 'nostr-tools';

type Nip44Body = {
  peer_pubkey: string; // x-only hex (32 bytes) or compressed (02/03 + x)
  content: string;     // plaintext (encrypt) or ciphertext (decrypt)
};

function xOnly(pubkey: string): string | null {
  let hex = pubkey.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  if (hex.length === 66 && (hex.startsWith('02') || hex.startsWith('03'))) return hex.slice(2);
  if (hex.length === 64) return hex;
  return null;
}

async function deriveSharedSecret(node: ServerBifrostNode, peerXOnly: string, timeoutMs: number): Promise<string> {
  const result: any = await withTimeout(node.req.ecdh(peerXOnly), timeoutMs, 'ECDH_TIMEOUT')
  if (!result || result.ok !== true) throw new Error(result?.error || 'ecdh failed')
  return result.data as string
}

export async function handleNip44Route(req: Request, url: URL, context: RouteContext, _auth?: RequestAuth | null) {
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
  if (!context.node) return Response.json({ error: 'Node not available' }, { status: 503, headers });

  // Basic rate limit for e2e crypto ops
  const rate = checkRateLimit(req);
  if (!rate.allowed) {
    return Response.json({ error: 'Rate limit exceeded. Try again later.' }, {
      status: 429,
      headers: { ...headers, 'Retry-After': Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW || '900')).toString() }
    });
  }

  let body: Nip44Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  const { peer_pubkey, content } = body || {} as Nip44Body;
  const peer = typeof peer_pubkey === 'string' ? xOnly(peer_pubkey) : null;
  if (!peer) return Response.json({ error: 'Invalid peer_pubkey' }, { status: 400, headers });
  if (typeof content !== 'string') return Response.json({ error: 'Invalid content' }, { status: 400, headers });

  try {
    const timeoutMs = getOpTimeoutMs();
    const secretHex = await deriveSharedSecret(context.node, peer, timeoutMs);
    const mode = url.pathname.endsWith('/encrypt') ? 'encrypt' : url.pathname.endsWith('/decrypt') ? 'decrypt' : null;
    if (!mode) return Response.json({ error: 'Unknown operation' }, { status: 404, headers });

    // Platform-agnostic hex to Uint8Array conversion
    const key = new Uint8Array(secretHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
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
      return Response.json({ error: `NIP-44 ECDH timed out after ${parseInt(process.env.FROSTR_SIGN_TIMEOUT || process.env.SIGN_TIMEOUT_MS || '30000')}ms` }, { status: 504, headers });
    }
    return Response.json({ error: message }, { status: 500, headers });
  }
}
