import { serve, type ServerWebSocket } from 'bun';
import { randomUUID } from 'crypto';
import { cleanupBifrostNode } from '@frostr/igloo-core';
import { NostrRelay } from './class/relay.js';
import * as CONST from './const.js';
import { 
  handleRequest, 
  PeerStatus, 
  ServerBifrostNode 
} from './routes/index.js';
import { assertNoSessionSecretExposure } from './routes/utils.js';
import { 
  createBroadcastEvent,
  createAddServerLog, 
  setupNodeEventListeners, 
  createNodeWithCredentials,
  cleanupMonitoring,
  resetHealthMonitoring
} from './node/manager.js';
import { clearCleanupTimers } from './routes/node-manager.js';

// Node restart configuration with validation
const parseRestartConfig = () => {
  const initialRetryDelay = parseInt(process.env.NODE_RESTART_DELAY || '30000');
  const maxRetryAttempts = parseInt(process.env.NODE_MAX_RETRIES || '5');
  const backoffMultiplier = parseFloat(process.env.NODE_BACKOFF_MULTIPLIER || '1.5');
  const maxRetryDelay = parseInt(process.env.NODE_MAX_RETRY_DELAY || '300000');

  // Validation with safe defaults
  const validatedConfig = {
    INITIAL_RETRY_DELAY: (initialRetryDelay > 0 && initialRetryDelay <= 3600000) ? initialRetryDelay : 30000, // 1ms to 1 hour max
    MAX_RETRY_ATTEMPTS: (maxRetryAttempts > 0 && maxRetryAttempts <= 100) ? maxRetryAttempts : 5, // 1 to 100 attempts max
    BACKOFF_MULTIPLIER: (backoffMultiplier >= 1.0 && backoffMultiplier <= 10) ? backoffMultiplier : 1.5, // 1.0 to 10x multiplier
    MAX_RETRY_DELAY: (maxRetryDelay > 0 && maxRetryDelay <= 7200000) ? maxRetryDelay : 300000, // 1ms to 2 hours max
  };

  // Log validation warnings if defaults were used
  if (initialRetryDelay !== validatedConfig.INITIAL_RETRY_DELAY) {
    console.warn(`Invalid NODE_RESTART_DELAY: ${initialRetryDelay}. Using default: ${validatedConfig.INITIAL_RETRY_DELAY}ms`);
  }
  if (maxRetryAttempts !== validatedConfig.MAX_RETRY_ATTEMPTS) {
    console.warn(`Invalid NODE_MAX_RETRIES: ${maxRetryAttempts}. Using default: ${validatedConfig.MAX_RETRY_ATTEMPTS}`);
  }
  if (backoffMultiplier !== validatedConfig.BACKOFF_MULTIPLIER) {
    console.warn(`Invalid NODE_BACKOFF_MULTIPLIER: ${backoffMultiplier}. Using default: ${validatedConfig.BACKOFF_MULTIPLIER}`);
  }
  if (maxRetryDelay !== validatedConfig.MAX_RETRY_DELAY) {
    console.warn(`Invalid NODE_MAX_RETRY_DELAY: ${maxRetryDelay}. Using default: ${validatedConfig.MAX_RETRY_DELAY}ms`);
  }

  return validatedConfig;
};

const RESTART_CONFIG = parseRestartConfig();

// Error circuit breaker configuration
function parseErrorCircuitConfig() {
  const windowMs = parseInt(process.env.ERROR_CIRCUIT_WINDOW_MS || '60000');
  const threshold = parseInt(process.env.ERROR_CIRCUIT_THRESHOLD || '10');
  const exitCode = parseInt(process.env.ERROR_CIRCUIT_EXIT_CODE || '1');

  const validated = {
    WINDOW_MS: (windowMs > 1000 && windowMs <= 3600000) ? windowMs : 60000,
    THRESHOLD: (threshold > 0 && threshold <= 1000) ? threshold : 10,
    EXIT_CODE: (exitCode >= 0 && exitCode <= 255) ? exitCode : 1
  } as const;

  if (windowMs !== validated.WINDOW_MS) {
    console.warn(`Invalid ERROR_CIRCUIT_WINDOW_MS: ${windowMs}. Using default: ${validated.WINDOW_MS}ms`);
  }
  if (threshold !== validated.THRESHOLD) {
    console.warn(`Invalid ERROR_CIRCUIT_THRESHOLD: ${threshold}. Using default: ${validated.THRESHOLD}`);
  }
  if (exitCode !== validated.EXIT_CODE) {
    console.warn(`Invalid ERROR_CIRCUIT_EXIT_CODE: ${exitCode}. Using default: ${validated.EXIT_CODE}`);
  }

  return validated;
}

const ERROR_CIRCUIT_CONFIG = parseErrorCircuitConfig();

// Unhandled error tracking state
let unhandledErrorTimestamps: number[] = [];
let isCircuitBreakerTripped = false;
let circuitBreakerExitCode: number | null = null;

function isBenignRelayErrorMessage(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes('blocked:');
}

function recordUnhandledErrorAndMaybeExit(source: string, message: string) {
  try {
    const now = Date.now();
    const windowStart = now - ERROR_CIRCUIT_CONFIG.WINDOW_MS;
    unhandledErrorTimestamps = unhandledErrorTimestamps.filter(ts => ts >= windowStart);
    unhandledErrorTimestamps.push(now);

    const count = unhandledErrorTimestamps.length;
    addServerLog('error', `${source}: ${message}`);

    if (!isCircuitBreakerTripped && count >= ERROR_CIRCUIT_CONFIG.THRESHOLD) {
      isCircuitBreakerTripped = true;
      const seconds = Math.round(ERROR_CIRCUIT_CONFIG.WINDOW_MS / 1000);
      addServerLog('error', `Unhandled error circuit breaker tripped (${count}/${ERROR_CIRCUIT_CONFIG.THRESHOLD} in ${seconds}s). Exiting with code ${ERROR_CIRCUIT_CONFIG.EXIT_CODE}.`);
      circuitBreakerExitCode = ERROR_CIRCUIT_CONFIG.EXIT_CODE;
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10);
    }
  } catch {
    // As a last resort, do not throw from the error handler
  }
}

// Define expected database module interface
interface DatabaseModule {
  isDatabaseInitialized(): boolean;
  closeDatabase(): Promise<void>;
}

// Store database module reference at module scope
let dbModule: DatabaseModule | null = null;

// WebSocket data type for event streams
type EventStreamData = { isEventStream: true };

// Event streaming for frontend - WebSocket connections
const eventStreams = new Set<ServerWebSocket<EventStreamData>>();

// Peer status tracking
let peerStatuses = new Map<string, PeerStatus>();



// Create event management functions
const broadcastEvent = createBroadcastEvent(eventStreams);
const addServerLog = createAddServerLog(broadcastEvent);

// Removed global nostr-tools SimplePool monkey-patch in favor of proxy-based instrumentation
// See: src/node/manager.ts createInstrumentedNode/createInstrumentedClient/createInstrumentedPool

// Global error guards with circuit breaker
process.on('unhandledRejection', (reason: any) => {
  try {
    const msg = reason instanceof Error ? reason.message : String(reason);
    if (isBenignRelayErrorMessage(msg)) {
      addServerLog('warning', `Relay publish rejected: ${msg}`);
      return;
    }
    recordUnhandledErrorAndMaybeExit('Unhandled promise rejection', msg);
  } catch {}
});

process.on('uncaughtException', (err: any) => {
  try {
    const msg = err instanceof Error ? err.message : String(err);
    if (isBenignRelayErrorMessage(msg)) {
      addServerLog('warning', `Relay publish rejected (exception): ${msg}`);
      return;
    }
    recordUnhandledErrorAndMaybeExit('Uncaught exception', msg);
  } catch {}
});

// Bun/whatwg-style global handlers (some rejections/errors arrive here instead of process)
try {
  globalThis.addEventListener?.('unhandledrejection', (ev: any) => {
    try {
      const msg = ev?.reason instanceof Error ? ev.reason.message : String(ev?.reason ?? 'unknown');
      if (typeof ev?.preventDefault === 'function') ev.preventDefault();
      if (isBenignRelayErrorMessage(msg)) {
        addServerLog('warning', `Relay publish rejected: ${msg}`);
        return;
      }
      recordUnhandledErrorAndMaybeExit('Unhandled promise rejection (global)', msg);
    } catch {}
  });
  globalThis.addEventListener?.('error', (ev: any) => {
    try {
      const msg = ev?.error instanceof Error ? ev.error.message : String(ev?.message ?? 'unknown');
      if (typeof ev?.preventDefault === 'function') ev.preventDefault();
      if (isBenignRelayErrorMessage(msg)) {
        addServerLog('warning', `Relay publish rejected (global error): ${msg}`);
        return;
      }
      recordUnhandledErrorAndMaybeExit('Global error', msg);
    } catch {}
  });
} catch {}

// Fail fast if forbidden env keys are accidentally exposed via utils configuration
assertNoSessionSecretExposure();

// Database initialization function with error propagation
async function initializeDatabase(): Promise<void> {
  if (CONST.HEADLESS) {
    console.log('⚙️  Headless mode enabled - using environment variables for configuration');
    return;
  }

  // Attempt dynamic import of the database module with explicit error handling
  const validationErrors: string[] = [];
  let importedModule: any = null;

  try {
    importedModule = await import('./db/database.js');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    validationErrors.push(`dynamic import error: ${message}`);
  }

  if (!importedModule) {
    validationErrors.push('module failed to load');
  } else {
    if (typeof importedModule.isDatabaseInitialized !== 'function') {
      validationErrors.push('isDatabaseInitialized export missing or not a function');
    }
    if (typeof importedModule.closeDatabase !== 'function') {
      validationErrors.push('closeDatabase export missing or not a function');
    }
  }

  if (validationErrors.length > 0) {
    throw new Error(`Database module validation failed: ${validationErrors.join(', ')}`);
  }

  dbModule = importedModule as unknown as DatabaseModule;
  console.log('🗄️  Database mode enabled - using SQLite for user management');

  // Enforce ADMIN_SECRET only on first-run (when database is uninitialized)
  const isSecretInvalid = !CONST.ADMIN_SECRET || CONST.ADMIN_SECRET === 'REQUIRED_ADMIN_SECRET_NOT_SET';

  try {
    if (!dbModule) {
      throw new Error('Database module is not loaded');
    }

    const initialized = dbModule.isDatabaseInitialized();

    if (!initialized && isSecretInvalid) {
      throw new Error(
        'ADMIN_SECRET is not set or is invalid for initial setup.\n' +
        'A secure ADMIN_SECRET is required when the database is uninitialized.\n' +
        '1. Generate a secure secret: openssl rand -hex 32\n' +
        '2. Set it in your .env file or as an environment variable.'
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('ADMIN_SECRET')) {
      throw err; // Re-throw ADMIN_SECRET errors
    }

    // Treat other errors as "not initialized" to enforce onboarding
    if (isSecretInvalid) {
      throw new Error(
        'Database check failed, and ADMIN_SECRET is not set or is invalid.\n' +
        'A secure ADMIN_SECRET is required for recovery or initial setup.'
      );
    }

    // Log non-critical database errors but continue
    console.error('⚠️  Database initialization check error:', err instanceof Error ? err.message : String(err));
  }

  // Initialize NIP-46 database migrations on startup (no side effects on import)
  try {
    const { initializeNip46DB } = await import('./db/nip46.js');
    await initializeNip46DB();
  } catch (e: any) {
    // Log but don't fail - NIP-46 is not critical for startup
    console.error('⚠️  Failed to initialize NIP-46 database:', e?.message || e);
  }

  // Initialize persistent rate limiter with database connection
  try {
    const dbDefault = await import('./db/database.js');
    const { initializeRateLimiter } = await import('./utils/rate-limiter.js');
    initializeRateLimiter(dbDefault.default);
    console.log('✅ Persistent rate limiting initialized');
  } catch (e: any) {
    // Log but don't fail - fallback to in-memory rate limiting
    console.error('⚠️  Failed to initialize persistent rate limiter, using in-memory fallback:', e?.message || e);
  }
}

// Initialize database with single exit point
initializeDatabase().catch((err) => {
  console.error('❌ Fatal initialization error:');
  console.error('  ', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

// Create the Nostr relay
const relay = new NostrRelay();

// Create and connect the Bifrost node using igloo-core only if credentials are available
let node: ServerBifrostNode | null = null;

// Node restart state management
let isRestartInProgress = false;
let currentRetryCount = 0;
let restartTimeout: ReturnType<typeof setTimeout> | null = null;

// Node restart logic with concurrency control and exponential backoff
async function restartNode(reason: string = 'health check failure', forceRestart: boolean = false) {
  // Prevent concurrent restarts unless forced
  if (isRestartInProgress && !forceRestart) {
    addServerLog('warn', `Restart already in progress, skipping restart request: ${reason}`);
    return;
  }
  
  // Clear any pending restart timeout
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }
  
  isRestartInProgress = true;
  addServerLog('system', `Restarting node due to: ${reason} (attempt ${currentRetryCount + 1}/${RESTART_CONFIG.MAX_RETRY_ATTEMPTS})`);
  
  try {
    // Clean up existing node
    if (node) {
      try {
        cleanupBifrostNode(node);
      } catch (err) {
        addServerLog('warn', 'Failed to clean up previous node during restart', err);
      }
    }
    
    // Clean up health monitoring
    cleanupMonitoring();
    
    // Reset health monitoring state for fresh start
    resetHealthMonitoring();
    
    // Clear peer statuses
    peerStatuses.clear();
    
    // Wait a moment before recreating
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Recreate node if we have credentials
    if (CONST.hasCredentials()) {
      const newNode = await createNodeWithCredentials(
        CONST.GROUP_CRED!,
        CONST.SHARE_CRED!,
        process.env.RELAYS,
        addServerLog
      );
      
      if (newNode) {
        node = newNode;
        setupNodeEventListeners(node, addServerLog, broadcastEvent, peerStatuses, () => {
          // Controlled restart callback to prevent infinite recursion
          scheduleRestartWithBackoff('watchdog timeout');
        }, CONST.GROUP_CRED, CONST.SHARE_CRED);
        addServerLog('system', 'Node successfully restarted');
        
        // Reset retry count on successful restart
        currentRetryCount = 0;
        isRestartInProgress = false;
        return;
      } else {
        throw new Error('Failed to create new node - createNodeWithCredentials returned null');
      }
    } else {
      throw new Error('Cannot restart node - no credentials available');
    }
  } catch (error) {
    addServerLog('error', 'Error during node restart', error);
    
    // Schedule retry with exponential backoff if we haven't exceeded max attempts
    scheduleRestartWithBackoff(reason);
  } finally {
    isRestartInProgress = false;
  }
}

// Schedule restart with exponential backoff and retry limit
function scheduleRestartWithBackoff(reason: string) {
  if (currentRetryCount >= RESTART_CONFIG.MAX_RETRY_ATTEMPTS) {
    addServerLog('error', `Max restart attempts (${RESTART_CONFIG.MAX_RETRY_ATTEMPTS}) exceeded. Node restart abandoned.`);
    currentRetryCount = 0;
    return;
  }
  
  // Prevent duplicate scheduled restarts
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }
  
  // Calculate delay with exponential backoff
  const baseDelay = RESTART_CONFIG.INITIAL_RETRY_DELAY;
  const backoffDelay = Math.min(
    baseDelay * Math.pow(RESTART_CONFIG.BACKOFF_MULTIPLIER, currentRetryCount),
    RESTART_CONFIG.MAX_RETRY_DELAY
  );
  
  addServerLog('system', `Scheduling restart in ${Math.round(backoffDelay / 1000)}s (attempt ${currentRetryCount + 1}/${RESTART_CONFIG.MAX_RETRY_ATTEMPTS})`);
  
  currentRetryCount++;
  
  restartTimeout = setTimeout(() => {
    restartNode(`retry: ${reason}`, false);
  }, backoffDelay);
}

// Initial node setup
if (CONST.hasCredentials()) {
  addServerLog('info', 'Creating and connecting node...');
  try {
    node = await createNodeWithCredentials(
      CONST.GROUP_CRED!,
      CONST.SHARE_CRED!,
      process.env.RELAYS,
      addServerLog
    );
    
    if (node) {
              setupNodeEventListeners(node, addServerLog, broadcastEvent, peerStatuses, () => {
          // Node unhealthy callback
          scheduleRestartWithBackoff('watchdog timeout');
        }, CONST.GROUP_CRED, CONST.SHARE_CRED);
    }
  } catch (error) {
    addServerLog('error', 'Failed to create initial Bifrost node', error);
  }
} else {
  addServerLog('info', 'No credentials found, starting server without Bifrost node. Use the Configure page to set up credentials.');
}

// Create the updateNode function for privileged routes
const updateNode = (newNode: ServerBifrostNode | null) => {
  // Clean up the old node to prevent memory leaks
  if (node) {
    try {
      cleanupBifrostNode(node);
    } catch (err) {
      addServerLog('warn', 'Failed to clean up previous node', err);
    }
  }
  
  // Clean up health monitoring
  cleanupMonitoring();
  
  // Reset health monitoring state for fresh start
  resetHealthMonitoring();
  
  node = newNode;
  if (newNode) {
    setupNodeEventListeners(newNode, addServerLog, broadcastEvent, peerStatuses, () => {
      // Node unhealthy callback for dynamically created nodes
      scheduleRestartWithBackoff('dynamic node watchdog timeout');
    }, CONST.GROUP_CRED, CONST.SHARE_CRED);
  }
};

// WebSocket handler for event streaming and Nostr relay
const websocketHandler = {
  message(ws: ServerWebSocket<any>, message: string | Buffer) {
    // Check if this is an event stream WebSocket or relay WebSocket
    if (ws.data?.isEventStream) {
      // Handle event stream WebSocket messages if needed
      // Currently, event stream is one-way (server to client)
      return;
    } else {
      // Delegate to NostrRelay handler
      return relay.handler().message?.(ws, message);
    }
  },
  open(ws: ServerWebSocket<any>) {
    // Check if this is an event stream WebSocket
    if (ws.data?.isEventStream) {
      // Add to event streams (with type assertion for compatibility)
      eventStreams.add(ws as ServerWebSocket<EventStreamData>);
      
      // Send initial connection event
      const connectEvent = {
        type: 'system',
        message: 'Connected to event stream',
        timestamp: new Date().toLocaleTimeString(),
        id: Math.random().toString(36).substring(2, 11)
      };
      
      try {
        ws.send(JSON.stringify(connectEvent));
      } catch (error) {
        console.error('Error sending initial event:', error);
      }
    } else {
      // Delegate to NostrRelay handler
      return relay.handler().open?.(ws);
    }
  },
  close(ws: ServerWebSocket<any>, code: number, reason: string) {
    // Check if this is an event stream WebSocket
    if (ws.data?.isEventStream) {
      // Remove from event streams (with type assertion for compatibility)
      eventStreams.delete(ws as ServerWebSocket<EventStreamData>);
    } else {
      // Delegate to NostrRelay handler
      return relay.handler().close?.(ws, code, reason);
    }
  },
  error(ws: ServerWebSocket<any>, error: Error) {
    // Check if this is an event stream WebSocket
    if (ws.data?.isEventStream) {
      console.error('Event stream WebSocket error:', error);
      // Remove from event streams to prevent further errors (with type assertion)
      eventStreams.delete(ws as ServerWebSocket<EventStreamData>);
    } else {
      // Delegate to NostrRelay handler if it has an error method
      const relayHandler = relay.handler();
      if ('error' in relayHandler && typeof relayHandler.error === 'function') {
        return relayHandler.error(ws, error);
      } else {
        console.error('Relay WebSocket error:', error);
      }
    }
  }
};

// Store server reference for graceful shutdown
function buildJsonError(body: any, status = 500, requestId?: string): Response {
  const payload = {
    code: body?.code || 'INTERNAL_ERROR',
    error: body?.error || 'Internal server error',
    requestId,
    ...(process.env.NODE_ENV !== 'production' && body?.detail ? { detail: body.detail } : {})
  };
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(requestId ? { 'X-Request-ID': requestId } : {}),
      'Cache-Control': 'no-store'
    }
  });
}

const server = serve({
  port: CONST.HOST_PORT,
  hostname: CONST.HOST_NAME,
  websocket: websocketHandler,
  fetch: async (req, server) => {
    // Reject new requests during shutdown
    if (isShuttingDown) {
      return new Response('Server is shutting down', { status: 503 });
    }

    const url = new URL(req.url);
    const requestId = randomUUID();
    const clientIp = server.requestIP(req)?.address;
    
    // Handle WebSocket upgrade for event stream
    if (url.pathname === '/api/events' && req.headers.get('upgrade') === 'websocket') {
      // Check authentication for WebSocket upgrade
      const { authenticate, AUTH_CONFIG } = await import('./routes/auth.js');
      
      if (AUTH_CONFIG.ENABLED) {
        // For WebSocket, check URL parameters for auth info since headers may not be available
        const apiKey = url.searchParams.get('apiKey');
        const sessionId = url.searchParams.get('sessionId');
        
        let authReq = req;
        
        // If we have URL parameters, create a modified request with the auth headers
        if (apiKey) {
          const headers = new Headers(req.headers);
          headers.set('X-API-Key', apiKey);
          authReq = new Request(req.url, {
            method: req.method,
            headers: headers
            // Note: WebSocket upgrade requests should not have bodies
          });
        } else if (sessionId) {
          const headers = new Headers(req.headers);
          headers.set('X-Session-ID', sessionId);
          authReq = new Request(req.url, {
            method: req.method,
            headers: headers
            // Note: WebSocket upgrade requests should not have bodies
          });
        }
        
        const authResult = await authenticate(authReq);
        if (!authResult.authenticated) {
          return new Response('Unauthorized', { 
            status: 401,
            headers: {
              'Content-Type': 'text/plain',
              'WWW-Authenticate': 'Bearer realm="WebSocket"'
            }
          });
        }
      }
      
      const upgraded = server.upgrade(req, {
        data: { isEventStream: true }
      });
      
      if (upgraded) {
        return undefined; // WebSocket upgrade successful
      } else {
        // WebSocket upgrade failed
        return new Response('WebSocket upgrade failed', { 
          status: 400,
          headers: {
            'Content-Type': 'text/plain'
          }
        });
      }
    }
    
    // Handle WebSocket upgrade for Nostr relay
    if (url.pathname === '/' && req.headers.get('upgrade') === 'websocket') {
      const upgraded = server.upgrade(req, {
        data: { isEventStream: false }
      });
      
      if (upgraded) {
        return undefined; // WebSocket upgrade successful
      } else {
        // WebSocket upgrade failed
        return new Response('WebSocket upgrade failed', { 
          status: 400,
          headers: {
            'Content-Type': 'text/plain'
          }
        });
      }
    }

    // Create base (restricted) context for general routes
    const baseContext = {
      node,
      peerStatuses,
      eventStreams,
      addServerLog,
      broadcastEvent,
      requestId,
      clientIp
    };

    // Create privileged context with updateNode for trusted routes  
    const privilegedContext = {
      ...baseContext,
      updateNode
    };

    // Handle the request using the unified router with appropriate context
    try {
      const resp = await handleRequest(req, url, baseContext, privilegedContext);
      return resp;
    } catch (err: any) {
      // Convert unhandled errors into a structured JSON error with correlation id
      const message = err?.message || String(err);
      try {
        addServerLog('error', 'Unhandled route error', { requestId, path: url.pathname, method: req.method, message });
      } catch {}
      return buildJsonError({ error: 'Unexpected server error', code: 'UNHANDLED_EXCEPTION', detail: message }, 500, requestId);
    }
  }
});

console.log(`Server running at ${CONST.HOST_NAME}:${CONST.HOST_PORT}`);
addServerLog('info', `Server running at ${CONST.HOST_NAME}:${CONST.HOST_PORT}`);

// Note: Node event listeners are already set up in setupNodeEventListeners() if node exists
if (!node) {
  addServerLog('info', 'Node not initialized - credentials not available. Server is ready for configuration.');
}

// Security validation for production deployments
if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
  console.error('\n⚠️  SECURITY WARNING: Running in production without ALLOWED_ORIGINS configured!');
  console.error('   CORS requests will be blocked. Set ALLOWED_ORIGINS environment variable to enable CORS.');
  console.error('   Example: ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com\n');
  addServerLog('warning', 'Production deployment without ALLOWED_ORIGINS - CORS will be blocked');
}

// Shared database cleanup function
async function cleanupDatabase(): Promise<void> {
  if (!CONST.HEADLESS && dbModule && dbModule.closeDatabase) {
    try {
      // Add 10-second timeout to prevent hanging
      await Promise.race([
        Promise.resolve(dbModule.closeDatabase()),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database close timeout after 10 seconds')), 10000)
        )
      ]);
    } catch (err) {
      console.error('Error during database close:', err);
    }
  }
}

// Shutdown state to prevent new requests during cleanup
let isShuttingDown = false;

// Unified shutdown handler for both SIGTERM and SIGINT
async function handleShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return; // Prevent duplicate shutdown
  isShuttingDown = true;

  addServerLog('system', `Received ${signal}, shutting down gracefully`);

  // Stop accepting new connections
  try {
    server.stop();
    addServerLog('system', 'Server stopped accepting new connections');
  } catch (err) {
    addServerLog('error', 'Error stopping server', err);
  }

  // Clear any pending restart timeout
  if (restartTimeout) {
    clearTimeout(restartTimeout);
    restartTimeout = null;
  }

  cleanupMonitoring();
  clearCleanupTimers();

  // Clean up rate limiter
  try {
    const { cleanupRateLimiter } = await import('./utils/rate-limiter.js');
    cleanupRateLimiter();
    addServerLog('system', 'Rate limiter cleaned up');
  } catch (err) {
    addServerLog('error', 'Error cleaning up rate limiter', err);
  }

  // Clean up auth timers and vault
  try {
    const { stopAuthCleanup } = await import('./routes/auth.js');
    stopAuthCleanup();
    addServerLog('system', 'Auth cleanup completed');
  } catch (err) {
    addServerLog('error', 'Error cleaning up auth', err);
  }

  await cleanupDatabase();

  process.exit(circuitBreakerExitCode ?? 0);
}

// Graceful shutdown handling
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
