import { validateShare, validateGroup } from '@frostr/igloo-core';
import { RouteContext } from './types.js';
import { readEnvFile, writeEnvFileWithTimestamp, getCredentialsSavedAt } from './utils.js';

export async function handleSharesRoute(req: Request, url: URL, context: RouteContext): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/shares')) return null;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    switch (url.pathname) {
      case '/api/shares':
        if (req.method === 'GET') {
          // Return stored shares (for now, we'll use the current env credentials as an example)
          const env = await readEnvFile();
          const shares = [];
          
          // If we have both credentials in env, return them as a share
          if (env.SHARE_CRED && env.GROUP_CRED) {
            try {
              // Validate credentials before returning
              const shareValidation = validateShare(env.SHARE_CRED);
              const groupValidation = validateGroup(env.GROUP_CRED);
              
              if (shareValidation.isValid && groupValidation.isValid) {
                // Get the actual save timestamp
                const savedAt = await getCredentialsSavedAt();
                
                shares.push({
                  shareCredential: env.SHARE_CRED,
                  groupCredential: env.GROUP_CRED,
                  savedAt: savedAt || new Date().toISOString(), // Fallback to current time if no timestamp found
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