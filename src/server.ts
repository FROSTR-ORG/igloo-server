import { serve, type ServerWebSocket } from 'bun';
import { randomUUID } from 'crypto';
import { cleanupBifrostNode } from '@frostr/igloo-core';
import { NostrRelay } from './class/relay.js';
import * as CONST from './const.js';
import { 
  handleRequest
} from './routes/index.js';
import type { 
  PeerStatus, 
  ServerBifrostNode,
  UpdateNodeOptions,
  NodeCredentialSnapshot
} from './routes/index.js';
import { assertNoSessionSecretExposure, isWebSocketOriginAllowed, getTrustedClientIp } from './routes/utils.js';
import {
  createBroadcastEvent,
  createAddServerLog,
  setupNodeEventListeners,
  createNodeWithCredentials,
  cleanupMonitoring,
  resetHealthMonitoring,
  sendSelfEcho
} from './node/manager.js';
import { initNip46Service, getNip46Service } from './nip46/index.js'
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
  return (
    lower.includes('blocked:') ||
    lower.includes('relay connection closed') ||
    lower.includes('connection closed') ||
    lower.includes('websocket is not open') ||
    lower.includes('socket not open') ||
    lower.includes('socket closed') ||
    lower.includes('econnreset') ||
    lower.includes('network error') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('publish timed out') ||
    lower.includes('relay publish timed out') ||
    lower.includes('policy violated') ||
    lower.includes('web of trust') ||
    lower.includes('policy violation')
  );
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

let node: ServerBifrostNode | null = null;

type ActiveNodeCredentials = {
  group: string;
  share: string;
  relaysEnv?: string;
  peerPoliciesRaw?: string;
  source: 'env' | 'dynamic';
};

const normalizeCredentialSnapshot = (
  snapshot: NodeCredentialSnapshot | null | undefined,
  fallbackSource: 'env' | 'dynamic' = 'dynamic'
): ActiveNodeCredentials | null => {
  if (!snapshot?.group || !snapshot?.share) {
    return null;
  }

  return {
    group: snapshot.group,
    share: snapshot.share,
    relaysEnv: snapshot.relaysEnv,
    peerPoliciesRaw: snapshot.peerPoliciesRaw,
    source: snapshot.source ?? fallbackSource
  };
};

const buildEnvCredentialSnapshot = (): ActiveNodeCredentials | null => {
  if (!CONST.hasCredentials()) {
    return null;
  }

  return normalizeCredentialSnapshot(
    {
      group: CONST.GROUP_CRED!,
      share: CONST.SHARE_CRED!,
      relaysEnv: process.env.RELAYS,
      peerPoliciesRaw: process.env.PEER_POLICIES,
      source: 'env'
    },
    'env'
  );
};

let activeCredentials: ActiveNodeCredentials | null = buildEnvCredentialSnapshot();
const restartState = { blockedByCredentials: false };

// Create event management functions
const broadcastEvent = createBroadcastEvent(eventStreams);
const addServerLog = createAddServerLog(broadcastEvent);
initNip46Service({
  addServerLog,
  broadcastEvent,
  getNode: () => node
});

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

  const envSnapshot = buildEnvCredentialSnapshot();
  const credentialsToUse = activeCredentials ?? envSnapshot;

  if (!credentialsToUse) {
    addServerLog('error', 'Node restart aborted: no active credentials available');
    restartState.blockedByCredentials = true;
    currentRetryCount = 0;
    return;
  }

  const credentialSnapshot: ActiveNodeCredentials = { ...credentialsToUse };

  isRestartInProgress = true;
  restartState.blockedByCredentials = false;
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
    
    const newNode = await createNodeWithCredentials(
      credentialSnapshot.group,
      credentialSnapshot.share,
      credentialSnapshot.relaysEnv,
      addServerLog,
      credentialSnapshot.peerPoliciesRaw
    );

    if (newNode) {
      node = newNode;
      activeCredentials = credentialSnapshot;
      restartState.blockedByCredentials = false;
      setupNodeEventListeners(node, addServerLog, broadcastEvent, peerStatuses, () => {
        // Controlled restart callback to prevent infinite recursion
        scheduleRestartWithBackoff('watchdog timeout');
      }, credentialSnapshot.group, credentialSnapshot.share);
      addServerLog('system', 'Node successfully restarted');
      
      // Reset retry count on successful restart
      currentRetryCount = 0;
      isRestartInProgress = false;
      return;
    } else {
      throw new Error('Failed to create new node - createNodeWithCredentials returned null');
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
  if (restartState.blockedByCredentials) {
    addServerLog('system', 'Restart scheduling skipped: waiting for credentials to be restored');
    currentRetryCount = 0;
    return;
  }

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
      addServerLog,
      process.env.PEER_POLICIES
    );
    
    if (node) {
      activeCredentials = normalizeCredentialSnapshot(
        {
          group: CONST.GROUP_CRED!,
          share: CONST.SHARE_CRED!,
          relaysEnv: process.env.RELAYS,
          peerPoliciesRaw: process.env.PEER_POLICIES,
          source: 'env'
        },
        'env'
      );
      restartState.blockedByCredentials = false;
      setupNodeEventListeners(node, addServerLog, broadcastEvent, peerStatuses, () => {
        // Node unhealthy callback
        scheduleRestartWithBackoff('watchdog timeout');
      }, activeCredentials?.group, activeCredentials?.share);

      if (CONST.HEADLESS) {
        sendSelfEcho(CONST.GROUP_CRED!, CONST.SHARE_CRED!, {
          relaysEnv: process.env.RELAYS,
          addServerLog,
          contextLabel: 'headless startup'
        }).catch((error) => {
          try { addServerLog('warn', 'Self-echo failed at headless startup', error); } catch {}
        });
      }
    }
  } catch (error) {
    addServerLog('error', 'Failed to create initial Bifrost node', error);
  }
} else {
  addServerLog('info', 'No credentials found, starting server without Bifrost node. Use the Configure page to set up credentials.');
}

// Create the updateNode function for privileged routes
const updateNode = (newNode: ServerBifrostNode | null, options?: UpdateNodeOptions) => {
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
    const normalized = options?.credentials
      ? normalizeCredentialSnapshot(options.credentials, options.credentials.source ?? 'dynamic')
      : activeCredentials ?? buildEnvCredentialSnapshot();
    activeCredentials = normalized;
    restartState.blockedByCredentials = false;
    setupNodeEventListeners(newNode, addServerLog, broadcastEvent, peerStatuses, () => {
      // Node unhealthy callback for dynamically created nodes
      scheduleRestartWithBackoff('dynamic node watchdog timeout');
    }, activeCredentials?.group, activeCredentials?.share);
  } else {
    if (options?.credentials === null) {
      activeCredentials = null;
    } else if (options?.credentials) {
      activeCredentials = normalizeCredentialSnapshot(options.credentials, options.credentials.source ?? 'dynamic');
    } else {
      activeCredentials = buildEnvCredentialSnapshot();
    }
    restartState.blockedByCredentials = false;
  }
};

// WebSocket connection accounting and basic message rate limiting (sanitize env inputs)
const parsedMaxConn = Number.parseInt(process.env.WS_MAX_CONNECTIONS_PER_IP ?? '', 10);
const WS_MAX_CONNECTIONS_PER_IP = Number.isFinite(parsedMaxConn) && parsedMaxConn > 0 ? parsedMaxConn : 5;
const parsedMsgRate = Number.parseInt(process.env.WS_MSG_RATE ?? '', 10);
const WS_MSG_RATE = Number.isFinite(parsedMsgRate) && parsedMsgRate > 0 ? parsedMsgRate : 20; // tokens per second
const parsedMsgBurst = Number.parseInt(process.env.WS_MSG_BURST ?? '', 10);
const WS_MSG_BURST = Number.isFinite(parsedMsgBurst) && parsedMsgBurst > 0
  ? Math.max(parsedMsgBurst, WS_MSG_RATE)
  : Math.max(WS_MSG_RATE, 40);
const WS_POLICY_CLOSE = 1008; // Policy violation

const wsConnectionsPerIp = new Map<string, number>();
const wsRateState = new WeakMap<ServerWebSocket<any>, { tokens: number; lastRefill: number }>();
const wsMeta = new WeakMap<ServerWebSocket<any>, { ip: string; counted: boolean }>();

function tryConsumeWsToken(ws: ServerWebSocket<any>): boolean {
  let state = wsRateState.get(ws);
  const now = Date.now();
  if (!state) {
    state = { tokens: WS_MSG_BURST, lastRefill: now };
    wsRateState.set(ws, state);
  }
  const elapsed = Math.max(0, now - state.lastRefill) / 1000;
  const refill = Math.floor(elapsed * WS_MSG_RATE);
  if (refill > 0) {
    state.tokens = Math.min(WS_MSG_BURST, state.tokens + refill);
    state.lastRefill = now;
  }
  if (state.tokens <= 0) return false;
  state.tokens -= 1;
  return true;
}

function incIp(ip: string | undefined) {
  const key = ip || 'unknown';
  const cur = wsConnectionsPerIp.get(key) || 0;
  wsConnectionsPerIp.set(key, cur + 1);
}
function decIp(ip: string | undefined) {
  const key = ip || 'unknown';
  const cur = wsConnectionsPerIp.get(key) || 0;
  const next = Math.max(0, cur - 1);
  if (next === 0) wsConnectionsPerIp.delete(key); else wsConnectionsPerIp.set(key, next);
}

// WebSocket handler for event streaming and Nostr relay
const websocketHandler = {
  message(ws: ServerWebSocket<any>, message: string | Buffer) {
    // Check if this is an event stream WebSocket or relay WebSocket
    if (ws.data?.isEventStream) {
      // Event stream is one-way; close on abuse
      if (!tryConsumeWsToken(ws)) {
        try { ws.close(WS_POLICY_CLOSE, 'Rate limit exceeded'); } catch {}
      }
      return;
    } else {
      if (!tryConsumeWsToken(ws)) {
        try { ws.close(WS_POLICY_CLOSE, 'Rate limit exceeded'); } catch {}
        return;
      }
      // Delegate to NostrRelay handler
      return relay.handler().message?.(ws, message);
    }
  },
  open(ws: ServerWebSocket<any>) {
    const ipFromData = (ws as any).data?.clientIp || 'unknown';
    wsMeta.set(ws, { ip: ipFromData, counted: true });
    if (ws.data?.isEventStream) {
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
    if (ws.data?.isEventStream) {
      eventStreams.delete(ws as ServerWebSocket<EventStreamData>);
    }
    const meta = wsMeta.get(ws);
    if (meta?.counted) {
      decIp(meta.ip);
      wsMeta.delete(ws);
    } else if ((ws as any).data?.counted) {
      // Fallback: open() may never have fired (client aborted after reservation),
      // so wsMeta is missing. Use the data attached during upgrade to release.
      decIp((ws as any).data?.clientIp);
    }
    if (!ws.data?.isEventStream) {
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
    const clientIp = getTrustedClientIp(req, server.requestIP(req)?.address);
    
    // Handle WebSocket upgrade for event stream
    if (url.pathname === '/api/events' && req.headers.get('upgrade') === 'websocket') {
      // WebSocket upgrade rate limit and Origin check
      const { authenticate, AUTH_CONFIG, checkRateLimit } = await import('./routes/auth.js');

      // Sanitize ws-upgrade rate limiter envs
      const wsWinSecRaw = process.env.RATE_LIMIT_WS_UPGRADE_WINDOW ?? process.env.RATE_LIMIT_WINDOW ?? '900';
      const wsWinSecParsed = Number.parseInt(wsWinSecRaw, 10);
      const wsUpWindow = Math.max(1000, (Number.isFinite(wsWinSecParsed) ? wsWinSecParsed : 900) * 1000);
      const wsMaxRaw = process.env.RATE_LIMIT_WS_UPGRADE_MAX ?? '30';
      const wsMaxParsed = Number.parseInt(wsMaxRaw, 10);
      const wsUpMax = Math.max(1, Number.isFinite(wsMaxParsed) ? wsMaxParsed : 30);
      try {
        const rl = await checkRateLimit(req, 'ws-upgrade', { clientIp, windowMs: wsUpWindow, max: wsUpMax });
        if (!rl.allowed) {
          return new Response('Too many WebSocket attempts', { status: 429 });
        }
      } catch {
        // If limiter unavailable, fail closed conservatively
        return new Response('Service temporarily unavailable', { status: 503 });
      }

      const originCheck = isWebSocketOriginAllowed(req);
      if (!originCheck.allowed) {
        return new Response('Forbidden', { status: 403 });
      }

      let selectedSubprotocol: string | undefined;
      if (AUTH_CONFIG.ENABLED) {
        // Build an auth request by first mapping legacy query params to headers (compat),
        // then mapping Sec-WebSocket-Protocol hints.
        let authReq = req;
        const qpHeaders = new Headers(req.headers);
        let qpTouched = false;
        const qpApiKey = url.searchParams.get('apiKey');
        const qpSessionId = url.searchParams.get('sessionId');
        if (qpApiKey) { qpHeaders.set('X-API-Key', qpApiKey); qpTouched = true; }
        if (qpSessionId) { qpHeaders.set('X-Session-ID', qpSessionId); qpTouched = true; }
        if (qpTouched) {
          authReq = new Request(req.url, { method: req.method, headers: qpHeaders });
        }

        // Parse optional credentials from Sec-WebSocket-Protocol (for non-browser clients)
        const proto = req.headers.get('sec-websocket-protocol');
        if (proto) {
          const headers = new Headers(authReq.headers);
          const offered = proto.split(',').map(p => p.trim()).filter(Boolean);
          // Choose the first offered value to echo back (required by RFC6455)
          if (offered.length > 0) {
            selectedSubprotocol = offered[0];
          }
          for (const raw of offered) {
            const token = raw.trim();
            if (!token) continue;
            // Supported hints: apikey.<token>, api-key.<token>, bearer.<token>, session.<id>
            const lower = token.toLowerCase();
            if (lower.startsWith('apikey.') || lower.startsWith('api-key.')) {
              headers.set('X-API-Key', token.substring(token.indexOf('.') + 1));
            } else if (lower.startsWith('bearer.')) {
              headers.set('Authorization', `Bearer ${token.substring(token.indexOf('.') + 1)}`);
            } else if (lower.startsWith('session.')) {
              headers.set('X-Session-ID', token.substring(token.indexOf('.') + 1));
            }
          }
          authReq = new Request(req.url, { method: req.method, headers });
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
      
      // Pre-upgrade per-IP cap with reservation to prevent concurrent bypass
      const ipKey = clientIp || 'unknown';
      const current = wsConnectionsPerIp.get(ipKey) || 0;
      if (current >= WS_MAX_CONNECTIONS_PER_IP) {
        return new Response('Too many connections from your IP', { status: 429 });
      }
      incIp(ipKey);

      const upgradeHeaders: Record<string, string> = {};
      if (selectedSubprotocol) upgradeHeaders['Sec-WebSocket-Protocol'] = selectedSubprotocol;

      const upgraded = server.upgrade(req, {
        data: { isEventStream: true, clientIp, counted: true },
        headers: upgradeHeaders
      });
      
      if (upgraded) {
        return undefined; // WebSocket upgrade successful
      } else {
        // WebSocket upgrade failed; release reservation
        decIp(ipKey);
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
      // Origin and per-IP protections for relay WS
      const { checkRateLimit } = await import('./routes/auth.js');
      const wsWinSecRaw2 = process.env.RATE_LIMIT_WS_UPGRADE_WINDOW ?? process.env.RATE_LIMIT_WINDOW ?? '900';
      const wsWinSecParsed2 = Number.parseInt(wsWinSecRaw2, 10);
      const wsUpWindow = Math.max(1000, (Number.isFinite(wsWinSecParsed2) ? wsWinSecParsed2 : 900) * 1000);
      const wsMaxRaw2 = process.env.RATE_LIMIT_WS_UPGRADE_MAX ?? '30';
      const wsMaxParsed2 = Number.parseInt(wsMaxRaw2, 10);
      const wsUpMax = Math.max(1, Number.isFinite(wsMaxParsed2) ? wsMaxParsed2 : 30);
      try {
        const rl = await checkRateLimit(req, 'ws-upgrade', { clientIp, windowMs: wsUpWindow, max: wsUpMax });
        if (!rl.allowed) return new Response('Too many WebSocket attempts', { status: 429 });
      } catch { return new Response('Service temporarily unavailable', { status: 503 }); }

      const originCheck = isWebSocketOriginAllowed(req);
      if (!originCheck.allowed) return new Response('Forbidden', { status: 403 });

      const ipKey2 = clientIp || 'unknown';
      const current = wsConnectionsPerIp.get(ipKey2) || 0;
      if (current >= WS_MAX_CONNECTIONS_PER_IP) return new Response('Too many connections from your IP', { status: 429 });
      incIp(ipKey2);

      // Echo the first offered subprotocol if present (even though relay doesn't consume it)
      let relaySelectedProto: string | undefined;
      const protoOffer = req.headers.get('sec-websocket-protocol');
      if (protoOffer) {
        const offered = protoOffer.split(',').map(p => p.trim()).filter(Boolean);
        if (offered.length > 0) relaySelectedProto = offered[0];
      }
      const relayUpgradeHeaders: Record<string, string> = {};
      if (relaySelectedProto) relayUpgradeHeaders['Sec-WebSocket-Protocol'] = relaySelectedProto;

      const upgraded = server.upgrade(req, {
        data: { isEventStream: false, clientIp, counted: true },
        headers: relayUpgradeHeaders
      });
      
      if (upgraded) {
        return undefined; // WebSocket upgrade successful
      } else {
        // WebSocket upgrade failed; release reservation
        decIp(ipKey2);
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
      clientIp,
      restartState
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
      if (err?.code === 'RATE_LIMITER_UNAVAILABLE') {
        const status = typeof err.status === 'number' ? err.status : 503;
        return buildJsonError({ error: err.message, code: err.code }, status, requestId);
      }
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

  const service = getNip46Service();
  if (service) {
    try {
      await service.stop();
    } catch (error) {
      addServerLog('error', 'Error stopping NIP-46 service', error);
    }
  }

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
