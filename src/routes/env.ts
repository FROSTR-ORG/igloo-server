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
  getCredentialsSavedAt,
  isContentLengthWithin,
  DEFAULT_MAX_JSON_BODY
} from './utils.js';
import { hasCredentials, HEADLESS } from '../const.js';
import { createNodeWithCredentials } from '../node/manager.js';
import { executeUnderNodeLock, cleanupNodeSynchronized } from '../utils/node-lock.js';
import { validateShare, validateGroup } from '@frostr/igloo-core';
import { AUTH_CONFIG, checkRateLimit } from './auth.js';
import { validateAdminSecret } from './onboarding.js';
import { getUserCredentials } from '../db/database.js';
import { timingSafeEqual } from 'crypto';

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

  // Headless hardening helpers
  const extractApiKeyFromHeaders = (r: Request): string | null => {
    const headerKey = r.headers.get('x-api-key');
    if (headerKey && headerKey.trim().length > 0) return headerKey.trim();
    const authz = r.headers.get('authorization');
    if (authz && authz.startsWith('Bearer ')) {
      const token = authz.substring(7).trim();
      if (token.length > 0) return token;
    }
    return null;
  };

  const hasValidHeadlessApiKey = (r: Request): boolean => {
    if (!AUTH_CONFIG.API_KEY) return false;
    const provided = extractApiKeyFromHeaders(r);
    if (!provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(AUTH_CONFIG.API_KEY);
    if (a.length !== b.length) return false;
    try { return timingSafeEqual(a, b); } catch { return false; }
  };

  const hasValidHeadlessBasic = (r: Request): boolean => {
    if (!AUTH_CONFIG.BASIC_AUTH_USER || !AUTH_CONFIG.BASIC_AUTH_PASS) return false;
    const authz = r.headers.get('authorization');
    if (!authz || !authz.startsWith('Basic ')) return false;
    try {
      const decoded = atob(authz.slice(6));
      const idx = decoded.indexOf(':');
      const user = idx >= 0 ? decoded.slice(0, idx) : '';
      const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
      const uok = timingSafeEqual(Buffer.from(user), Buffer.from(AUTH_CONFIG.BASIC_AUTH_USER));
      const pok = timingSafeEqual(Buffer.from(pass), Buffer.from(AUTH_CONFIG.BASIC_AUTH_PASS));
      return uok && pok;
    } catch {
      return false;
    }
  };

  const hasHeadlessWriteAuthorization = (r: Request): boolean => (
    hasValidHeadlessApiKey(r) || hasValidHeadlessBasic(r)
  );

  const isHeadlessReadAuthorized = (r: Request, a?: RequestAuth | null): boolean => {
    // If global auth is enabled and a session is present, allow; otherwise require API key or Basic.
    if (AUTH_CONFIG.ENABLED && a?.authenticated) return true;
    return hasHeadlessWriteAuthorization(r);
  };

  // Enforce headless auth requirements up-front
  if (HEADLESS) {
    if (isWrite) {
      if (!hasHeadlessWriteAuthorization(req)) {
        return Response.json(
          { error: 'Authentication required' },
          { status: 401, headers }
        );
      }
    } else {
      if (!isHeadlessReadAuthorized(req, auth)) {
        return Response.json(
          { error: 'Authentication required' },
          { status: 401, headers }
        );
      }
    }
  } else if (isWrite) {
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
          // Rate limit env writes (sanitize env to avoid NaN)
          const winSecondsRaw = process.env.RATE_LIMIT_ENV_WRITE_WINDOW ?? process.env.RATE_LIMIT_WINDOW ?? '900';
          const winSecondsParsed = Number.parseInt(winSecondsRaw, 10);
          const win = Math.max(1000, (Number.isFinite(winSecondsParsed) ? winSecondsParsed : 900) * 1000);
          const maxRaw = process.env.RATE_LIMIT_ENV_WRITE_MAX ?? '10';
          const maxParsed = Number.parseInt(maxRaw, 10);
          const max = Math.max(1, Number.isFinite(maxParsed) ? maxParsed : 10);
          const rl = await checkRateLimit(req, 'env-write', { clientIp: context.clientIp, windowMs: win, max });
          if (!rl.allowed) {
            return Response.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429, headers: { ...headers, 'Retry-After': Math.ceil(win / 1000).toString() } });
          }
          // Body size guard
          if (!isContentLengthWithin(req, DEFAULT_MAX_JSON_BODY)) {
            return Response.json({ error: 'Request too large' }, { status: 413, headers });
          }
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

          // Headless writes must be authorized by API key or Basic (sessions are not sufficient)
          if (HEADLESS && !hasHeadlessWriteAuthorization(req)) {
            return Response.json(
              { error: 'Authentication required' },
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
            const isValid = hasShareCredential && hasGroupCredential;

            // Strict, opt-in: include raw only in non-production with explicit flag AND session-based auth
            const debugFlag = (process.env.ENV_SHARES_INCLUDE_RAW || '').toLowerCase() === 'true';
            const isProd = process.env.NODE_ENV === 'production';
            const authz = req.headers.get('authorization') || '';
            const hasBasicAuth = authz.startsWith('Basic ');
            const hasApiKeyHeader = !!extractApiKeyFromHeaders(req);
            const hasSessionToken = !!(req.headers.get('x-session-id') || (req.headers.get('cookie') || '').includes('session='));
            const isSessionAuth = !!(AUTH_CONFIG.ENABLED && auth?.authenticated && hasSessionToken);
            const allowRaw = debugFlag && !isProd && isSessionAuth && !hasBasicAuth && !hasApiKeyHeader;

            const entry: Record<string, unknown> = {
              hasShareCredential,
              hasGroupCredential,
              isValid,
              savedAt: savedAt || null,
              id: 'env-stored-share',
              source: 'environment',
            };
            if (allowRaw) {
              entry.shareCredential = env.SHARE_CRED || null;
              entry.groupCredential = env.GROUP_CRED || null;
            }
            shares.push(entry);
          }
          return Response.json(shares, { headers });
        }

        if (req.method === 'POST') {
          // Rate limit env writes
          const winSecondsRaw2 = process.env.RATE_LIMIT_ENV_WRITE_WINDOW ?? process.env.RATE_LIMIT_WINDOW ?? '900';
          const winSecondsParsed2 = Number.parseInt(winSecondsRaw2, 10);
          const win = Math.max(1000, (Number.isFinite(winSecondsParsed2) ? winSecondsParsed2 : 900) * 1000);
          const maxRaw2 = process.env.RATE_LIMIT_ENV_WRITE_MAX ?? '10';
          const maxParsed2 = Number.parseInt(maxRaw2, 10);
          const max = Math.max(1, Number.isFinite(maxParsed2) ? maxParsed2 : 10);
          const rl = await checkRateLimit(req, 'env-write', { clientIp: context.clientIp, windowMs: win, max });
          if (!rl.allowed) {
            return Response.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429, headers: { ...headers, 'Retry-After': Math.ceil(win / 1000).toString() } });
          }
          // Body size guard
          if (!isContentLengthWithin(req, DEFAULT_MAX_JSON_BODY)) {
            return Response.json({ error: 'Request too large' }, { status: 413, headers });
          }
          if (HEADLESS && !hasHeadlessWriteAuthorization(req)) {
            return Response.json(
              { error: 'Authentication required' },
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
          // Rate limit env deletions (sanitize env to avoid NaN)
          const winSecondsRaw3 = process.env.RATE_LIMIT_ENV_WRITE_WINDOW ?? process.env.RATE_LIMIT_WINDOW ?? '900';
          const winSecondsParsed3 = Number.parseInt(winSecondsRaw3, 10);
          const win = Math.max(1000, (Number.isFinite(winSecondsParsed3) ? winSecondsParsed3 : 900) * 1000);
          const maxRaw3 = process.env.RATE_LIMIT_ENV_WRITE_MAX ?? '10';
          const maxParsed3 = Number.parseInt(maxRaw3, 10);
          const max = Math.max(1, Number.isFinite(maxParsed3) ? maxParsed3 : 10);
          const rl = await checkRateLimit(req, 'env-write', { clientIp: context.clientIp, windowMs: win, max });
          if (!rl.allowed) {
            return Response.json({ error: 'Rate limit exceeded. Try again later.' }, { status: 429, headers: { ...headers, 'Retry-After': Math.ceil(win / 1000).toString() } });
          }
          // Body size guard
          if (!isContentLengthWithin(req, DEFAULT_MAX_JSON_BODY)) {
            return Response.json({ error: 'Request too large' }, { status: 413, headers });
          }
          if (HEADLESS && !hasHeadlessWriteAuthorization(req)) {
            return Response.json(
              { error: 'Headless mode: API key or Basic auth required for environment modifications' },
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
