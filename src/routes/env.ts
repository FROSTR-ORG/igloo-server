import { PrivilegedRouteContext, RequestAuth } from './types.js';
import {
  readEnvFile,
  readPublicEnvFile,
  writeEnvFile,
  writeEnvFileWithTimestamp,
  validateEnvKeys,
  getSecureCorsHeaders,
  mergeVaryHeaders,
  parseJsonRequestBody,
  getCredentialsSavedAt
} from './utils.js';
import { hasCredentials, HEADLESS } from '../const.js';
import { createNodeWithCredentials } from '../node/manager.js';
import { executeUnderNodeLock, cleanupNodeSynchronized } from '../utils/node-lock.js';
import { validateShare, validateGroup } from '@frostr/igloo-core';
import { AUTH_CONFIG } from './auth.js';
import { validateAdminSecret } from './onboarding.js';
import { getUserCredentials } from '../db/database.js';

// Helper function to validate relay URLs
function validateRelayUrls(relays: any): { valid: boolean; urls?: string[]; error?: string } {
  if (!relays) {
    return { valid: true, urls: undefined };
  }

  // Parse relays if they're a string
  let parsedRelays: string[];
  if (typeof relays === 'string') {
    try {
      parsedRelays = JSON.parse(relays);
    } catch {
      // If not valid JSON, try splitting by comma
      parsedRelays = relays.split(',').map((r: string) => r.trim());
    }
  } else if (Array.isArray(relays)) {
    parsedRelays = relays;
  } else {
    return { valid: false, error: 'Relays must be a string or array' };
  }

  // Validate each relay URL
  for (const relay of parsedRelays) {
    if (typeof relay !== 'string') {
      return { valid: false, error: 'Each relay must be a string' };
    }
    
    try {
      const url = new URL(relay);
      // Relays should be WebSocket URLs
      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        return { valid: false, error: `Invalid relay protocol: ${url.protocol}. Must be ws:// or wss://` };
      }
    } catch {
      return { valid: false, error: `Invalid relay URL: ${relay}` };
    }
  }

  return { valid: true, urls: parsedRelays };
}

// Wrapper function to use shared node creation with env variables
async function createAndConnectServerNode(env: any, context: PrivilegedRouteContext): Promise<void> {
  // Validate and parse relays
  const relayValidation = validateRelayUrls(env.RELAYS);
  if (!relayValidation.valid) {
    throw new Error(relayValidation.error);
  }

  const relayString = Array.isArray(env.RELAYS)
    ? env.RELAYS.join(',')
    : typeof env.RELAYS === 'string'
      ? env.RELAYS
      : undefined;

  const peerPoliciesRaw = typeof env.PEER_POLICIES === 'string' ? env.PEER_POLICIES : undefined;

  const node = await createNodeWithCredentials(
    env.GROUP_CRED,
    env.SHARE_CRED,
    relayString,
    context.addServerLog,
    peerPoliciesRaw
  );

  if (!node) {
    throw new Error('Failed to create node with provided credentials');
  }

  context.updateNode(node, {
    credentials: {
      group: env.GROUP_CRED,
      share: env.SHARE_CRED,
      relaysEnv: relayString,
      peerPoliciesRaw,
      source: 'env'
    }
  });
}

export async function handleEnvRoute(req: Request, url: URL, context: PrivilegedRouteContext, auth?: RequestAuth | null): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/env')) return null;
  
  const corsHeaders = getSecureCorsHeaders(req);
  
  const mergedVary = mergeVaryHeaders(corsHeaders);
  
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Vary': mergedVary,
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  const isWrite = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE';

  if ((AUTH_CONFIG.ENABLED || !HEADLESS) && isWrite) {
    if (!auth || typeof auth !== 'object' || !auth.authenticated) {
      return Response.json(
        { error: 'Authentication required for environment modifications' },
        { status: 401, headers }
      );
    }
  }

  try {
    switch (url.pathname) {
      case '/api/env':
        if (req.method === 'GET') {
          if (HEADLESS) {
            const publicEnv = await readPublicEnvFile();
            return Response.json(publicEnv, { headers });
          }

          if (!auth || !auth.authenticated) {
            return Response.json({ error: 'Authentication required' }, { status: 401, headers });
          }

          const validUserId = (typeof auth.userId === 'number' && auth.userId > 0) ||
            (typeof auth.userId === 'string' && /^\d+$/.test(auth.userId) && BigInt(auth.userId) > 0n);
          if (!validUserId) {
            return Response.json({ error: 'Invalid user authentication' }, { status: 401, headers });
          }

          let secret: string | Uint8Array | null = null;
          let isDerivedKey = false;
          const password = auth.getPassword?.();
          if (password) {
            secret = password;
          } else {
            const derivedKey = auth.getDerivedKey?.();
            if (derivedKey) {
              secret = derivedKey;
              isDerivedKey = true;
            }
          }

          if (!secret) {
            return Response.json({}, { headers });
          }

          try {
            const dbUserId = typeof auth.userId === 'string' ? BigInt(auth.userId!) : auth.userId!;
            const credentials = await getUserCredentials(dbUserId, secret, isDerivedKey);
            if (!credentials) {
              return Response.json({}, { headers });
            }

            return Response.json({
              GROUP_CRED: undefined,
              SHARE_CRED: undefined,
              GROUP_NAME: credentials.group_name || undefined,
              RELAYS: credentials.relays || undefined,
              hasCredentials: !!(credentials.group_cred && credentials.share_cred)
            }, { headers });
          } catch (error) {
            console.error('Failed to retrieve user credentials for env:', error);
            return Response.json({}, { headers });
          }
        }
        
        if (req.method === 'POST') {
          if (!HEADLESS) {
            let body;
            try {
              body = await parseJsonRequestBody(req);
            } catch (error) {
              return Response.json(
                { error: error instanceof Error ? error.message : 'Invalid request body' },
                { status: 400, headers }
              );
            }

            const env = await readEnvFile();
            const { validKeys, invalidKeys: rejectedKeys } = validateEnvKeys(Object.keys(body));

            if (validKeys.includes('RELAYS') && body.RELAYS !== undefined) {
              const relayValidation = validateRelayUrls(body.RELAYS);
              if (!relayValidation.valid) {
                return Response.json({ success: false, error: relayValidation.error }, { status: 400, headers });
              }
            }

            const adminSecret = req.headers.get('X-Admin-Secret') ?? req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
            const isAdminSecret = await validateAdminSecret(adminSecret);
            const firstUser = auth && auth.authenticated && ((typeof auth.userId === 'number' && auth.userId === 1) || (typeof auth.userId === 'string' && auth.userId === '1'));
            if (!isAdminSecret && !firstUser) {
              return Response.json(
                { error: 'Admin privileges required for environment modifications' },
                { status: 403, headers }
              );
            }

            for (const key of validKeys) {
              if (body[key] !== undefined) {
                env[key] = body[key];
              }
            }

            if (await writeEnvFile(env)) {
              try {
                if (validKeys.includes('FROSTR_SIGN_TIMEOUT') && typeof env.FROSTR_SIGN_TIMEOUT === 'string') {
                  process.env.FROSTR_SIGN_TIMEOUT = env.FROSTR_SIGN_TIMEOUT;
                }
                if (validKeys.includes('ALLOWED_ORIGINS') && typeof env.ALLOWED_ORIGINS === 'string') {
                  process.env.ALLOWED_ORIGINS = env.ALLOWED_ORIGINS;
                }
              } catch {}

              const responseMessage = rejectedKeys.length > 0
                ? `Environment variables updated. Rejected unauthorized keys: ${rejectedKeys.join(', ')}`
                : 'Environment variables updated';

              return Response.json({ success: true, message: responseMessage, rejectedKeys: rejectedKeys.length > 0 ? rejectedKeys : undefined }, { headers });
            }

            return Response.json({ success: false, message: 'Failed to update .env file' }, { status: 500, headers });
          }

          if (AUTH_CONFIG.ENABLED && (!auth || !auth.authenticated)) {
            return Response.json(
              { error: 'Authentication required for environment modifications' },
              { status: 401, headers }
            );
          }

          let body;
          try {
            body = await parseJsonRequestBody(req);
          } catch (error) {
            return Response.json(
              { error: error instanceof Error ? error.message : 'Invalid request body' },
              { status: 400, headers }
            );
          }

          const env = await readEnvFile();
          const { validKeys, invalidKeys: rejectedKeys } = validateEnvKeys(Object.keys(body));

          if (validKeys.includes('RELAYS') && body.RELAYS !== undefined) {
            const relayValidation = validateRelayUrls(body.RELAYS);
            if (!relayValidation.valid) {
              return Response.json({ success: false, error: relayValidation.error }, { status: 400, headers });
            }
          }

          const updatingCredentials = validKeys.some(key => ['GROUP_CRED', 'SHARE_CRED'].includes(key));
          const updatingRelays = validKeys.includes('RELAYS');

          for (const key of validKeys) {
            if (body[key] !== undefined) {
              env[key] = body[key];
            }
          }

          if (await writeEnvFile(env)) {
            try {
              if (validKeys.includes('FROSTR_SIGN_TIMEOUT') && typeof env.FROSTR_SIGN_TIMEOUT === 'string') {
                process.env.FROSTR_SIGN_TIMEOUT = env.FROSTR_SIGN_TIMEOUT;
              }
              if (validKeys.includes('ALLOWED_ORIGINS') && typeof env.ALLOWED_ORIGINS === 'string') {
                process.env.ALLOWED_ORIGINS = env.ALLOWED_ORIGINS;
              }
            } catch {}

            if (updatingCredentials || updatingRelays) {
              try {
                await executeUnderNodeLock(async () => {
                  await createAndConnectServerNode(env, context);
                }, context);
              } catch (error) {
                context.addServerLog('error', 'Error recreating Bifrost node', error);
                throw (error instanceof Error) ? error : new Error(String(error));
              }
            }

            const responseMessage = rejectedKeys.length > 0
              ? `Environment variables updated. Rejected unauthorized keys: ${rejectedKeys.join(', ')}`
              : 'Environment variables updated';

            return Response.json({ success: true, message: responseMessage, rejectedKeys: rejectedKeys.length > 0 ? rejectedKeys : undefined }, { headers });
          }

          return Response.json({ success: false, message: 'Failed to update .env file' }, { status: 500, headers });
        }
        break;

      case '/api/env/shares':
        if (!HEADLESS) {
          return Response.json({ error: 'Not found' }, { status: 404, headers });
        }

        if (req.method === 'GET') {
          const shares: Array<Record<string, unknown>> = [];
          if (hasCredentials()) {
            const savedAt = await getCredentialsSavedAt();
            const env = await readEnvFile();
            const hasShareCredential = !!env.SHARE_CRED;
            const hasGroupCredential = !!env.GROUP_CRED;
            const includeSecrets = AUTH_CONFIG.ENABLED ? !!auth?.authenticated : true;

            const shareCredential = includeSecrets && hasShareCredential ? env.SHARE_CRED! : undefined;
            const groupCredential = includeSecrets && hasGroupCredential ? env.GROUP_CRED! : undefined;
            const isValid = hasShareCredential && hasGroupCredential;

            shares.push({
              hasShareCredential,
              hasGroupCredential,
              ...(shareCredential ? { shareCredential } : {}),
              ...(groupCredential ? { groupCredential } : {}),
              isValid,
              savedAt: savedAt || null,
              id: 'env-stored-share',
              source: 'environment'
            });
          }
          return Response.json(shares, { headers });
        }

        if (req.method === 'POST') {
          if (AUTH_CONFIG.ENABLED && (!auth || !auth.authenticated)) {
            return Response.json(
              { error: 'Authentication required for environment modifications' },
              { status: 401, headers }
            );
          }
          let body;
          try {
            body = await parseJsonRequestBody(req);
          } catch (error) {
              return Response.json(
              { error: error instanceof Error ? error.message : 'Invalid request body' },
              { status: 400, headers }
            );
          }

          const { shareCredential, groupCredential } = body ?? {};
          if (!shareCredential || !groupCredential) {
            return Response.json(
              { success: false, error: 'Missing shareCredential or groupCredential' },
              { status: 400, headers }
            );
          }

          const shareValidation = validateShare(shareCredential);
          const groupValidation = validateGroup(groupCredential);

          if (!shareValidation.isValid || !groupValidation.isValid) {
            return Response.json(
              { success: false, error: 'Invalid credentials provided' },
              { status: 400, headers }
            );
          }

          const env = await readEnvFile();
          env.SHARE_CRED = shareCredential;
          env.GROUP_CRED = groupCredential;

          if (await writeEnvFileWithTimestamp(env)) {
            try {
              await executeUnderNodeLock(async () => {
                await createAndConnectServerNode(env, context);
              }, context);
            } catch (error) {
              console.error('Failed to restart node with updated shares:', error);
              return Response.json(
                { success: false, error: 'Failed to apply credentials to node' },
                { status: 500, headers }
              );
            }

            return Response.json(
              { success: true, message: 'Share saved successfully' },
              { headers }
            );
          }

          return Response.json(
            { success: false, error: 'Failed to save share' },
            { status: 500, headers }
          );
        }
        break;

      case '/api/env/delete':
        if (req.method === 'POST') {
          if (HEADLESS && AUTH_CONFIG.ENABLED && (!auth || !auth.authenticated)) {
            return Response.json(
              { error: 'Authentication required for environment modifications' },
              { status: 401, headers }
            );
          }
          if (!HEADLESS) {
            const adminSecret = req.headers.get('X-Admin-Secret') ??
              req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');

            const isAdmin = await validateAdminSecret(adminSecret);
            if (!isAdmin) {
              const validUserId = auth && ((typeof auth.userId === 'number' && auth.userId === 1) ||
                (typeof auth.userId === 'string' && auth.userId === '1'));
              if (!validUserId) {
                return Response.json(
                  { error: 'Admin privileges required for deleting environment variables' },
                  { status: 403, headers }
                );
              }
            }
          }

          let body;
          try {
            body = await parseJsonRequestBody(req);
          } catch (error) {
            return Response.json(
              { error: error instanceof Error ? error.message : 'Invalid request body' },
              { status: 400, headers }
            );
          }
          
          const { keys } = body;
          
          if (!Array.isArray(keys) || keys.length === 0) {
            return Response.json({ error: 'Keys array is required' }, { status: 400, headers });
          }
          
          const env = await readEnvFile();
          
          // Validate which keys are allowed to be deleted
          const { validKeys, invalidKeys } = validateEnvKeys(keys);
          
          // Check if we're deleting credentials
          const deletingCredentials = validKeys.some(key => ['GROUP_CRED', 'SHARE_CRED'].includes(key));
          
          // Delete only allowed keys
          for (const key of validKeys) {
            delete env[key];
          }
          
          if (await writeEnvFile(env)) {
            // If credentials were deleted, clean up the node
            if (deletingCredentials) {
              try {
                // Use synchronized cleanup to prevent race conditions
                await cleanupNodeSynchronized(context);
              } catch (error) {
                // Error already logged by executeUnderNodeLock
                // Continue anyway - the env vars were deleted
              }
            }
            
            const responseMessage = invalidKeys.length > 0 
              ? `Environment variables deleted. Rejected unauthorized keys: ${invalidKeys.join(', ')}`
              : 'Environment variables deleted';
            
            return Response.json({ 
              success: true, 
              message: responseMessage,
              deletedKeys: validKeys,
              rejectedKeys: invalidKeys.length > 0 ? invalidKeys : undefined
            }, { headers });
          } else {
            return Response.json({ success: false, message: 'Failed to update .env file' }, { status: 500, headers });
          }
        }
        break;
    }
    
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  } catch (error) {
    console.error('API Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers });
  }
} 
