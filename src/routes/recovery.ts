import { 
  decodeGroup, 
  decodeShare,
  recoverSecretKeyFromCredentials,
  validateGroup,
  validateShare
} from '@frostr/igloo-core';
import { RouteContext, RequestAuth } from './types.js';
import { getSecureCorsHeaders } from './utils.js';
import { authenticate, AUTH_CONFIG } from './auth.js';

export async function handleRecoveryRoute(req: Request, url: URL, context: RouteContext, _auth?: RequestAuth | null): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/recover')) return null;

  // Get secure CORS headers based on request origin
  const corsHeaders = getSecureCorsHeaders(req);
  
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store', // Prevent caching of sensitive recovery operations
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
  };

  // Allow CORS preflight without authentication
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // Check authentication - prefer passed auth, fallback to authenticate()
  // Key recovery is a sensitive operation that requires authentication
  if (AUTH_CONFIG.ENABLED) {
    // Use provided auth if available, otherwise authenticate the request
    const authToUse: RequestAuth | null = _auth !== undefined ? _auth : await authenticate(req);
    
    if (!authToUse || !authToUse.authenticated) {
      context.addServerLog('warn', `Unauthorized key recovery attempt from ${req.headers.get('x-forwarded-for') || 'unknown'}`);
      return Response.json(
        { error: 'Authentication required for key recovery operations' },
        { status: 401, headers }
      );
    }
  }

  try {
    switch (url.pathname) {
      case '/api/recover':
        if (req.method === 'POST') {
          const body = await req.json();
          const { groupCredential, shareCredentials } = body;
          
          // Validate inputs
          if (!groupCredential || !shareCredentials || !Array.isArray(shareCredentials)) {
            return Response.json({ 
              success: false, 
              error: 'Missing or invalid groupCredential or shareCredentials' 
            }, { status: 400, headers });
          }
          
          // Validate group credential
          const groupValidation = validateGroup(groupCredential);
          if (!groupValidation.isValid) {
            return Response.json({
              success: false,
              error: `Invalid group credential: ${groupValidation.message}`
            }, { status: 400, headers });
          }
          
          // Validate share credentials
          const validShares = [];
          const invalidShares = [];
          
          for (let i = 0; i < shareCredentials.length; i++) {
            const share = shareCredentials[i];
            const shareValidation = validateShare(share);
            if (shareValidation.isValid) {
              validShares.push(share);
            } else {
              invalidShares.push({ index: i, error: shareValidation.message });
            }
          }
          
          if (validShares.length === 0) {
            return Response.json({
              success: false,
              error: 'No valid share credentials provided',
              details: invalidShares
            }, { status: 400, headers });
          }
          
          try {
            // Decode group to check threshold requirements
            const decodedGroup = decodeGroup(groupCredential);
            const requiredThreshold = decodedGroup.threshold;
            
            if (validShares.length < requiredThreshold) {
              return Response.json({
                success: false,
                error: `Insufficient shares: need ${requiredThreshold}, got ${validShares.length}`,
                details: {
                  provided: validShares.length,
                  required: requiredThreshold,
                  invalidShares
                }
              }, { status: 400, headers });
            }
            
            // Perform the recovery using igloo-core
            const nsec = recoverSecretKeyFromCredentials(groupCredential, validShares);
            
            return Response.json({
              success: true,
              nsec,
              details: {
                sharesUsed: validShares.length,
                thresholdRequired: requiredThreshold,
                invalidShares: invalidShares.length > 0 ? invalidShares : undefined
              }
            }, { headers });
            
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error during recovery';
            return Response.json({
              success: false,
              error: `Recovery failed: ${errorMessage}`,
              details: {
                sharesProvided: validShares.length,
                invalidShares
              }
            }, { status: 500, headers });
          }
        }
        break;

      case '/api/recover/validate':
        if (req.method === 'POST') {
          const body = await req.json();
          const { type, credential } = body;
          
          if (!type || !credential) {
            return Response.json({ 
              success: false, 
              error: 'Missing type or credential' 
            }, { status: 400, headers });
          }
          
          try {
            let validation;
            let decodedResult = null;
            
            if (type === 'group') {
              validation = validateGroup(credential);
              if (validation.isValid) {
                try {
                  const groupDecoded = decodeGroup(credential);
                  decodedResult = {
                    threshold: groupDecoded.threshold,
                    totalShares: groupDecoded.commits?.length,
                    idx: undefined
                  };
                } catch (error) {
                  // Ignore decode errors for validation endpoint
                }
              }
            } else if (type === 'share') {
              validation = validateShare(credential);
              if (validation.isValid) {
                try {
                  const shareDecoded = decodeShare(credential);
                  decodedResult = {
                    threshold: undefined,
                    totalShares: undefined,
                    idx: shareDecoded.idx
                  };
                } catch (error) {
                  // Ignore decode errors for validation endpoint
                }
              }
            } else {
              return Response.json({
                success: false,
                error: 'Invalid type. Must be "group" or "share"'
              }, { status: 400, headers });
            }
            
            return Response.json({
              success: true,
              validation,
              decoded: decodedResult
            }, { headers });
          
          } catch (error) {
            return Response.json({
              success: false,
              error: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            }, { status: 500, headers });
          }
        }
        break;
    }
    
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  } catch (error) {
    console.error('Recovery API Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers });
  }
} 