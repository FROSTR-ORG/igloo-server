/**
 * FROSTR Signing Route for NIP-46 Remote Signer
 * 
 * This route provides a simple interface for signing messages using FROSTR threshold signatures.
 * It's primarily used by the NIP-46 implementation to sign Nostr events on behalf of clients.
 * 
 * POST /api/sign
 * Body: { message: string } - The message (typically event ID) to sign
 * Returns: { signature: string } - The FROSTR threshold signature
 * 
 * The signing operation:
 * 1. Receives a message (usually a Nostr event ID hash)
 * 2. Delegates to the Bifrost node for threshold signing
 * 3. Requires participation from threshold number of FROSTR shares
 * 4. Returns the aggregated signature that validates against the group public key
 */

import { RouteContext } from './types.js';
import { getSecureCorsHeaders } from './utils.js';
export async function handleSignRoute(req: Request, url: URL, context: RouteContext): Promise<Response | null> {
  if (url.pathname !== '/api/sign') return null;

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

  if (req.method === 'POST') {
    try {
      // Check if node is available
      if (!context.node) {
        return Response.json({ 
          error: 'Bifrost node not initialized. Please configure credentials.' 
        }, { status: 503, headers });
      }

      const body = await req.json();
      const { message } = body;

      if (!message) {
        return Response.json({ error: 'Missing message to sign' }, { status: 400, headers });
      }

      context.addServerLog('sign', `Signature request for message: ${message.slice(0, 8)}...`);
      
      // Use the existing Bifrost node's sign method
      // This handles all the FROSTR threshold signature complexity
      const response = await context.node.req.sign(message);
      
      if (!response.ok) {
        const errorMsg = response.err || 'Unknown error';
        context.addServerLog('error', `FROSTR signing failed: ${errorMsg}`);
        
        if (errorMsg === 'timeout') {
          throw new Error('FROSTR signing timeout - other network members not responding. Ensure peers are online and reachable.');
        } else {
          throw new Error(`FROSTR signing failed: ${errorMsg}`);
        }
      }

      // Extract the signature from the response
      const signatures = response.data;
      if (!signatures || signatures.length === 0) {
        throw new Error('No signature returned from FROSTR network');
      }

      // Get the signature for our message (SignatureEntry is a tuple: [sighash, pubkey, signature])
      const signature = signatures[0][2];
      
      context.addServerLog('sign', `Signature completed successfully`);
      
      return Response.json({ signature }, { headers });
      
    } catch (error) {
      context.addServerLog('error', 'Failed to sign message', error);
      return Response.json({ 
        error: error instanceof Error ? error.message : 'Failed to sign message' 
      }, { status: 500, headers });
    }
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
}