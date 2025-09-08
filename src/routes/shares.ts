import { validateShare, validateGroup } from '@frostr/igloo-core';
import { RouteContext, RequestAuth } from './types.js';
import { getSecureCorsHeaders } from './utils.js';
import { readEnvFile, writeEnvFileWithTimestamp, getCredentialsSavedAt } from './utils.js';
import { authenticate, AUTH_CONFIG } from './auth.js';

export async function handleSharesRoute(req: Request, url: URL, context: RouteContext, _auth?: RequestAuth | null): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/shares')) return null;

  // Get secure CORS headers based on request origin
  const corsHeaders = getSecureCorsHeaders(req);
  
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
  };

  // Allow CORS preflight without authentication
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // Check authentication - prefer passed auth, fallback to authenticate()
  if (AUTH_CONFIG.ENABLED) {
    // Use provided auth if available, otherwise authenticate the request
    // Note: authenticate() always returns an AuthResult object, never null
    const authToUse = _auth ?? authenticate(req);
    
    // Explicit null check for extra safety (though authenticate never returns null)
    if (!authToUse || !authToUse.authenticated) {
      // Log failed authentication attempt for audit
      context.addServerLog('warn', `Unauthorized access attempt to shares endpoint from ${req.headers.get('x-forwarded-for') || 'unknown'}`);
      
      return Response.json(
        { error: 'Authentication required' }, 
        { status: 401, headers }
      );
    }
  }

  try {
    switch (url.pathname) {
      case '/api/shares':
        if (req.method === 'GET') {
          // Return metadata about stored shares without exposing actual credentials
          const env = await readEnvFile();
          const shares = [];
          
          // If we have both credentials in env, return metadata only
          if (env.SHARE_CRED && env.GROUP_CRED) {
            try {
              // Validate credentials before returning metadata
              const shareValidation = validateShare(env.SHARE_CRED);
              const groupValidation = validateGroup(env.GROUP_CRED);
              
              if (shareValidation.isValid && groupValidation.isValid) {
                // Get the actual save timestamp
                const savedAt = await getCredentialsSavedAt();
                
                shares.push({
                  // Security: Never expose actual credentials in GET responses
                  // Only return metadata about the shares
                  hasShareCredential: true,
                  hasGroupCredential: true,
                  isValid: true,
                  savedAt: savedAt || null, // null indicates timestamp unavailable
                  id: 'env-stored-share',
                  source: 'environment'
                });
              }
            } catch (error) {
              // Invalid credentials, skip
            }
          }
          
          return Response.json(shares, { headers });
        }
        
        if (req.method === 'POST') {
          // Save share data (for future enhancement - could store in a file or database)
          const body = await req.json();
          const { shareCredential, groupCredential } = body;
          
          if (!shareCredential || !groupCredential) {
            return Response.json({
              success: false,
              error: 'Missing shareCredential or groupCredential'
            }, { status: 400, headers });
          }
          
          // Validate credentials
          const shareValidation = validateShare(shareCredential);
          const groupValidation = validateGroup(groupCredential);
          
          if (!shareValidation.isValid || !groupValidation.isValid) {
            return Response.json({
              success: false,
              error: 'Invalid credentials provided'
            }, { status: 400, headers });
          }
          
          // For now, we'll save to the env file (in a real app, you'd use a database)
          const env = await readEnvFile();
          env.SHARE_CRED = shareCredential;
          env.GROUP_CRED = groupCredential;
          
          if (await writeEnvFileWithTimestamp(env)) {
            return Response.json({
              success: true,
              message: 'Share saved successfully'
            }, { headers });
          } else {
            return Response.json({
              success: false,
              error: 'Failed to save share'
            }, { status: 500, headers });
          }
        }
        break;
    }
    
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  } catch (error) {
    console.error('Shares API Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers });
  }
} 