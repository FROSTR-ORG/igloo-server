import { RouteContext } from './types.js';
import { getSecureCorsHeaders } from './utils.js';
import { readEnvFile, getValidRelays } from './utils.js';
import { getNodeHealth } from '../node/manager.js';

export async function handleStatusRoute(req: Request, url: URL, context: RouteContext): Promise<Response | null> {
  if (url.pathname !== '/api/status') return null;

  // Get secure CORS headers based on request origin
  const corsHeaders = getSecureCorsHeaders(req);
  
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
  };

  if (req.method === 'GET') {
    try {
      // Get current relay count from environment or use default
      const env = await readEnvFile();
      const currentRelays = getValidRelays(env.RELAYS);
      
      // Get node health information
      const nodeHealth = getNodeHealth();
      
      const status = {
        serverRunning: true,
        nodeActive: context.node !== null,
        hasCredentials: !!(env.SHARE_CRED && env.GROUP_CRED),
        relayCount: currentRelays.length,
        relays: currentRelays,
        timestamp: new Date().toISOString(),
        health: {
          isHealthy: nodeHealth.isHealthy,
          lastActivity: nodeHealth.lastActivity ? nodeHealth.lastActivity.toISOString() : null,
          lastHealthCheck: nodeHealth.lastHealthCheck ? nodeHealth.lastHealthCheck.toISOString() : null,
          consecutiveFailures: nodeHealth.consecutiveFailures,
          restartCount: nodeHealth.restartCount,
          timeSinceLastActivity: nodeHealth.lastActivity ? Date.now() - nodeHealth.lastActivity.getTime() : null
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