/**
 * NIP-44 Encryption/Decryption Routes for FROSTR
 * 
 * These routes provide NIP-44 encryption and decryption capabilities using FROSTR's
 * threshold ECDH (Elliptic Curve Diffie-Hellman) implementation. This allows the
 * NIP-46 remote signer to encrypt and decrypt messages for Nostr DMs and other
 * encrypted content.
 * 
 * Routes:
 * - POST /api/nip44/encrypt: Encrypt content for a peer using FROSTR ECDH
 * - POST /api/nip44/decrypt: Decrypt content from a peer using FROSTR ECDH
 * 
 * The ECDH operations are performed by the Bifrost node using threshold cryptography,
 * requiring participation from multiple FROSTR shares to derive the shared secret.
 */

import { RouteContext } from './types.js';
import { getSecureCorsHeaders } from './utils.js';
import * as nip44 from 'nostr-tools/nip44';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
export async function handleNip44Route(req: Request, url: URL, context: RouteContext): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/nip44/')) return null;

  const corsHeaders = getSecureCorsHeaders(req);
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  // Check if node is available
  if (!context.node) {
    return Response.json({ 
      error: 'Bifrost node not initialized. Please configure credentials.' 
    }, { status: 503, headers });
  }

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const { peer_pubkey, content } = body;

      if (!peer_pubkey) {
        return Response.json({ error: 'Missing peer_pubkey' }, { status: 400, headers });
      }
      if (!content) {
        return Response.json({ error: 'Missing content' }, { status: 400, headers });
      }

      // Get ECDH shared secret from FROSTR network
      context.addServerLog('nip44', `ECDH request for peer: ${peer_pubkey.slice(0, 8)}...`);
      
      // Use the Bifrost node's ECDH method with increased timeout
      const ECDH_TIMEOUT = parseInt(process.env.FROSTR_SIGN_TIMEOUT || '30000'); // Use same timeout as signing
      
      const ecdhResponse = await Promise.race([
        context.node.req.ecdh(peer_pubkey),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('FROSTR ECDH timeout - operation took longer than ' + ECDH_TIMEOUT / 1000 + ' seconds')), ECDH_TIMEOUT)
        )
      ]);
      
      if (!ecdhResponse.ok) {
        const errorMsg = ecdhResponse.err || 'Unknown error';
        context.addServerLog('error', `FROSTR ECDH failed: ${errorMsg}`);
        
        if (errorMsg === 'timeout') {
          throw new Error('FROSTR ECDH timeout - other network members not responding. Ensure peers are online.');
        } else {
          throw new Error(`FROSTR ECDH failed: ${errorMsg}`);
        }
      }

      // The ECDH response is the shared secret in hex format
      const sharedSecret = ecdhResponse.data;
      if (!sharedSecret) {
        throw new Error('No shared secret returned from FROSTR network');
      }

      // Convert shared secret to conversation key format for NIP-44
      // The shared secret from FROSTR is already the x-coordinate of the ECDH point
      const conversationKey = hexToBytes(sharedSecret);

      // Handle encryption or decryption based on the endpoint
      let result: string;
      if (url.pathname === '/api/nip44/encrypt') {
        // Encrypt the content using NIP-44
        result = nip44.encrypt(content, conversationKey);
        context.addServerLog('nip44', `Content encrypted successfully`);
      } else if (url.pathname === '/api/nip44/decrypt') {
        // Decrypt the content using NIP-44
        result = nip44.decrypt(content, conversationKey);
        context.addServerLog('nip44', `Content decrypted successfully`);
      } else {
        return Response.json({ error: 'Invalid endpoint' }, { status: 404, headers });
      }

      return Response.json({ result }, { headers });
      
    } catch (error) {
      context.addServerLog('error', 'NIP-44 operation failed', error);
      return Response.json({ 
        error: error instanceof Error ? error.message : 'NIP-44 operation failed' 
      }, { status: 500, headers });
    }
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
}