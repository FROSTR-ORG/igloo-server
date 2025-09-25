import { 
  decodeGroup, 
  extractSelfPubkeyFromCredentials,
  normalizePubkey,
  comparePubkeys,
  DEFAULT_PING_TIMEOUT,
  setNodePolicies,
  getNodePolicies,
  getNodePolicy,
  canSendToPeer,
  canReceiveFromPeer
} from '@frostr/igloo-core';
import { Buffer } from 'node:buffer';
import { RouteContext, PeerStatus, RequestAuth } from './types.js';
import type { NodePolicySummary } from '@frostr/igloo-core';
import { readEnvFile, getSecureCorsHeaders, mergeVaryHeaders, parseJsonRequestBody } from './utils.js';
import { HEADLESS } from '../const.js';
import { saveFallbackPeerPolicies } from '../node/peer-policy-store.js';
import { sanitizePeerPolicyEntries } from '../util/peer-policy.js';

type StoredPeerPolicy = import('../db/database.js').StoredPeerPolicy;

// Constants - use igloo-core default
const PING_TIMEOUT_MS = DEFAULT_PING_TIMEOUT;

function safeNormalizePubkey(pubkey: string): string | null {
  try {
    return normalizePubkey(pubkey);
  } catch {
    return null;
  }
}

function serializePolicy(
  node: RouteContext['node'],
  summary: NodePolicySummary | undefined,
  requestedPubkey: string,
  normalized: string | null
) {
  let effectiveSend: boolean | null = summary ? summary.allowSend : null;
  let effectiveReceive: boolean | null = summary ? summary.allowReceive : null;

  if (node && normalized) {
    try {
      effectiveSend = canSendToPeer(node, normalized);
    } catch {
      effectiveSend = summary ? summary.allowSend : null;
    }

    try {
      effectiveReceive = canReceiveFromPeer(node, normalized);
    } catch {
      effectiveReceive = summary ? summary.allowReceive : null;
    }
  }

  const lastUpdatedRaw = summary?.lastUpdated;
  const lastUpdated = lastUpdatedRaw instanceof Date
    ? lastUpdatedRaw.toISOString()
    : typeof lastUpdatedRaw === 'string'
      ? lastUpdatedRaw
      : null;

  return {
    pubkey: requestedPubkey,
    normalizedPubkey: normalized ?? requestedPubkey,
    allowSend: summary ? summary.allowSend : null,
    allowReceive: summary ? summary.allowReceive : null,
    status: summary?.status ?? 'unknown',
    label: summary?.label ?? null,
    note: summary?.note ?? null,
    source: summary?.source ?? null,
    lastUpdated,
    effectiveSend,
    effectiveReceive,
    hasExplicitPolicy: Boolean(summary)
  };
}

function resolveDatabaseUserId(auth?: RequestAuth | null): number | bigint | null {
  if (!auth || !auth.authenticated) return null;
  const rawId = auth.userId;
  if (typeof rawId === 'number' && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === 'string' && /^\d+$/.test(rawId)) {
    try {
      return BigInt(rawId);
    } catch {
      return null;
    }
  }
  return null;
}

async function persistUserPeerPolicies(
  context: RouteContext,
  auth?: RequestAuth | null
): Promise<void> {
  const summaries = context.node ? getNodePolicies(context.node) : [];
  const rawPolicies = summaries.map(summary => ({
    pubkey: summary.pubkey,
    allowSend: typeof summary.allowSend === 'boolean' ? summary.allowSend : null,
    allowReceive: typeof summary.allowReceive === 'boolean' ? summary.allowReceive : null,
    label: typeof summary.label === 'string' ? summary.label : null,
    note: typeof summary.note === 'string' ? summary.note : null
  }));
  const sanitizedPolicies = sanitizePeerPolicyEntries(rawPolicies) as StoredPeerPolicy[];
  const hasPolicies = sanitizedPolicies.length > 0;

  if (HEADLESS) {
    await saveFallbackPeerPolicies(hasPolicies ? sanitizedPolicies : null);
    return;
  }

  const userId = resolveDatabaseUserId(auth);
  if (userId === null) {
    await saveFallbackPeerPolicies(hasPolicies ? sanitizedPolicies : null);
    return;
  }

  try {
    const { updateUserPeerPolicies } = await import('../db/database.js');

    if (!context.node || summaries.length === 0) {
      updateUserPeerPolicies(userId, null);
      await saveFallbackPeerPolicies(null);
      return;
    }

    const success = updateUserPeerPolicies(userId, sanitizedPolicies);
    if (!success) {
      console.warn('Failed to persist peer policies for user', userId);
      await saveFallbackPeerPolicies(hasPolicies ? sanitizedPolicies : null);
    } else {
      await saveFallbackPeerPolicies(hasPolicies ? sanitizedPolicies : null);
    }
  } catch (error) {
    console.error('Failed to persist peer policies:', error);
    await saveFallbackPeerPolicies(hasPolicies ? sanitizedPolicies : null);
  }
}

// Helper function to get credentials based on mode
async function getCredentials(auth?: RequestAuth | null): Promise<{ group_cred?: string; share_cred?: string } | null> {
  if (HEADLESS) {
    // Headless mode - get from environment
    const env = await readEnvFile();
    return {
      group_cred: env.GROUP_CRED,
      share_cred: env.SHARE_CRED
    };
  } else {
    // Database mode - get from authenticated user's stored credentials
    if (!auth?.authenticated || (typeof auth.userId !== 'number' && (typeof auth.userId !== 'string' || !/^\d+$/.test(auth.userId)))) {
      return null;
    }
    
    // Get authentication secret - avoid double-consuming ephemeral getters
    let secret: string | Uint8Array | null = null;
    let isDerivedKey = false;
    
    // Try password first (if getter exists and returns a value)
    if (auth.getPassword) {
      const password = auth.getPassword();
      if (password) {
        secret = password;
        isDerivedKey = false;
      }
    }
    
    // Only try derivedKey if password wasn't available
    if (!secret && auth.getDerivedKey) {
      const derivedKey = auth.getDerivedKey();
      if (derivedKey) {
        secret = derivedKey;
        isDerivedKey = true;
      }
    }
    
    // No authentication secret available
    if (!secret) {
      return null;
    }
    
    try {
      // Dynamic import to avoid bundling DB code in headless builds
      const { getUserCredentials } = await import('../db/database.js');
      
      // Await the call to support both sync and async implementations
      // Convert string userId to bigint for database operation
      const dbUserId = typeof auth.userId === 'string' ? BigInt(auth.userId) : auth.userId;
      const credentials = await getUserCredentials(
        dbUserId,
        secret,
        isDerivedKey
      );
      
      if (credentials) {
        // Convert nulls to undefined for consistency with expected type
        return {
          group_cred: credentials.group_cred || undefined,
          share_cred: credentials.share_cred || undefined
        };
      }
      return null;
    } catch (error) {
      console.error('Failed to retrieve user credentials for peers:', error);
      return null;
    }
  }
}

export async function handlePeersRoute(req: Request, url: URL, context: RouteContext, auth?: RequestAuth | null): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/peers')) return null;

  // Get secure CORS headers based on request origin
  const corsHeaders = getSecureCorsHeaders(req);
  
  const mergedVary = mergeVaryHeaders(corsHeaders);
  
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
    'Vary': mergedVary,
  };

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  try {
    if (url.pathname === '/api/peers/policies') {
      return await handlePeerPoliciesRoute(req, headers, context, auth);
    }

    const singlePolicyMatch = url.pathname.match(/^\/api\/peers\/([^/]+)\/policy$/);
    if (singlePolicyMatch) {
      const targetParam = singlePolicyMatch[1];
      return await handlePeerPolicyRoute(req, headers, context, auth, targetParam);
    }

    switch (url.pathname) {
      case '/api/peers/group':
        if (req.method === 'GET') {
          // Return group pubkey in x-only hex and basic info
          const credentials = await getCredentials(auth);
          if (!credentials || !credentials.group_cred) {
            const statusCode = !HEADLESS ? 401 : 400;
            return Response.json({ error: 'No group credential available' }, { status: statusCode, headers });
          }
          try {
            const decoded = decodeGroup(credentials.group_cred);
            const groupPk: unknown = (decoded as any).group_pk;
            let hex: string;
            if (typeof groupPk === 'string') {
              hex = groupPk.toLowerCase();
            } else if (groupPk instanceof Uint8Array || Buffer.isBuffer(groupPk)) {
              hex = Buffer.from(groupPk).toString('hex');
            } else {
              throw new Error('Invalid group_pk format');
            }
            // Strip 02/03 compression prefix if present to return x-only pubkey
            const pubkey = (hex.length === 66 && (hex.startsWith('02') || hex.startsWith('03'))) ? hex.slice(2) : hex;
            return Response.json({ pubkey, threshold: decoded.threshold, totalShares: decoded.commits.length }, { headers });
          } catch (e) {
            return Response.json({ error: 'Failed to decode group credential' }, { status: 400, headers });
          }
        }
        break;
      case '/api/peers':
        if (req.method === 'GET') {
          // Get credentials based on mode
          const credentials = await getCredentials(auth);
          if (!credentials || !credentials.group_cred) {
            // Return 401 in DB mode for auth failures, 400 in headless for missing env
            const statusCode = !HEADLESS ? 401 : 400;
            return Response.json({ error: 'No group credential available' }, { status: statusCode, headers });
          }
          
          try {
            // Use igloo-core function to decode group and extract peers
            const decodedGroup = decodeGroup(credentials.group_cred);
            const allPeers = decodedGroup.commits.map(commit => commit.pubkey);
            
            // Filter out self if we have share credential
            let filteredPeers = allPeers;
            if (credentials.share_cred) {
              try {
                const selfPubkeyResult = extractSelfPubkeyFromCredentials(credentials.group_cred, credentials.share_cred);
                if (selfPubkeyResult.pubkey) {
                  filteredPeers = allPeers.filter(pubkey => !comparePubkeys(pubkey, selfPubkeyResult.pubkey!));
                }
              } catch (error) {
                // If self extraction fails, just use all peers (self will be in the list)
                console.warn('Could not extract self pubkey for filtering:', error);
              }
            }
            
            // Load current node policies if available
            let policyLookup: Map<string, NodePolicySummary> | null = null;
            if (context.node) {
              try {
                const summaries = getNodePolicies(context.node);
                policyLookup = new Map();
                for (const summary of summaries) {
                  const normalizedSummaryKey = safeNormalizePubkey(summary.pubkey);
                  if (normalizedSummaryKey) {
                    policyLookup.set(normalizedSummaryKey, summary);
                  }
                }
              } catch (error) {
                console.warn('Failed to fetch node policies for peer list:', error);
              }
            }

            // Get current status for each peer
            const peersWithStatus = filteredPeers.map(pubkey => {
              const normalizedPubkey = safeNormalizePubkey(pubkey);
              const status = normalizedPubkey ? context.peerStatuses.get(normalizedPubkey) : undefined;
              const policySummary = normalizedPubkey && policyLookup ? policyLookup.get(normalizedPubkey) : undefined;
              const policy = serializePolicy(context.node, policySummary, pubkey, normalizedPubkey);
              return {
                pubkey,
                online: status?.online || false,
                lastSeen: status?.lastSeen?.toISOString(),
                latency: status?.latency,
                lastPingAttempt: status?.lastPingAttempt?.toISOString(),
                policy
              };
            });
            
            return Response.json({ 
              peers: peersWithStatus,
              total: peersWithStatus.length,
              online: peersWithStatus.filter(p => p.online).length
            }, { headers });
          } catch (error) {
            console.error('Failed to decode group credential:', error);
            return Response.json({ error: 'Failed to decode group credential' }, { status: 400, headers });
          }
        }
        break;

      case '/api/peers/self':
        if (req.method === 'GET') {
          const credentials = await getCredentials(auth);
          if (!credentials || !credentials.group_cred || !credentials.share_cred) {
            // Return 401 in DB mode for auth failures, 400 in headless for missing env
            const statusCode = !HEADLESS ? 401 : 400;
            return Response.json({ error: 'Missing credentials' }, { status: statusCode, headers });
          }
          
          const selfPubkeyResult = extractSelfPubkeyFromCredentials(credentials.group_cred, credentials.share_cred);
          if (selfPubkeyResult.pubkey) {
            return Response.json({ 
              pubkey: selfPubkeyResult.pubkey,
              warnings: selfPubkeyResult.warnings 
            }, { headers });
          } else {
            return Response.json({ 
              error: 'Could not extract self pubkey',
              warnings: selfPubkeyResult.warnings 
            }, { status: 400, headers });
          }
        }
        break;

      case '/api/peers/ping':
        if (req.method === 'POST') {
          if (!context.node) {
            return Response.json({ error: 'Node not available' }, { status: 503, headers });
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
          
          const { target } = body;
          
          if (target === 'all') {
            return await handlePingAllPeers(context, headers, auth);
          } else if (typeof target === 'string') {
            return await handlePingSinglePeer(target, context, headers);
          } else {
            return Response.json({ error: 'Invalid target parameter' }, { status: 400, headers });
          }
        }
        break;
    }
    
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  } catch (error) {
    console.error('Peer API Error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500, headers });
  }
}

async function handlePeerPoliciesRoute(
  req: Request,
  headers: Record<string, string>,
  context: RouteContext,
  auth?: RequestAuth | null
): Promise<Response> {
  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  }

  const credentials = await getCredentials(auth);
  if (!credentials || !credentials.group_cred) {
    const statusCode = !HEADLESS ? 401 : 400;
    return Response.json({ error: 'No group credential available' }, { status: statusCode, headers });
  }

  if (!context.node) {
    return Response.json({ error: 'Node not available' }, { status: 503, headers });
  }

  try {
    const summaries = getNodePolicies(context.node);
    const policies = summaries.map(summary => {
      const normalized = safeNormalizePubkey(summary.pubkey) ?? summary.pubkey;
      return serializePolicy(context.node, summary, summary.pubkey, normalized);
    });

    return Response.json({ policies }, { headers });
  } catch (error) {
    console.error('Failed to retrieve peer policies:', error);
    return Response.json({ error: 'Failed to retrieve peer policies' }, { status: 500, headers });
  }
}

async function handlePeerPolicyRoute(
  req: Request,
  headers: Record<string, string>,
  context: RouteContext,
  auth: RequestAuth | null | undefined,
  targetParam: string
): Promise<Response> {
  let targetPubkey: string;
  try {
    targetPubkey = decodeURIComponent(targetParam);
  } catch {
    return Response.json({ error: 'Invalid peer identifier' }, { status: 400, headers });
  }

  const credentials = await getCredentials(auth);
  if (!credentials || !credentials.group_cred) {
    const statusCode = !HEADLESS ? 401 : 400;
    return Response.json({ error: 'No group credential available' }, { status: statusCode, headers });
  }

  if (!context.node) {
    return Response.json({ error: 'Node not available' }, { status: 503, headers });
  }

  const normalized = safeNormalizePubkey(targetPubkey);
  if (!normalized) {
    return Response.json({ error: 'Peer pubkey must be a 64-character hex string' }, { status: 400, headers });
  }

  if (req.method === 'GET') {
    try {
      const summary = getNodePolicy(context.node, normalized);
      const policy = serializePolicy(context.node, summary, targetPubkey, normalized);
      return Response.json({ policy }, { headers });
    } catch (error) {
      console.error('Failed to read peer policy:', error);
      return Response.json({ error: 'Failed to read peer policy' }, { status: 500, headers });
    }
  }

  if (req.method === 'PUT') {
    let body: unknown;
    try {
      body = await parseJsonRequestBody(req);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Invalid request body' },
        { status: 400, headers }
      );
    }

    const allowSend = typeof (body as any)?.allowSend === 'boolean' ? (body as any).allowSend : undefined;
    const allowReceive = typeof (body as any)?.allowReceive === 'boolean' ? (body as any).allowReceive : undefined;

    if (allowSend === undefined && allowReceive === undefined) {
      return Response.json({ error: 'Policy update requires allowSend and/or allowReceive' }, { status: 400, headers });
    }

    const currentSummary = getNodePolicy(context.node, normalized);
    const nextAllowSend = allowSend ?? currentSummary?.allowSend ?? false;
    const nextAllowReceive = allowReceive ?? currentSummary?.allowReceive ?? false;

    const policyInput: Record<string, unknown> = {
      pubkey: normalized,
      allowSend: nextAllowSend,
      allowReceive: nextAllowReceive
    };

    try {
      setNodePolicies(context.node, [policyInput], { merge: true });
      const summary = getNodePolicy(context.node, normalized);
      const policy = serializePolicy(context.node, summary, targetPubkey, normalized);
      try {
        context.addServerLog('info', 'Peer policy updated', {
          pubkey: normalized,
          allowSend: policy.allowSend,
          allowReceive: policy.allowReceive
        });
      } catch {}
      await persistUserPeerPolicies(context, auth);
      return Response.json({ policy }, { headers });
    } catch (error) {
      console.error('Failed to update peer policy:', error);
      return Response.json({ error: 'Failed to update peer policy' }, { status: 500, headers });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const summaries = getNodePolicies(context.node);
      const remainingInputs = summaries
        .filter(summary => !comparePubkeys(summary.pubkey, normalized))
        .map(summary => ({
          pubkey: summary.pubkey,
          allowSend: summary.allowSend,
          allowReceive: summary.allowReceive,
          label: summary.label,
          note: summary.note,
          source: summary.source
        }));

      if (remainingInputs.length === summaries.length) {
        return Response.json({ error: 'Policy not found' }, { status: 404, headers });
      }

      setNodePolicies(context.node, remainingInputs, { merge: false });
      const summary = getNodePolicy(context.node, normalized);
      const policy = serializePolicy(context.node, summary, targetPubkey, normalized);
      try {
        context.addServerLog('info', 'Peer policy removed', { pubkey: normalized });
      } catch {}
      await persistUserPeerPolicies(context, auth);
      return Response.json({ removed: true, policy }, { headers });
    } catch (error) {
      console.error('Failed to remove peer policy:', error);
      return Response.json({ error: 'Failed to remove peer policy' }, { status: 500, headers });
    }
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
}

async function handlePingAllPeers(context: RouteContext, headers: Record<string, string>, auth?: RequestAuth | null): Promise<Response> {
  // Get credentials based on mode
  const credentials = await getCredentials(auth);
  if (!credentials || !credentials.group_cred) {
    // Return 401 in DB mode for auth failures, 400 in headless for missing env
    const statusCode = !HEADLESS ? 401 : 400;
    return Response.json({ error: 'No group credential available' }, { status: statusCode, headers });
  }
  
  try {
    // Use igloo-core function to decode group and extract peers
    const decodedGroup = decodeGroup(credentials.group_cred);
    let allPeers = decodedGroup.commits.map(commit => commit.pubkey);
    
    // Filter out self if we have share credential
    if (credentials.share_cred) {
      try {
        const selfPubkeyResult = extractSelfPubkeyFromCredentials(credentials.group_cred, credentials.share_cred);
        if (selfPubkeyResult.pubkey) {
          allPeers = allPeers.filter(pubkey => !comparePubkeys(pubkey, selfPubkeyResult.pubkey!));
        }
      } catch (error) {
        console.warn('Could not extract self pubkey for ping filtering:', error);
      }
    }
    
    const pingPromises = allPeers.map(async (pubkey) => {
       const normalizedPubkey = normalizePubkey(pubkey);
       try {
         const startTime = Date.now();
         let result;
         if (context.node) {
           result = await Promise.race([
             context.node.req.ping(normalizedPubkey),
             new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), PING_TIMEOUT_MS))
           ]);
         } else {
           throw new Error('Node not available');
         }
         
         const latency = Date.now() - startTime;
         
         if ((result as any).ok) {
           const updatedStatus: PeerStatus = {
             pubkey,
             online: true,
             lastSeen: new Date(),
             latency
           };
           context.peerStatuses.set(normalizedPubkey, updatedStatus);
           
           // Broadcast peer status for peer list (not logged to event stream)
           context.broadcastEvent({
             type: 'peer-ping-internal',
             message: '', // Internal use only - not logged
             data: { pubkey, status: updatedStatus, success: true },
             timestamp: new Date().toLocaleTimeString(),
             id: Math.random().toString(36).substring(2, 11)
           });
           
           return { pubkey, success: true, latency };
         } else {
           const updatedStatus: PeerStatus = {
             pubkey,
             online: false,
             lastPingAttempt: new Date()
           };
           context.peerStatuses.set(normalizedPubkey, updatedStatus);
           return { pubkey, success: false, error: 'Timeout' };
         }
         } catch (error) {
         const errorMessage = error instanceof Error ? error.message : 'Unknown error';
         const updatedStatus: PeerStatus = {
           pubkey,
           online: false,
           lastPingAttempt: new Date()
         };
         context.peerStatuses.set(normalizedPubkey, updatedStatus);
         return { pubkey, success: false, error: errorMessage };
       }
    });
    
    const results = await Promise.all(pingPromises);
    return Response.json({ results }, { headers });
  } catch (error) {
    return Response.json({ error: 'Failed to ping peers' }, { status: 500, headers });
  }
}

async function handlePingSinglePeer(target: string, context: RouteContext, headers: Record<string, string>): Promise<Response> {
  // Ping specific peer
  const normalizedPubkey = normalizePubkey(target);
  
  try {
    const startTime = Date.now();
    let result;
    if (context.node) {
      result = await Promise.race([
        context.node.req.ping(normalizedPubkey),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), PING_TIMEOUT_MS))
      ]);
    } else {
      throw new Error('Node not available');
    }
    
    const latency = Date.now() - startTime;
    
    if ((result as any).ok) {
      const updatedStatus: PeerStatus = {
        pubkey: target,
        online: true,
        lastSeen: new Date(),
        latency
      };
      context.peerStatuses.set(normalizedPubkey, updatedStatus);
      
      // Broadcast peer status for peer list (not logged to event stream)
      context.broadcastEvent({
        type: 'peer-ping-internal',
        message: '', // Internal use only - not logged
        data: { pubkey: target, status: updatedStatus, success: true },
        timestamp: new Date().toLocaleTimeString(),
        id: Math.random().toString(36).substring(2, 11)
      });
      
      return Response.json({ 
        pubkey: target, 
        success: true, 
        latency,
        status: updatedStatus 
      }, { headers });
    } else {
      const updatedStatus: PeerStatus = {
        pubkey: target,
        online: false,
        lastPingAttempt: new Date()
      };
      context.peerStatuses.set(normalizedPubkey, updatedStatus);
      
      return Response.json({ 
        pubkey: target, 
        success: false, 
        error: 'Timeout',
        status: updatedStatus 
      }, { headers });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const updatedStatus: PeerStatus = {
      pubkey: target,
      online: false,
      lastPingAttempt: new Date()
    };
    context.peerStatuses.set(normalizedPubkey, updatedStatus);
    
    return Response.json({ 
      pubkey: target, 
      success: false, 
      error: errorMessage,
      status: updatedStatus 
    }, { headers });
  }
} 
