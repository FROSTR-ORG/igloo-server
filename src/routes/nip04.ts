import type { RouteContext, RequestAuth } from './types.js'
import { getSecureCorsHeaders, mergeVaryHeaders, getOpTimeoutMs, parseJsonRequestBody, isContentLengthWithin, DEFAULT_MAX_JSON_BODY } from './utils.js'
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
  const iv = decodeBase64Strict(ivb64, 'IV')
  if (iv.length !== 16) {
    throw new Error('IV must be 16 bytes')
  }

  const ciphertext = decodeBase64Strict(ctb64, 'ciphertext')
  if (ciphertext.length === 0) {
    throw new Error('Ciphertext must not be empty')
  }

  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  try {
    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return dec
  } catch (error) {
    throw new Error('Decryption failed')
  }
}

function decodeBase64Strict(value: string, label: string): Buffer {
  const normalized = value.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`Invalid base64 ${label}`)
  }

  const buf = Buffer.from(normalized, 'base64')
  if (buf.length === 0 && normalized.length > 0) {
    throw new Error(`Invalid base64 ${label}`)
  }

  const reencoded = buf.toString('base64').replace(/=+$/, '')
  const normalizedInput = normalized.replace(/=+$/, '')
  if (reencoded !== normalizedInput) {
    throw new Error(`Invalid base64 ${label}`)
  }

  return buf
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
  if (!isContentLengthWithin(req, DEFAULT_MAX_JSON_BODY)) {
    return Response.json({ error: 'Request too large' }, { status: 413, headers })
  }
  if (!context.node) return Response.json({ error: 'Node not available' }, { status: 503, headers })

  // Separate bucket for e2e crypto ops
  const rate = await checkRateLimit(req, 'crypto', { clientIp: context.clientIp });
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
