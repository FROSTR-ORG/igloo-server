import type { RouteContext, RequestAuth, ServerBifrostNode } from './types.js';
import { getSecureCorsHeaders, mergeVaryHeaders, getOpTimeoutMs } from './utils.js';
import { checkRateLimit } from './auth.js';
import { getEventHash, type EventTemplate, type UnsignedEvent } from 'nostr-tools';

type SignRequestBody = {
  message?: string; // 32-byte hex event id
  event?: Partial<EventTemplate> & {
    kind: number;
    created_at: number;
    content: string;
    tags: any[];
    pubkey?: string; // Optional pubkey for event hashing
  };
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
      // Validate required pubkey for event hashing
      const pk = typeof body.event.pubkey === 'string' ? body.event.pubkey.trim() : ''
      if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
        return { error: 'Invalid event: 64-hex pubkey required' };
      }

      // Validate kind (must be non-negative integer)
      const kind = Number(body.event.kind);
      if (!Number.isInteger(kind) || kind < 0) {
        return { error: 'Invalid event: kind must be a non-negative integer' };
      }

      // Validate created_at (must be positive integer timestamp)
      const created_at = Number(body.event.created_at);
      if (!Number.isInteger(created_at) || created_at <= 0) {
        return { error: 'Invalid event: created_at must be a positive integer timestamp' };
      }

      // Validate tags structure (array of arrays of strings)
      if (!Array.isArray(body.event.tags)) {
        return { error: 'Invalid event: tags must be an array' };
      }

      const validatedTags: string[][] = [];
      for (const tag of body.event.tags) {
        if (!Array.isArray(tag)) {
          return { error: 'Invalid event: each tag must be an array' };
        }
        const validatedTag: string[] = [];
        for (const element of tag) {
          if (typeof element !== 'string') {
            return { error: 'Invalid event: tag elements must be strings' };
          }
          validatedTag.push(element);
        }
        validatedTags.push(validatedTag);
      }

      const template: UnsignedEvent = {
        pubkey: pk.toLowerCase(),
        kind,
        created_at,
        content: body.event.content ?? '',
        tags: validatedTags,
      };
      const id = getEventHash(template);
      return { id };
    } catch (e) {
      return { error: 'Invalid event: could not compute id' };
    }
  }

  return { error: 'Request must include `message` or `event`' };
}

function applySignRequestTimeout(
  node: ServerBifrostNode,
  timeoutMs: number,
  addServerLog?: RouteContext['addServerLog']
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;

  const log = typeof addServerLog === 'function' ? addServerLog : undefined;

  const updateClientTimeout = (client: any) => {
    if (!client || typeof client !== 'object') return;
    const config = client.config ?? client._config;
    if (!config || typeof config !== 'object') return;
    const current = config.req_timeout;
    if (typeof current === 'number' && current === timeoutMs) return;
    config.req_timeout = timeoutMs;
    if (log) {
      try {
        log('debug', 'Applied signing request timeout to node client', { timeoutMs });
      } catch {}
    }
  };

  try {
    const client = (node as any).client ?? (node as any)._client;
    updateClientTimeout(client);
  } catch (error) {
    if (log) {
      try {
        log('debug', 'Failed to apply signing request timeout', {
          timeoutMs,
          error: error instanceof Error ? error.message : String(error)
        });
      } catch {}
    }
  }
}

function normalizeErrorReason(reason: unknown): string {
  if (typeof reason === 'string' && reason.trim().length > 0) return reason;
  if (reason && typeof reason === 'object' && 'message' in reason) {
    const message = (reason as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return String(reason ?? 'unknown error');
}

function isTimeoutReason(reason: string): boolean {
  const value = reason.toLowerCase();
  return value.includes('timeout');
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
    ...(context.requestId ? { 'X-Request-ID': context.requestId } : {}),
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });

  // Defense-in-depth: Validate authentication even though router already enforces it
  if (!_auth || !_auth.authenticated) {
    return Response.json({ code: 'AUTH_REQUIRED', error: 'Authentication required' }, { status: 401, headers });
  }

  if (!context.node) {
    return Response.json({ code: 'NODE_UNAVAILABLE', error: 'Node not available' }, { status: 503, headers });
  }

  // Basic rate limit to protect signing endpoint
  // Use a separate bucket so signing traffic doesn't compete with auth/login
  const rate = await checkRateLimit(req, 'sign');
  if (!rate.allowed) {
    return Response.json({ code: 'RATE_LIMITED', error: 'Rate limit exceeded. Try again later.' }, {
      status: 429,
      headers: { ...headers, 'Retry-After': Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW || '900')).toString() }
    });
  }

  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 1024 * 100) { // 100KB limit
    return Response.json({ code: 'REQUEST_TOO_LARGE', error: 'Request too large' }, { status: 413, headers });
  }

  let body: SignRequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ code: 'INVALID_JSON', error: 'Invalid JSON' }, { status: 400, headers });
  }

  const result = computeEventId(body);
  if ('error' in result) return Response.json({ code: 'BAD_REQUEST', error: result.error }, { status: 400, headers });
  const { id } = result;

  try {
    // Bifrost sign request returns { ok, data: SignatureEntry[] }
    const timeoutMs = getOpTimeoutMs();
    applySignRequestTimeout(context.node!, timeoutMs, context.addServerLog);

    let signResult;
    try {
      signResult = await context.node!.req.sign(id);
    } catch (error) {
      const reason = normalizeErrorReason(error);
      if (isTimeoutReason(reason)) {
        try { context.addServerLog('warning', 'Signing operation timed out', { id, timeoutMs, source: 'bifrost' }); } catch {}
        return Response.json({ code: 'SIGN_TIMEOUT', error: `Signing timed out after ${timeoutMs}ms` }, { status: 504, headers: { ...headers, 'Retry-After': Math.ceil(timeoutMs / 1000).toString() } });
      }
      try { context.addServerLog('error', 'Signing operation failed', { id, reason }); } catch {}
      return Response.json({ code: 'SIGN_FAILED', error: reason }, { status: 502, headers });
    }

    if (!signResult || signResult.ok !== true) {
      const rawReason = signResult && (signResult.err ?? (signResult as any).error);
      const reason = normalizeErrorReason(rawReason ?? 'signing failed');
      if (isTimeoutReason(reason)) {
        try { context.addServerLog('warning', 'Signing operation timed out', { id, timeoutMs, source: 'response' }); } catch {}
        return Response.json({ code: 'SIGN_TIMEOUT', error: `Signing timed out after ${timeoutMs}ms` }, { status: 504, headers: { ...headers, 'Retry-After': Math.ceil(timeoutMs / 1000).toString() } });
      }
      try { context.addServerLog('error', 'Signing operation failed', { id, reason }); } catch {}
      return Response.json({ code: 'SIGN_FAILED', error: reason }, { status: 502, headers });
    }

    // Expect an array like: [[sighash, pubkey, signature]]
    let signatureHex: string | null = null;
    try {
      if (Array.isArray(signResult.data)) {
        const entry = signResult.data.find((e) => Array.isArray(e) && e[0] === id) || signResult.data[0];
        signatureHex = Array.isArray(entry) ? entry[2] : null;
      }
    } catch (error) {
      try {
        context.addServerLog('error', 'Error extracting signature', {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        try { console.error('Error extracting signature:', error); } catch {}
      }
    }

    if (!signatureHex || typeof signatureHex !== 'string') {
      return Response.json({ code: 'INVALID_NODE_RESPONSE', error: 'invalid signature response from node' }, { status: 502, headers });
    }

    return Response.json({ id, signature: signatureHex }, { status: 200, headers });
  } catch (e: any) {
    const message = normalizeErrorReason(e);
    if (isTimeoutReason(message)) {
      const timeoutMs = getOpTimeoutMs();
      try { context.addServerLog('warning', `FROSTR signing timeout`, { id, timeoutMs, source: 'unexpected' }); } catch {}
      return Response.json({ code: 'SIGN_TIMEOUT', error: `Signing timed out after ${timeoutMs}ms` }, { status: 504, headers });
    }
    return Response.json({ code: 'SIGN_ERROR', error: message }, { status: 500, headers });
  }
}
