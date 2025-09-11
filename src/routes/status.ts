import { RouteContext, RequestAuth } from './types.js';
import { getSecureCorsHeaders, readPublicEnvFile, getValidRelays } from './utils.js';
import { getNodeHealth } from '../node/manager.js';
import { HEADLESS, hasCredentials } from '../const.js';

export async function handleStatusRoute(req: Request, url: URL, context: RouteContext, auth?: RequestAuth | null): Promise<Response | null> {
  if (url.pathname !== '/api/status') return null;

  // Get secure CORS headers based on request origin
  const corsHeaders = getSecureCorsHeaders(req);
  
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }
  
  if (req.method === 'GET') {
    try {
      // Get current relay count from environment or use default (use public env for relays)
      const publicEnv = await readPublicEnvFile();
      const currentRelays = getValidRelays(publicEnv.RELAYS);
      
      // Get node health information
      const nodeHealth = getNodeHealth();
      
      // Check for stored credentials properly in both modes
      let hasStoredCredentials: boolean | null = null;
      if (HEADLESS) {
        // In headless mode, check if credentials exist without reading their values
        hasStoredCredentials = hasCredentials();
      } else {
        // In database mode, only check credentials for authenticated users
        // This prevents information leakage about whether ANY user has credentials
        if (auth?.authenticated && auth.userId != null) {
          try {
            let parsedUserId: number | bigint | null = null;

            // Conversion step: handle string, number, and bigint explicitly
            try {
              if (typeof auth.userId === 'number') {
                parsedUserId = auth.userId;
              } else if (typeof auth.userId === 'string') {
                const trimmed = auth.userId.trim();
                if (!/^\d+$/.test(trimmed)) throw new Error('Non-numeric userId string');
                try {
                  const asBigInt = BigInt(trimmed);
                  if (asBigInt <= 0n) throw new Error('userId must be positive');
                  // Convert to number only if within safe range
                  parsedUserId = asBigInt <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(asBigInt) : asBigInt;
                } catch {
                  throw new Error('Failed to parse userId string');
                }
              } else if (typeof auth.userId === 'bigint') {
                if (auth.userId <= 0n) throw new Error('bigint userId must be positive');
                parsedUserId = auth.userId;  // Keep as bigint
              } else {
                throw new Error(`Unsupported userId type: ${typeof auth.userId}`);
              }
            } catch (conversionError) {
              console.error('User ID conversion error in status endpoint:', conversionError);
              hasStoredCredentials = false;
              parsedUserId = null;
            }

            // Validation step: only proceed if conversion succeeded
            if (parsedUserId != null) {
              const isValid = typeof parsedUserId === 'bigint' 
                ? parsedUserId > 0n
                : (Number.isFinite(parsedUserId) && Number.isSafeInteger(parsedUserId) && parsedUserId > 0);

              if (!isValid) {
                console.error('User ID validation error in status endpoint: not a positive integer');
                hasStoredCredentials = false;
              } else {
                // Lazy-load DB only in non-headless, authenticated path
                const { userHasStoredCredentials } = await import('../db/database.js');
                hasStoredCredentials = userHasStoredCredentials(parsedUserId);
              }
            }
          } catch (unexpectedError) {
            console.error('Unexpected error checking user credentials in status endpoint:', unexpectedError);
            hasStoredCredentials = false; // Return false on error to avoid leaking info
          }
        } else {
          // For unauthenticated requests, don't reveal if any users have credentials
          // Return a safe generic value to avoid inference of global state
          hasStoredCredentials = null;
        }
      }

      const status = {
        serverRunning: true,
        nodeActive: context.node !== null,
        hasCredentials: hasStoredCredentials,
        relayCount: currentRelays.length,
        relays: currentRelays,
        timestamp: new Date().toISOString(),
        health: {
          isConnected: nodeHealth.isConnected,
          lastActivity: nodeHealth.lastActivity ? nodeHealth.lastActivity.toISOString() : null,
          lastConnectivityCheck: nodeHealth.lastConnectivityCheck ? nodeHealth.lastConnectivityCheck.toISOString() : null,
          consecutiveConnectivityFailures: nodeHealth.consecutiveConnectivityFailures,
          timeSinceLastActivity: nodeHealth.timeSinceLastActivity,
          timeSinceLastConnectivityCheck: nodeHealth.timeSinceLastConnectivityCheck
        }
      };
      return Response.json(status, { headers });
    } catch (error) {
      console.error('Status API Error:', error);
      return Response.json({ error: 'Failed to get status' }, { status: 500, headers });
    }
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
} 