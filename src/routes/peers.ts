import { 
  decodeGroup, 
  extractSelfPubkeyFromCredentials,
  normalizePubkey,
  comparePubkeys,
  DEFAULT_PING_TIMEOUT
} from '@frostr/igloo-core';
import { RouteContext, PeerStatus } from './types.js';
import { readEnvFile, getSecureCorsHeaders } from './utils.js';

// Constants - use igloo-core default
const PING_TIMEOUT_MS = DEFAULT_PING_TIMEOUT;

// Flag to prevent repeated CORS warnings
let corsWarningLogged = false;

export async function handlePeersRoute(req: Request, url: URL, context: RouteContext): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/peers')) return null;

  // Get secure CORS headers based on request origin
  const corsHeaders = getSecureCorsHeaders(req);
  
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
  };

  try {
    switch (url.pathname) {
      case '/api/peers':
        if (req.method === 'GET') {
          // Get all peers from group credential using igloo-core decoding
          const env = await readEnvFile();
          if (!env.GROUP_CRED) {
            return Response.json({ error: 'No group credential available' }, { status: 400, headers });
          }
          
          try {
            // Use igloo-core function to decode group and extract peers
            const decodedGroup = decodeGroup(env.GROUP_CRED);
            const allPeers = decodedGroup.commits.map(commit => commit.pubkey);
            
            // Filter out self if we have share credential
            let filteredPeers = allPeers;
            if (env.SHARE_CRED) {
              try {
                const selfPubkeyResult = extractSelfPubkeyFromCredentials(env.GROUP_CRED, env.SHARE_CRED);
                if (selfPubkeyResult.pubkey) {
                  filteredPeers = allPeers.filter(pubkey => !comparePubkeys(pubkey, selfPubkeyResult.pubkey!));
                }
              } catch (error) {
                // If self extraction fails, just use all peers (self will be in the list)
                console.warn('Could not extract self pubkey for filtering:', error);
              }
            }
            
            // Get current status for each peer
            const peersWithStatus = filteredPeers.map(pubkey => {
              const normalizedPubkey = normalizePubkey(pubkey);
              const status = context.peerStatuses.get(normalizedPubkey);
              return {
                pubkey,
                online: status?.online || false,
                lastSeen: status?.lastSeen?.toISOString(),
                latency: status?.latency,
                lastPingAttempt: status?.lastPingAttempt?.toISOString()
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
          const env = await readEnvFile();
          if (!env.GROUP_CRED || !env.SHARE_CRED) {
            return Response.json({ error: 'Missing credentials' }, { status: 400, headers });
          }
          
          const selfPubkeyResult = extractSelfPubkeyFromCredentials(env.GROUP_CRED, env.SHARE_CRED);
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
          
          const body = await req.json();
          const { target } = body;
          
          if (target === 'all') {
            return await handlePingAllPeers(context, headers);
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

async function handlePingAllPeers(context: RouteContext, headers: Record<string, string>): Promise<Response> {
  // Ping all peers using igloo-core decoding
  const env = await readEnvFile();
  if (!env.GROUP_CRED) {
    return Response.json({ error: 'No group credential available' }, { status: 400, headers });
  }
  
  try {
    // Use igloo-core function to decode group and extract peers
    const decodedGroup = decodeGroup(env.GROUP_CRED);
    let allPeers = decodedGroup.commits.map(commit => commit.pubkey);
    
    // Filter out self if we have share credential
    if (env.SHARE_CRED) {
      try {
        const selfPubkeyResult = extractSelfPubkeyFromCredentials(env.GROUP_CRED, env.SHARE_CRED);
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