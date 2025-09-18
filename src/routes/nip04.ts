import type { RouteContext, RequestAuth } from './types.js'
import { getSecureCorsHeaders, mergeVaryHeaders, getOpTimeoutMs, parseJsonRequestBody } from './utils.js'
import { checkRateLimit } from './auth.js'
import { xOnly, deriveSharedSecret } from './crypto-utils.js'
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

type Nip04Body = {
  peer_pubkey: string // x-only hex (32 bytes) or compressed (02/03 + x)
  content: string     // plaintext (encrypt) or ciphertext?iv= (decrypt)
}

function nip04Encrypt(plaintext: string, sharedSecretHex: string): string {
  const key = createHash('sha256').update(Buffer.from(sharedSecretHex, 'hex')).digest() // 32 bytes
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]).toString('base64')
  return `${enc}?iv=${iv.toString('base64')}`
}

function nip04Decrypt(ciphertextWithIv: string, sharedSecretHex: string): string {
  const match = ciphertextWithIv.match(/^(.*)\?iv=([^&]+)$/)
  if (!match) throw new Error('Invalid NIP-04 ciphertext format')
  const [, ctb64, ivb64] = match
  const key = createHash('sha256').update(Buffer.from(sharedSecretHex, 'hex')).digest()
  const iv = Buffer.from(ivb64, 'base64')
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  const dec = Buffer.concat([decipher.update(Buffer.from(ctb64, 'base64')), decipher.final()]).toString('utf8')
  return dec
}

export async function handleNip04Route(req: Request, url: URL, context: RouteContext, _auth?: RequestAuth | null) {
  if (!url.pathname.startsWith('/api/nip04/')) return null

  const corsHeaders = getSecureCorsHeaders(req)
  const mergedVary = mergeVaryHeaders(corsHeaders)
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
    'Vary': mergedVary,
  }

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers })
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers })
  if (!context.node) return Response.json({ error: 'Node not available' }, { status: 503, headers })

  // Separate bucket for e2e crypto ops
  const rate = await checkRateLimit(req, 'crypto');
  if (!rate.allowed) {
    return Response.json({ error: 'Rate limit exceeded. Try again later.' }, {
      status: 429,
      headers: { ...headers, 'Retry-After': Math.ceil(parseInt(process.env.RATE_LIMIT_WINDOW || '900')).toString() }
    })
  }

  let body: Nip04Body
  try {
    body = await parseJsonRequestBody(req)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid request body' },
      { status: 400, headers }
    )
  }
  const peer = typeof body?.peer_pubkey === 'string' ? xOnly(body.peer_pubkey) : null
  if (!peer) return Response.json({ error: 'Invalid peer_pubkey' }, { status: 400, headers })
  if (typeof body?.content !== 'string') return Response.json({ error: 'Invalid content' }, { status: 400, headers })

  const timeoutMs = getOpTimeoutMs()
  try {
    const secretHex = await deriveSharedSecret(context.node, peer, timeoutMs)
    const mode = url.pathname.endsWith('/encrypt') ? 'encrypt' : url.pathname.endsWith('/decrypt') ? 'decrypt' : null
    if (!mode) return Response.json({ error: 'Unknown operation' }, { status: 404, headers })

    if (mode === 'encrypt') {
      const result = nip04Encrypt(body.content, secretHex)
      return Response.json({ result }, { status: 200, headers })
    } else {
      const result = nip04Decrypt(body.content, secretHex)
      return Response.json({ result }, { status: 200, headers })
    }
  } catch (e: any) {
    // Check for timeout: handle both string rejection and Error.message
    if (e === 'ECDH_TIMEOUT' || e?.message === 'ECDH_TIMEOUT') {
      try { context.addServerLog('warning', 'NIP-04 ECDH timeout', { peer: (body as any)?.peer_pubkey }) } catch {}
      return Response.json({ error: `NIP-04 ECDH timed out after ${timeoutMs}ms` }, { status: 504, headers })
    }

    // For other errors, extract message
    const message = typeof e === 'string' ? e : (e?.message || 'NIP-04 operation failed')
    return Response.json({ error: message }, { status: 500, headers })
  }
}
