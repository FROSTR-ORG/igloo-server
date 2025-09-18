import { RouteContext, RequestAuth } from './types.js';
import { getSecureCorsHeaders, readPublicEnvFile, getValidRelays, mergeVaryHeaders, parseUserId } from './utils.js';
import { getNodeHealth, getPublishMetrics } from '../node/manager.js';
import { HEADLESS, hasCredentials } from '../const.js';

export async function handleStatusRoute(req: Request, url: URL, context: RouteContext, auth?: RequestAuth | null): Promise<Response | null> {
  if (url.pathname !== '/api/status') return null;

  // Get secure CORS headers based on request origin
  const corsHeaders = getSecureCorsHeaders(req);
  
  const mergedVary = mergeVaryHeaders(corsHeaders);
  
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Vary': mergedVary,
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
            const parsedUserId = parseUserId(auth.userId);

            if (parsedUserId == null) {
              hasStoredCredentials = false;
            } else {
              // parseUserId now returns only number | string, both JSON-safe
              const isValid = typeof parsedUserId === 'string'
                ? /^\d+$/.test(parsedUserId) && BigInt(parsedUserId) > 0n
                : (Number.isFinite(parsedUserId) && Number.isSafeInteger(parsedUserId) && parsedUserId > 0);

              if (!isValid) {
                console.error('User ID validation error in status endpoint: not a positive integer');
                hasStoredCredentials = false;
              } else {
                // Lazy-load DB only in non-headless, authenticated path
                const { userHasStoredCredentials } = await import('../db/database.js');
                // Convert to bigint for database operation
                const dbUserId = typeof parsedUserId === 'string' ? BigInt(parsedUserId) : parsedUserId;
                hasStoredCredentials = userHasStoredCredentials(dbUserId);
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

      // Get publish metrics for monitoring
      const publishMetrics = getPublishMetrics();

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
        },
        publishMetrics: {
          totalAttempts: publishMetrics.totalAttempts,
          totalFailures: publishMetrics.totalFailures,
          failureRate: publishMetrics.failureRate,
          isAboveThreshold: publishMetrics.isAboveThreshold,
          windowAge: publishMetrics.windowAge,
          failuresByRelay: publishMetrics.failuresByRelay,
          failuresByReason: publishMetrics.failuresByReason
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