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
  DEFAULT_MAX_JSON_BODY,
  validateRelayUrls,
  normalizeRelayListForEcho
} from './utils.js';
import { hasCredentials, HEADLESS, ADMIN_SECRET } from '../const.js';
import { createNodeWithCredentials, sendSelfEcho, broadcastShareEcho } from '../node/manager.js';
import { executeUnderNodeLock, cleanupNodeSynchronized } from '../utils/node-lock.js';
import { validateShare, validateGroup } from '@frostr/igloo-core';
import { AUTH_CONFIG, checkRateLimit } from './auth.js';
import { validateAdminSecret } from './onboarding.js';
import { getUserCredentials, getUserById } from '../db/database.js';
import { timingSafeEqual } from 'crypto';

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

  // Create a new Bifrost node instance using the provided credentials and relay config.
  // NOTE: Callers of this helper should execute it under executeUnderNodeLock() to
  // serialize node transitions and avoid races (see usages in this file below).
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

  // Atomically swap the node reference. updateNode() is responsible for:
  // - Cleaning up any existing node (closing connections, timers, etc.)
  // - Resetting health monitoring state
  // - Wiring event listeners for the new node
  // This ensures no resource leaks when rotating credentials.
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
    'Cache-Control': 'no-store',
    'Vary': mergedVary,
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers });
  }

  // Preflight classification: treat mutating verbs as "write". In this API, actual
  // mutating handlers are implemented as POST endpoints (e.g., /api/env, /api/env/delete),
  // but we keep the broader classification for clarity.
  const isWrite = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE';
  // Resolve authenticated DB user id (database mode only)
  const authenticatedNumericUserId = (!HEADLESS && auth?.authenticated && (
    typeof auth.userId === 'number' || (typeof auth.userId === 'string' && /^\d+$/.test(auth.userId))
  )) ? BigInt(auth!.userId as any) : null;
  const isRoleAdmin = await (async () => {
    try {
      if (authenticatedNumericUserId === null) return false;
      const u = await getUserById(authenticatedNumericUserId);
      return !!(u && u.role === 'admin');
    } catch {
      return false;
    }
  })();

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
    // DB mode preflight: require an authenticated session up front. Route branches
    // (POST bodies) perform the stricter privilege checks (admin-secret OR role-admin)
    // before any mutation is applied.
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
            return Response.json({ ...publicEnv, adminSecretAvailable: false }, { headers });
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

            // Expose non-sensitive server/env settings alongside user credentials so the UI
            // can render Advanced Settings (rate limits, CORS, timeouts, etc.).
            // Uses the same public filter as headless mode to avoid leaking secrets.
            const publicEnv = await readPublicEnvFile();

            return Response.json({
              ...publicEnv,
              GROUP_CRED: undefined,
              SHARE_CRED: undefined,
              GROUP_NAME: credentials.group_name || undefined,
              RELAYS: credentials.relays || undefined,
              hasCredentials: !!(credentials.group_cred && credentials.share_cred),
              adminSecretAvailable: isRoleAdmin && !!ADMIN_SECRET
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

            // DB mode privilege gate for env writes (no legacy fallback):
            // - allow with valid ADMIN_SECRET (header: X-Admin-Secret or Bearer token), or
            // - allow when the authenticated DB user has role=admin.
            // validateAdminSecret() returns false when the header is missing; there is no bypass.
            const adminSecret = req.headers.get('X-Admin-Secret') ?? req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
            const isAdminSecret = await validateAdminSecret(adminSecret);
            if (!isAdminSecret && !isRoleAdmin) {
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

          for (const key of validKeys) {
            if (body[key] !== undefined) {
              env[key] = body[key];
            }
          }
          // Detect impactful changes; stamp timestamp when credentials change
          const updatingCredentials = validKeys.some(key => ['GROUP_CRED', 'SHARE_CRED'].includes(key));
          const updatingRelays = validKeys.includes('RELAYS');
          if (updatingCredentials) {
            // Set the timestamp explicitly here to avoid relying on downstream helpers
            // for correctness, then perform a single write.
            (env as any).CREDENTIALS_SAVED_AT = new Date().toISOString();
          }
          const writeOk = await writeEnvFile(env);

          if (writeOk) {
            try {
              if (validKeys.includes('FROSTR_SIGN_TIMEOUT') && typeof env.FROSTR_SIGN_TIMEOUT === 'string') {
                process.env.FROSTR_SIGN_TIMEOUT = env.FROSTR_SIGN_TIMEOUT;
              }
              if (validKeys.includes('ALLOWED_ORIGINS') && typeof env.ALLOWED_ORIGINS === 'string') {
                process.env.ALLOWED_ORIGINS = env.ALLOWED_ORIGINS;
              }
              if (updatingRelays) {
                const relaysVal = (env as any).RELAYS;
                if (Array.isArray(relaysVal)) {
                  process.env.RELAYS = relaysVal.join(',');
                } else if (typeof relaysVal === 'string') {
                  process.env.RELAYS = relaysVal;
                }
              }
            } catch {}

            if (updatingCredentials || updatingRelays) {
              try {
                // Make restart intent explicit for observability and reviews
                context.addServerLog('info', 'Recreating Bifrost node due to env changes', {
                  updatingCredentials,
                  updatingRelays
                });

                const echoPayload = (() => {
                  if (!updatingCredentials) return null;
                  const groupCred = typeof env.GROUP_CRED === 'string' ? env.GROUP_CRED : null;
                  const shareCred = typeof env.SHARE_CRED === 'string' ? env.SHARE_CRED : null;
                  if (!groupCred || !shareCred) return null;
                  const relaysArray = normalizeRelayListForEcho(env.RELAYS);
                  const relaysEnvValue = Array.isArray(env.RELAYS)
                    ? env.RELAYS.join(',')
                    : typeof env.RELAYS === 'string'
                      ? env.RELAYS
                      : undefined;
                  return {
                    groupCred,
                    shareCred,
                    relaysArray,
                    relaysEnvValue,
                    contextLabel: HEADLESS ? 'headless env credential update' : 'env credential update'
                  };
                })();

                // Serialize node restart under the global node lock. createAndConnectServerNode()
                // calls context.updateNode(newNode), which performs prior-node cleanup and
                // listener re-wiring atomically to avoid resource leaks or races.
                await executeUnderNodeLock(async () => {
                  await createAndConnectServerNode(env, context);
                }, context);

                if (echoPayload) {
                  const echoOptions = {
                    relays: echoPayload.relaysArray,
                    relaysEnv: echoPayload.relaysEnvValue,
                    addServerLog: context.addServerLog,
                    contextLabel: echoPayload.contextLabel,
                    timeoutMs: 30000
                  } as const;
                  sendSelfEcho(echoPayload.groupCred, echoPayload.shareCred, echoOptions).catch((error) => {
                    try { context.addServerLog('warn', 'Self-echo failed after env credential update', error); } catch {}
                  });
                  broadcastShareEcho(echoPayload.groupCred, echoPayload.shareCred, echoOptions).catch((error) => {
                    try { context.addServerLog('warn', 'Credential echo broadcast failed after env credential update', error); } catch {}
                  });
                }
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
        // Intentionally headless-only: this endpoint reports environment-backed
        // credentials. In database mode, the UI retrieves per-user credential
        // presence/metadata via GET /api/env instead. If we ever want to expose
        // shares metadata in DB mode, guard it behind an explicit feature flag
        // (e.g., ENV_SHARES_ENABLED=true) rather than removing this 404.
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
              // Serialize node restart under the global node lock; updateNode inside
              // createAndConnectServerNode() handles teardown of any existing node.
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

            const groupCred = typeof env.GROUP_CRED === 'string' ? env.GROUP_CRED : null;
            const shareCred = typeof env.SHARE_CRED === 'string' ? env.SHARE_CRED : null;
            if (groupCred && shareCred) {
              const relaysArray = normalizeRelayListForEcho(env.RELAYS);
              const relaysEnvValue = Array.isArray(env.RELAYS)
                ? env.RELAYS.join(',')
                : typeof env.RELAYS === 'string'
                  ? env.RELAYS
                  : undefined;

              const echoOptions = {
                relays: relaysArray,
                relaysEnv: relaysEnvValue,
                addServerLog: context.addServerLog,
                contextLabel: 'headless env share upload',
                timeoutMs: 30000
              } as const;

              sendSelfEcho(groupCred, shareCred, echoOptions).catch((error) => {
                try { context.addServerLog('warn', 'Self-echo failed after env share upload', error); } catch {}
              });

              broadcastShareEcho(groupCred, shareCred, echoOptions).catch((error) => {
                try { context.addServerLog('warn', 'Credential echo broadcast failed after env share upload', error); } catch {}
              });
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
            const isAdminSecret = await validateAdminSecret(adminSecret);
            if (!isAdminSecret && !isRoleAdmin) {
              return Response.json(
                { error: 'Admin privileges required for deleting environment variables' },
                { status: 403, headers }
              );
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

      case '/api/env/admin-secret': {
        if (req.method !== 'POST') {
          return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
        }

        if (HEADLESS) {
          // Avoid exposing ADMIN_SECRET in headless mode; operators can manage secrets via env/CLI.
          return Response.json({ error: 'Not found' }, { status: 404, headers });
        }

        if (!auth || !auth.authenticated) {
          return Response.json({ error: 'Authentication required' }, { status: 401, headers });
        }

        if (!isRoleAdmin) {
          return Response.json({ error: 'Admin privileges required' }, { status: 403, headers });
        }

        // Optional small body guard to avoid large payloads
        if (!isContentLengthWithin(req, DEFAULT_MAX_JSON_BODY)) {
          return Response.json({ error: 'Request too large' }, { status: 413, headers });
        }

        // Require explicit confirmation flag to ensure the client intentionally requested a reveal
        let confirmReveal = false;
        try {
          const body = await parseJsonRequestBody(req);
          confirmReveal = body?.confirm === true || body?.confirmReveal === true;
        } catch {
          confirmReveal = false;
        }

        if (!confirmReveal) {
          return Response.json({ error: 'Confirmation required to reveal admin secret' }, { status: 400, headers });
        }

        if (!ADMIN_SECRET) {
          return Response.json({ error: 'Admin secret not configured' }, { status: 404, headers });
        }

        // Do not cache this response; handled via headers above.
        return Response.json({ adminSecret: ADMIN_SECRET }, { headers });
      }
    }
    
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  } catch (error) {
    console.error('API Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers });
  }
} 
