import { 
  createAndConnectNode, 
  createConnectedNode,
  normalizePubkey,
  extractSelfPubkeyFromCredentials,
  normalizeNodePolicies
} from '@frostr/igloo-core';
import type { NodePolicyInput } from '@frostr/igloo-core';
import type { ServerBifrostNode, PeerStatus, PingResult } from '../routes/types.js';
import { getValidRelays, safeStringify, getOpTimeoutMs } from '../routes/utils.js';
import { loadFallbackPeerPolicies } from './peer-policy-store.js';
import { mergePolicyInputs } from '../util/peer-policy.js';
import type { ServerWebSocket } from 'bun';
import { SimplePool, finalizeEvent, generateSecretKey } from 'nostr-tools';

// Control whether we swallow "benign" relay publish errors (policy rejections, WOT blocks, etc.).
// Defaults to true to keep the signer resilient; set NODE_ALLOW_BENIGN_PUBLISH_SWALLOW=false to surface rejections.
const ALLOW_BENIGN_PUBLISH_SWALLOW = (() => {
  const raw = process.env.NODE_ALLOW_BENIGN_PUBLISH_SWALLOW ?? process.env.RELAY_ALLOW_BENIGN_SWALLOW;
  if (raw === undefined) return true;
  const normalized = String(raw).trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  return true;
})();

const isBenignPublishError = (reason: string | undefined): boolean => {
  if (!reason) return false;
  const lower = reason.toLowerCase();
  return (
    lower.includes('policy violated') ||
    lower.includes('web of trust') ||
    lower.includes('blocked:') ||
    lower.includes('publish timed out') ||
    lower.includes('relay publish timed out') ||
    lower.includes('relay connection closed') ||
    lower.includes('relay connection errored') ||
    lower.includes('connection closed') ||
    lower.includes('websocket is not open') ||
    lower.includes('websocket closed') ||
    lower.includes('socket not open') ||
    lower.includes('socket closed') ||
    lower.includes('econnreset')
  );
};

// WebSocket ready state constants
const READY_STATE_OPEN = 1;

// WebSocket data type for event streams
type EventStreamData = { isEventStream: true };

// Event mapping for cleaner message handling - matching Igloo Desktop
const EVENT_MAPPINGS = {
  '/sign/req': { type: 'sign', message: 'Signature request received' },
  '/sign/res': { type: 'sign', message: 'Signature response sent' },
  '/sign/rej': { type: 'sign', message: 'Signature request rejected' },
  '/sign/ret': { type: 'sign', message: 'Signature shares aggregated' },
  '/sign/err': { type: 'sign', message: 'Signature share aggregation failed' },
  '/ecdh/req': { type: 'ecdh', message: 'ECDH request received' },
  '/ecdh/res': { type: 'ecdh', message: 'ECDH response sent' },
  '/ecdh/rej': { type: 'ecdh', message: 'ECDH request rejected' },
  '/ecdh/ret': { type: 'ecdh', message: 'ECDH shares aggregated' },
  '/ecdh/err': { type: 'ecdh', message: 'ECDH share aggregation failed' },
  '/ping/req': { type: 'bifrost', message: 'Ping request' },
  '/ping/res': { type: 'bifrost', message: 'Ping response' },
} as const;

// Simplified monitoring constants
const CONNECTIVITY_CHECK_INTERVAL = 60000; // Check connectivity every minute
const IDLE_THRESHOLD = 45000; // Consider idle after 45 seconds
const CONNECTIVITY_PING_TIMEOUT = 10000; // 10 second timeout for connectivity pings

// Publish failure metrics tracking
interface PublishMetrics {
  totalAttempts: number;
  totalFailures: number;
  failuresByRelay: Map<string, number>;
  failuresByReason: Map<string, number>;
  lastReportTime: number;
  windowStart: number;
}

// Metrics configuration
const METRICS_WINDOW = 60000; // 1 minute sliding window
const FAILURE_THRESHOLD = 10; // Alert if >10 failures per minute
const METRICS_REPORT_INTERVAL = 60000; // Report every minute

// Safety timeout for event-based publish receipts; prevents hanging listeners when relays never respond.
const PUBLISH_PROMISE_TIMEOUT_MS = (() => {
  const raw = process.env.PUBLISH_EVENT_TIMEOUT_MS ?? process.env.RELAY_PUBLISH_TIMEOUT ?? process.env.FROSTR_SIGN_TIMEOUT;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed)) {
    return Math.min(Math.max(parsed, 1000), 120000);
  }
  return 30000;
})();

// Global metrics state
let publishMetrics: PublishMetrics = {
  totalAttempts: 0,
  totalFailures: 0,
  failuresByRelay: new Map(),
  failuresByReason: new Map(),
  lastReportTime: Date.now(),
  windowStart: Date.now()
};

// Helper to reset metrics window
function resetMetricsWindow() {
  publishMetrics = {
    totalAttempts: 0,
    totalFailures: 0,
    failuresByRelay: new Map(),
    failuresByReason: new Map(),
    lastReportTime: Date.now(),
    windowStart: Date.now()
  };
}

function isThenable(value: any): value is PromiseLike<any> {
  return value && typeof value === 'object' && typeof value.then === 'function';
}

function toPublishPromise(entry: any): Promise<any> {
  if (isThenable(entry)) {
    return Promise.resolve(entry);
  }

  if (entry && typeof entry === 'object') {
    const hasOnce = typeof entry.once === 'function';
    const hasOn = typeof entry.on === 'function';
    if (hasOnce || hasOn) {
      return new Promise((resolve, reject) => {
        let settled = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        const removeListener = (event: string, handler: (...args: any[]) => void) => {
          try {
            if (typeof entry.off === 'function') {
              entry.off(event, handler);
            } else if (typeof entry.removeListener === 'function') {
              entry.removeListener(event, handler);
            } else if (typeof entry.removeEventListener === 'function') {
              entry.removeEventListener(event, handler);
            }
          } catch {}
        };

        const cleanup = () => {
          removeListener('ok', onOk);
          removeListener('seen', onOk);
          removeListener('failed', onFail);
          removeListener('error', onFail);
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
          }
        };

        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          cleanup();
          fn();
        };

        const onOk = () => {
          finish(() => resolve(true));
        };

        const onFail = (err?: any) => {
          finish(() => reject(err ?? new Error('Relay publish failed')));
        };

        if (hasOnce) {
          try { entry.once('ok', onOk); } catch {}
          try { entry.once('seen', onOk); } catch {}
          try { entry.once('failed', onFail); } catch {}
          try { entry.once('error', onFail); } catch {}
        } else {
          try { entry.on('ok', onOk); } catch {}
          try { entry.on('seen', onOk); } catch {}
          try { entry.on('failed', onFail); } catch {}
          try { entry.on('error', onFail); } catch {}
        }

        timeoutId = setTimeout(() => {
          finish(() => reject(new Error(`Relay publish timed out after ${PUBLISH_PROMISE_TIMEOUT_MS}ms`)));
        }, PUBLISH_PROMISE_TIMEOUT_MS);
      });
    }
  }

  return Promise.resolve(entry);
}

function normalizePublishResults(result: any): { promises: Promise<any>[]; isArray: boolean } {
  if (Array.isArray(result)) {
    return { promises: result.map(toPublishPromise), isArray: true };
  }
  return { promises: [toPublishPromise(result)], isArray: false };
}

// Helper to track and report publish failures
function trackPublishFailure(
  relay: string | undefined,
  reason: string,
  addServerLog?: ReturnType<typeof createAddServerLog>
) {
  const now = Date.now();

  // Check if we need to reset the window
  if (now - publishMetrics.windowStart > METRICS_WINDOW) {
    resetMetricsWindow();
  }

  // Update metrics
  publishMetrics.totalFailures++;

  if (relay) {
    const currentCount = publishMetrics.failuresByRelay.get(relay) || 0;
    publishMetrics.failuresByRelay.set(relay, currentCount + 1);
  }

  // Categorize reason
  const reasonCategory = reason.toLowerCase().includes('policy') || reason.toLowerCase().includes('reject')
    ? 'policy_rejection'
    : reason.toLowerCase().includes('timeout')
    ? 'timeout'
    : reason.toLowerCase().includes('closed') || reason.toLowerCase().includes('disconnect')
    ? 'connection_error'
    : 'other';

  const currentReasonCount = publishMetrics.failuresByReason.get(reasonCategory) || 0;
  publishMetrics.failuresByReason.set(reasonCategory, currentReasonCount + 1);

  // Report if interval has passed
  if (now - publishMetrics.lastReportTime > METRICS_REPORT_INTERVAL && addServerLog) {
    const failureRate = (publishMetrics.totalFailures / Math.max(publishMetrics.totalAttempts, 1)) * 100;
    const isAboveThreshold = publishMetrics.totalFailures > FAILURE_THRESHOLD;

    // Build detailed metrics report
    const relayFailures: Record<string, number> = {};
    publishMetrics.failuresByRelay.forEach((count, relay) => {
      relayFailures[relay] = count;
    });

    const reasonBreakdown: Record<string, number> = {};
    publishMetrics.failuresByReason.forEach((count, reason) => {
      reasonBreakdown[reason] = count;
    });

    addServerLog(
      isAboveThreshold ? 'warning' : 'info',
      `Publish metrics for last ${METRICS_WINDOW / 1000}s: ${publishMetrics.totalFailures}/${publishMetrics.totalAttempts} failures (${failureRate.toFixed(1)}%)`,
      {
        threshold: FAILURE_THRESHOLD,
        isAboveThreshold,
        failuresByRelay: relayFailures,
        failuresByReason: reasonBreakdown,
        windowDuration: METRICS_WINDOW
      }
    );

    // Alert if above threshold
    if (isAboveThreshold) {
      addServerLog('error', `⚠️ High publish failure rate detected: ${publishMetrics.totalFailures} failures exceed threshold of ${FAILURE_THRESHOLD}`);
    }

    publishMetrics.lastReportTime = now;
  }
}

// Helper function to apply publish patches with metrics to a node
// (removed) applyPublishPatchesWithMetrics: replaced by non-invasive proxies

// Instrumentation wrappers (composition over mutation) for publish metrics
// These proxies avoid mutating third-party instances while preserving behavior.
function createInstrumentedPool(
  pool: any,
  addServerLog?: ReturnType<typeof createAddServerLog>
) {
  if (!pool || typeof pool !== 'object') return pool;

  const cache = new Map<string | symbol, any>();

  const handler: ProxyHandler<any> = {
    get(target, prop, receiver) {
      if (cache.has(prop)) return cache.get(prop);

      if (prop === 'publish' && typeof target.publish === 'function') {
        const originalPublish = target.publish.bind(target);
        const wrapped = (relays: string[], event: any, ...rest: any[]) => {
          try {
            const result = originalPublish(relays, event, ...rest);
            const { promises, isArray } = normalizePublishResults(result);

            publishMetrics.totalAttempts += Array.isArray(relays) ? relays.length : 1;
            const wrappedPromises = promises.map((p, idx) => p.catch((err: any) => {
              const reason = err instanceof Error ? err.message : String(err);
              const url = Array.isArray(relays) ? relays[idx] : undefined;
              trackPublishFailure(url, reason, addServerLog);
              if (isBenignPublishError(reason)) {
                if (addServerLog) {
                  addServerLog('warning', 'Relay publish rejected (benign)', {
                    relay: url,
                    reason
                  });
                }
                if (ALLOW_BENIGN_PUBLISH_SWALLOW) {
                  return false;
                }
                throw err;
              }
              throw err;
            }));
            return isArray ? wrappedPromises : wrappedPromises[0];
          } catch (err: any) {
            const reason = err instanceof Error ? err.message : String(err);
            trackPublishFailure(undefined, reason, addServerLog);
            throw err;
          }
        };
        cache.set(prop, wrapped);
        return wrapped;
      }

      const value = Reflect.get(target, prop, receiver);
      cache.set(prop, value);
      return value;
    }
  };

  return new Proxy(pool, handler);
}

function createInstrumentedClient(
  client: any,
  addServerLog?: ReturnType<typeof createAddServerLog>
) {
  if (!client || typeof client !== 'object') return client;

  // Cache per property to keep stable references
  const cache = new Map<string | symbol, any>();

  const handler: ProxyHandler<any> = {
    get(target, prop, receiver) {
      if (cache.has(prop)) return cache.get(prop);

      // Wrap publish method if present
      if (prop === 'publish' && typeof target.publish === 'function') {
        const originalPublish = target.publish.bind(target);
        const wrapped = async (...args: any[]) => {
          publishMetrics.totalAttempts++;
          try {
            return await originalPublish(...args);
          } catch (err: any) {
            const reason = err instanceof Error ? err.message : String(err);
            trackPublishFailure(undefined, reason, addServerLog);
            if (isBenignPublishError(reason) && ALLOW_BENIGN_PUBLISH_SWALLOW) {
              if (addServerLog) {
                addServerLog('warning', 'Benign publish error suppressed (client)', { reason });
              }
              return false;
            }
            throw err;
          }
        };
        cache.set(prop, wrapped);
        return wrapped;
      }

      // Expose instrumented pool via common fields if available
      if ((prop === '_pool' || prop === 'pool') && (target._pool || target.pool)) {
        const rawPool = target._pool || target.pool;
        const instrumentedPool = createInstrumentedPool(rawPool, addServerLog);
        cache.set(prop, instrumentedPool);
        return instrumentedPool;
      }

      const value = Reflect.get(target, prop, receiver);
      cache.set(prop, value);
      return value;
    }
  };

  return new Proxy(client, handler);
}

function createInstrumentedNode(
  node: any,
  addServerLog?: ReturnType<typeof createAddServerLog>
) {
  if (!node || typeof node !== 'object') return node;

  const cache = new Map<string | symbol, any>();

  const handler: ProxyHandler<any> = {
    get(target, prop, receiver) {
      if (cache.has(prop)) return cache.get(prop);

      // Pass-through events and core methods
      if (prop === 'publish' && typeof target.publish === 'function') {
        const originalPublish = target.publish.bind(target);
        const wrapped = async (...args: any[]) => {
          publishMetrics.totalAttempts++;
          try {
            return await originalPublish(...args);
          } catch (err: any) {
            const reason = err instanceof Error ? err.message : String(err);
            trackPublishFailure(undefined, reason, addServerLog);
            if (isBenignPublishError(reason) && ALLOW_BENIGN_PUBLISH_SWALLOW) {
              if (addServerLog) {
                addServerLog('warning', 'Benign publish error suppressed (node)', { reason });
              }
              return false;
            }
            throw err;
          }
        };
        cache.set(prop, wrapped);
        return wrapped;
      }

      // Provide instrumented client via both common fields
      if ((prop === '_client' || prop === 'client') && (target as any)) {
        const rawClient = (target as any)._client || (target as any).client;
        const instrumentedClient = createInstrumentedClient(rawClient, addServerLog);
        cache.set(prop, instrumentedClient);
        return instrumentedClient;
      }

      const value = Reflect.get(target, prop, receiver);
      cache.set(prop, value);
      return value;
    }
  };

  return new Proxy(node, handler);
}

/**
 * Race a promise against a timeout and ensure the timeout is cleared once settled.
 * Prevents stray timer callbacks from rejecting after the race is over.
 *
 * @param promise The promise to race against the timeout
 * @param timeoutMs The timeout in milliseconds
 * @returns The original promise's resolved value, or rejects on timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const timeoutError = new Error('Ping timeout');

  const wrapped = new Promise<T>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(timeoutError);
      }
    }, timeoutMs);
    promise.then(
      value => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      },
      error => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    );
  });

  return wrapped.finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

// Simplified monitoring state
interface NodeHealth {
  lastActivity: Date;
  lastConnectivityCheck: Date;
  isConnected: boolean;
  consecutiveConnectivityFailures: number;
}

let nodeHealth: NodeHealth = {
  lastActivity: new Date(),
  lastConnectivityCheck: new Date(),
  isConnected: true,
  consecutiveConnectivityFailures: 0
};

let connectivityCheckInterval: ReturnType<typeof setInterval> | null = null;
let connectivityCheckPromise: Promise<void> | null = null;
let nodeRecreateCallback: (() => Promise<void>) | null = null;

// Recreation attempt tracking to prevent infinite loops
let recreationAttempts = 0;
const MAX_RECREATION_ATTEMPTS = 5;
let nextRecreationBackoffMs = 60000; // Start with 1 minute backoff
let nextRecreationAllowedAt = 0; // Timestamp when next recreation is allowed

// Quick relay capability probe: keep relays that accept the given kind.
// Uses an ephemeral keypair and a tiny, throwaway event, and closes connections immediately.
export async function filterRelaysForKindSupport(
  relays: string[],
  kind: number = 20004,
  addServerLog?: ReturnType<typeof createAddServerLog>
): Promise<string[]> {
  if (!Array.isArray(relays) || relays.length === 0) return [];

  const pool = new SimplePool();
  try {
    const seckey = generateSecretKey();
    const event = finalizeEvent({
      kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'probe'
    }, seckey);

    const checks = relays.map(async (url) => {
      try {
        const publishResult = pool.publish([url], event);
        const { promises } = normalizePublishResults(publishResult);
        const outcome = await Promise.allSettled(promises);
        const ok = outcome.length > 0 && outcome[0].status === 'fulfilled';
        if (!ok && addServerLog) {
          const reason = outcome[0].status === 'rejected' ? String((outcome[0] as PromiseRejectedResult).reason) : 'unknown';
          addServerLog('warning', `Relay rejected kind ${kind}: ${url}`, { reason });
        }
        return ok ? url : null;
      } catch (e) {
        if (addServerLog) addServerLog('warning', `Relay probe failed: ${url}`, e);
        return null;
      }
    });

    const settled = await Promise.all(checks);
    return settled.filter((r): r is string => typeof r === 'string');
  } finally {
    try { pool.close(relays); } catch {}
  }
}

// Helper function to update node activity
function updateNodeActivity(addServerLog: ReturnType<typeof createAddServerLog>, isKeepalive: boolean = false) {
  const now = new Date();
  nodeHealth.lastActivity = now;

  // Reset connectivity failures on real activity (not keepalive)
  if (!isKeepalive && nodeHealth.consecutiveConnectivityFailures > 0) {
    nodeHealth.consecutiveConnectivityFailures = 0;
    nodeHealth.isConnected = true;
    addServerLog('info', 'Node activity detected - connectivity restored');
  } else if (!isKeepalive && !nodeHealth.isConnected) {
    // Only log if we were previously disconnected
    nodeHealth.isConnected = true;
    addServerLog('info', 'Node activity detected - connection active');
  }
}

// Helper function to check if node and client are valid
async function checkNodeValidity(
  node: ServerBifrostNode | null,
  addServerLog: ReturnType<typeof createAddServerLog>
): Promise<{ valid: boolean; client: any; shouldRecreate: boolean }> {
  // Check if node is null or invalid
  if (node === null || typeof node !== 'object') {
    addServerLog('warning', 'Node is null or invalid, marking as failure', {
      nodeType: node === null ? 'null' : typeof node
    });
    return { valid: false, client: null, shouldRecreate: true };
  }

  // Check if the node client exists
  const client = (node as any)._client || (node as any).client;
  if (!client) {
    addServerLog('warning', 'Node client not available, will recreate on next check');
    return { valid: false, client: null, shouldRecreate: true };
  }

  return { valid: true, client, shouldRecreate: false };
}

// Helper function to check activity timeouts
function checkActivityTimeout(
  now: Date,
  addServerLog: ReturnType<typeof createAddServerLog>
): { shouldRecreate: boolean; isIdle: boolean } {
  const timeSinceLastActivity = now.getTime() - nodeHealth.lastActivity.getTime();
  const isIdle = timeSinceLastActivity > IDLE_THRESHOLD;

  // If no real activity for 10 minutes, recreate node regardless of connection status
  if (timeSinceLastActivity > 600000) { // 10 minutes
    addServerLog('warning', `No real activity for ${Math.round(timeSinceLastActivity / 60000)} minutes, recreating node`);
    return { shouldRecreate: true, isIdle };
  }

  return { shouldRecreate: false, isIdle };
}

// Helper function to check relay connection status
function checkRelayConnectionStatus(
  pool: any,
  addServerLog: ReturnType<typeof createAddServerLog>
): { disconnectedRelays: string[]; hasConnectedRelays: boolean } {
  if (!pool || typeof pool.listConnectionStatus !== 'function') {
    return { disconnectedRelays: [], hasConnectedRelays: false };
  }

  const connectionStatuses = pool.listConnectionStatus();
  const disconnectedRelays: string[] = [];
  let hasConnectedRelays = false;

  for (const [url, isConnected] of connectionStatuses) {
    if (!isConnected) {
      disconnectedRelays.push(url);
    } else {
      hasConnectedRelays = true;
    }
  }

  return { disconnectedRelays, hasConnectedRelays };
}

// Helper function to reconnect disconnected relays
async function reconnectDisconnectedRelays(
  pool: any,
  disconnectedRelays: string[],
  addServerLog: ReturnType<typeof createAddServerLog>
): Promise<number> {
  if (disconnectedRelays.length === 0) {
    return 0;
  }

  addServerLog('warning', `Found ${disconnectedRelays.length} disconnected relay(s), attempting reconnection`);

  for (const url of disconnectedRelays) {
    try {
      if (typeof pool.ensureRelay === 'function') {
        await pool.ensureRelay(url, { connectionTimeout: 10000 });
        addServerLog('info', `Reconnected to relay: ${url}`);
      }
    } catch (reconnectError) {
      addServerLog('error', `Failed to reconnect to ${url}`, reconnectError);
    }
  }

  // Check again after reconnection attempts
  const newStatuses = pool.listConnectionStatus();
  let stillDisconnected = 0;
  for (const [_, connected] of newStatuses) {
    if (!connected) stillDisconnected++;
  }

  return stillDisconnected;
}

// Helper function to perform keep-alive ping
async function performKeepAlivePing(
  node: any,
  addServerLog: ReturnType<typeof createAddServerLog>
): Promise<{ success: boolean; hadPingCapability: boolean }> {
  // Resolve ping function from either node.ping or node.req.ping
  const pingFn = node?.ping ?? node?.req?.ping;

  if (typeof pingFn !== 'function') {
    return { success: false, hadPingCapability: false };
  }

  try {
    // Get list of peer pubkeys from the node
    const peers = node._peers || node.peers || [];

    if (peers.length === 0) {
      addServerLog('debug', 'No peers available for keepalive ping, relying on relay connections');
      return { success: false, hadPingCapability: true };
    }

    // Send a ping to the first available peer
    const targetPeer = peers[0];
    const peerPubkey = targetPeer.pubkey || targetPeer;
    const normalizedPeerPubkey = normalizePubkey(peerPubkey);

    // Race ping with timeout using helper to avoid stray rejections
    const pingResult = await withTimeout<PingResult>(pingFn(normalizedPeerPubkey), CONNECTIVITY_PING_TIMEOUT)
      .then((res: PingResult) => ({ ok: true, result: res }))
      .catch((err: Error) => ({ ok: false, err: err?.message || 'ping failed' })) as { ok: boolean; err?: string; result?: PingResult };

    if (pingResult && pingResult.ok) {
      // Ping succeeded - connection is good!
      updateNodeActivity(addServerLog, true);
      return { success: true, hadPingCapability: true };
    } else {
      // Safely convert error to string for checking
      const errorStr = String(pingResult?.err || 'unknown').toLowerCase();

      // Log appropriate message based on error type
      if (errorStr.includes('timeout')) {
        addServerLog('warning', `Keepalive ping timed out after ${CONNECTIVITY_PING_TIMEOUT}ms`);
      } else if (errorStr.includes('closed') || errorStr.includes('disconnect')) {
        addServerLog('warning', `Ping failed with connection error: ${errorStr}`);
      } else {
        addServerLog('warning', `Ping failed: ${errorStr}`);
      }

      return { success: false, hadPingCapability: true };
    }
  } catch (pingError: any) {
    const errorStr = String(pingError?.message || pingError || 'unknown error').toLowerCase();
    addServerLog('warning', `Keepalive ping error: ${errorStr}`);
    return { success: false, hadPingCapability: true };
  }
}

// Helper function to check and maintain relay connectivity (refactored)
async function checkRelayConnectivity(
  node: ServerBifrostNode | null,
  addServerLog: ReturnType<typeof createAddServerLog>
): Promise<boolean> {
  const now = new Date();
  nodeHealth.lastConnectivityCheck = now;

  try {
    // Step 1: Validate node and client
    const nodeValidation = await checkNodeValidity(node, addServerLog);
    if (!nodeValidation.valid) {
      nodeHealth.isConnected = false;
      nodeHealth.consecutiveConnectivityFailures++;

      if (nodeValidation.shouldRecreate && nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
        addServerLog('info', 'Recreating node after 3 failed checks');
        await nodeRecreateCallback();
      }
      return false;
    }

    const { client } = nodeValidation;
    const pool = client._pool || client.pool;

    // Step 2: Check activity timeout
    const activityCheck = checkActivityTimeout(now, addServerLog);
    if (activityCheck.shouldRecreate && nodeRecreateCallback) {
      await nodeRecreateCallback();
      return false;
    }

    // Step 3: Check and handle relay connections
    const relayStatus = checkRelayConnectionStatus(pool, addServerLog);

    if (relayStatus.disconnectedRelays.length > 0) {
      // Check if it's been too long since real activity with relay issues
      const timeSinceRealActivity = now.getTime() - nodeHealth.lastActivity.getTime();
      const tooLongWithoutActivity = timeSinceRealActivity > 300000; // 5 minutes

      if (tooLongWithoutActivity) {
        addServerLog('warning', `No real activity for ${Math.round(timeSinceRealActivity / 60000)} minutes and relays disconnected`);
        nodeHealth.consecutiveConnectivityFailures++;

        if (nodeRecreateCallback) {
          addServerLog('info', 'Recreating node due to prolonged inactivity with relay issues');
          await nodeRecreateCallback();
          return false;
        }
      }

      // Attempt to reconnect disconnected relays
      const stillDisconnected = await reconnectDisconnectedRelays(pool, relayStatus.disconnectedRelays, addServerLog);

      if (stillDisconnected > 0) {
        nodeHealth.consecutiveConnectivityFailures++;

        if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
          addServerLog('error', 'Unable to reconnect to relays after 3 attempts, recreating node');
          await nodeRecreateCallback();
          return false;
        }

        return false;
      } else {
        // Successfully reconnected
        nodeHealth.consecutiveConnectivityFailures = 0;
      }
    }

    // Step 4: Handle idle state with keep-alive ping
    if (activityCheck.isIdle) {
      const pingResult = await performKeepAlivePing(node, addServerLog);

      if (!pingResult.hadPingCapability) {
        // No ping capability - check if we have connected relays
        if (relayStatus.hasConnectedRelays) {
          nodeHealth.isConnected = true;
          nodeHealth.consecutiveConnectivityFailures = 0;
          return true;
        }

        // No connected relays and no ping capability
        nodeHealth.isConnected = false;
        nodeHealth.consecutiveConnectivityFailures++;

        if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
          addServerLog('info', 'No connected relays and no ping capability, recreating node');
          await nodeRecreateCallback();
        }
        return false;
      }

      if (pingResult.success) {
        nodeHealth.isConnected = true;
        nodeHealth.consecutiveConnectivityFailures = 0;
        return true;
      } else {
        // Ping failed
        nodeHealth.isConnected = false;
        nodeHealth.consecutiveConnectivityFailures++;

        if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
          addServerLog('info', 'Persistent ping failures, recreating node');
          await nodeRecreateCallback();
        }
        return false;
      }
    }

    // Everything looks good
    nodeHealth.isConnected = true;
    nodeHealth.consecutiveConnectivityFailures = 0;
    return true;

  } catch (error) {
    addServerLog('error', 'Connectivity check error', error);
    nodeHealth.consecutiveConnectivityFailures++;

    if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
      addServerLog('info', 'Connectivity errors exceeded threshold, recreating node');
      await nodeRecreateCallback();
    }
    return false;
  }
}


// Start simplified connectivity monitoring
function startConnectivityMonitoring(
  node: ServerBifrostNode | null,
  addServerLog: ReturnType<typeof createAddServerLog>,
  recreateNodeFn: () => Promise<void>
) {
  stopConnectivityMonitoring();

  // Store recreation callback even if node is null - we may need it for recovery
  nodeRecreateCallback = recreateNodeFn;

  if (!node) {
    addServerLog('warning', 'Starting connectivity monitoring with null node - will attempt recovery');
    // Mark as unhealthy to trigger recovery
    nodeHealth.isConnected = false;
    nodeHealth.consecutiveConnectivityFailures = 1;
  } else {
    addServerLog('system', 'Starting simplified connectivity monitoring with keepalive pings and publish metrics');
  }

  // Reset publish metrics for new monitoring session
  resetMetricsWindow();

  // Active connectivity monitoring - test relay connections periodically
  // This runs every 60 seconds to maintain relay connections and report metrics
  connectivityCheckInterval = setInterval(async () => {
    // Prevent overlapping checks using Promise-based synchronization
    if (connectivityCheckPromise) {
      return;
    }

    // Create and store the promise atomically to avoid race conditions
    connectivityCheckPromise = (async () => {
      try {
        const isConnected = await checkRelayConnectivity(node, addServerLog);

      // Reset recreation attempts on successful connection
      if (isConnected) {
        if (recreationAttempts > 0) {
          addServerLog('info', `Connectivity restored after ${recreationAttempts} recreation attempts`);
        }
        recreationAttempts = 0;
        nextRecreationBackoffMs = 60000;
        nextRecreationAllowedAt = 0;
      }

      // Reduced logging for better signal-to-noise ratio
      if (!isConnected && nodeHealth.consecutiveConnectivityFailures === 1) {
        // Only log first failure if it's not just missing ping capability
        if (node) {
          const client = (node as any)._client || (node as any).client;
          if (client) {
            addServerLog('info', 'Connectivity check failed, will retry');
          }
        } else {
          addServerLog('info', 'Connectivity check failed (node is null), will retry');
        }
      } else if (isConnected && nodeHealth.consecutiveConnectivityFailures === 0) {
        // Log every 10 successful checks (10 minutes)
        const timeSinceStart = Date.now() - nodeHealth.lastConnectivityCheck.getTime();
        const checkCount = Math.floor(timeSinceStart / CONNECTIVITY_CHECK_INTERVAL);
        if (checkCount % 10 === 0 && checkCount > 0) {
          addServerLog('debug', `Connectivity maintained for ${Math.round(timeSinceStart / 60000)} minutes`);
        }
      }
    } catch (error) {
      addServerLog('error', 'Connectivity check error', error);
      nodeHealth.consecutiveConnectivityFailures++;

      // Check if we should attempt recreation with backoff strategy
      if (nodeHealth.consecutiveConnectivityFailures >= 3 && nodeRecreateCallback) {
        const now = Date.now();

        if (recreationAttempts >= MAX_RECREATION_ATTEMPTS) {
          // Max attempts reached - log once and stop trying to recreate
          if (recreationAttempts === MAX_RECREATION_ATTEMPTS) {
            addServerLog('error',
              `Maximum recreation attempts (${MAX_RECREATION_ATTEMPTS}) reached. ` +
              'Node requires manual intervention. Monitoring will continue but recreation is disabled.'
            );
            recreationAttempts++; // Increment to prevent logging this message repeatedly
          }
        } else if (now >= nextRecreationAllowedAt) {
          // Attempt recreation with backoff
          recreationAttempts++;
          nextRecreationBackoffMs = Math.min(nextRecreationBackoffMs * 2, 3600000); // Max 1 hour backoff
          nextRecreationAllowedAt = now + nextRecreationBackoffMs;

          addServerLog('info',
            `Node recreation attempt ${recreationAttempts}/${MAX_RECREATION_ATTEMPTS}. ` +
            `Next attempt allowed in ${Math.round(nextRecreationBackoffMs / 60000)} minutes if needed.`
          );

          await nodeRecreateCallback();
        } else {
          // Still in backoff period
          const waitMinutes = Math.round((nextRecreationAllowedAt - now) / 60000);
          addServerLog('debug', `Recreation on cooldown, next attempt in ${waitMinutes} minutes`);
        }
      }
      } finally {
        connectivityCheckPromise = null;
      }
    })();

    // Await the promise to ensure the check completes within this interval callback
    await connectivityCheckPromise;
  }, CONNECTIVITY_CHECK_INTERVAL);

  // Reset health state for new node (only if node is valid)
  if (node) {
    nodeHealth = {
      lastActivity: new Date(),
      lastConnectivityCheck: new Date(),
      isConnected: true,
      consecutiveConnectivityFailures: 0
    };
  }
}

// Stop connectivity monitoring
function stopConnectivityMonitoring() {
  if (connectivityCheckInterval) {
    clearInterval(connectivityCheckInterval);
    connectivityCheckInterval = null;
  }
  connectivityCheckPromise = null;
  nodeRecreateCallback = null;

  // Reset recreation attempt tracking
  recreationAttempts = 0;
  nextRecreationBackoffMs = 60000;
  nextRecreationAllowedAt = 0;
}

// Enhanced connection monitoring
function setupConnectionMonitoring(
  node: any,
  addServerLog: ReturnType<typeof createAddServerLog>
) {
  // Guard against null node
  if (!node) {
    addServerLog('debug', 'Skipping connection monitoring setup - node is null');
    return;
  }
  
  // Monitor relay connections if available
  if (node.relays && Array.isArray(node.relays)) {
    node.relays.forEach((relay: any, index: number) => {
      if (relay.on) {
        relay.on('connect', () => {
          addServerLog('bifrost', `Relay ${index + 1} connected`);
          updateNodeActivity(addServerLog);
        });
        
        relay.on('disconnect', () => {
          addServerLog('warning', `Relay ${index + 1} disconnected`);
        });
        
        relay.on('error', (error: any) => {
          addServerLog('error', `Relay ${index + 1} error`, error);
        });
      }
    });
  }

  // Monitor WebSocket connections if available
  if (node.connections && Array.isArray(node.connections)) {
    node.connections.forEach((connection: any, index: number) => {
      if (connection.on) {
        connection.on('open', () => {
          addServerLog('bifrost', `WebSocket connection ${index + 1} opened`);
          updateNodeActivity(addServerLog);
        });
        
        connection.on('close', () => {
          addServerLog('warning', `WebSocket connection ${index + 1} closed`);
        });
        
        connection.on('error', (error: any) => {
          addServerLog('error', `WebSocket connection ${index + 1} error`, error);
        });
      }
    });
  }
}

// Create broadcast event function for WebSocket streaming
export function createBroadcastEvent(eventStreams: Set<ServerWebSocket<EventStreamData>>) {
  return function broadcastEvent(event: { type: string; message: string; data?: any; timestamp: string; id: string }) {
    if (eventStreams.size === 0) {
      return; // No connected clients
    }
    
    try {
      // Safely serialize the event data
      const safeEvent = {
        ...event,
        data: event.data ? JSON.parse(safeStringify(event.data)) : undefined
      };
      
      const eventData = JSON.stringify(safeEvent);
      
      // Send to all connected WebSocket clients, removing failed ones
      const failedStreams = new Set<ServerWebSocket<EventStreamData>>();
      
      for (const ws of eventStreams) {
        try {
          // Use named constant instead of magic number
          if (ws.readyState === READY_STATE_OPEN) {
            ws.send(eventData);
          } else {
            // Mark for removal if connection is not open
            failedStreams.add(ws);
          }
        } catch (error) {
          // Mark for removal - don't modify set while iterating
          failedStreams.add(ws);
        }
      }
      
      // Remove failed streams
      for (const failedWs of failedStreams) {
        eventStreams.delete(failedWs);
      }
    } catch (error) {
      console.error('Broadcast event error:', error);
    }
  };
}

// Helper function to create a server log broadcaster
export function createAddServerLog(broadcastEvent: ReturnType<typeof createBroadcastEvent>) {
  return function addServerLog(type: string, message: string, data?: any) {
    // Suppress noisy low‑value entries from the public event stream and console
    // - Signature aggregation events are very frequent and leak long IDs into UI
    //   Keep them out of the event log while preserving other SIGN entries.
    if (
      (type === 'sign' && typeof message === 'string' && message.toLowerCase().startsWith('signature shares aggregated')) ||
      (type === 'ecdh' && typeof message === 'string' && message.toLowerCase().startsWith('ecdh shares aggregated'))
    ) {
      return; // do not log or broadcast
    }
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
      type,
      message,
      data,
      timestamp,
      id: Math.random().toString(36).substring(2, 11)
    };
    
    // Log to console for server logs
    if (data !== undefined && data !== null && data !== '') {
      console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`, data);
    } else {
      console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`);
    }
    
    // Broadcast to connected clients
    broadcastEvent(logEntry);
  };
}

/**
 * Determine if a ping message is a self-ping based on credentials and message content.
 * Safely extracts our pubkey from credentials, normalizes it, and compares it against
 * the pubkey found in the message data (env.pubkey or data.from). Returns false on any error.
 */
function isSelfPing(messageData: any, groupCred?: string, shareCred?: string): boolean {
  try {
    if (!groupCred || !shareCred) return false;
    const result = extractSelfPubkeyFromCredentials(groupCred, shareCred);
    const selfPubkey = result?.pubkey;
    if (!selfPubkey) return false;
    const normalizedSelf = normalizePubkey(selfPubkey);

    let fromPubkey: string | undefined;

    if (
      messageData &&
      typeof messageData === 'object' &&
      'env' in messageData &&
      messageData.env !== null &&
      typeof (messageData as any).env === 'object'
    ) {
      const env = (messageData as any).env as any;
      if ('pubkey' in env && typeof env.pubkey === 'string') {
        fromPubkey = env.pubkey;
      }
    }

    if (
      !fromPubkey &&
      messageData &&
      typeof messageData === 'object' &&
      'data' in messageData &&
      (messageData as any).data !== null &&
      typeof (messageData as any).data === 'object'
    ) {
      const data = (messageData as any).data as any;
      if ('from' in data && typeof data.from === 'string') {
        fromPubkey = data.from;
      }
    }

    if (!fromPubkey) return false;
    const normalizedFrom = normalizePubkey(fromPubkey);
    return normalizedFrom === normalizedSelf;
  } catch {
    return false;
  }
}

// Setup comprehensive event listeners for the Bifrost node
export function setupNodeEventListeners(
  node: any, 
  addServerLog: ReturnType<typeof createAddServerLog>,
  broadcastEvent: ReturnType<typeof createBroadcastEvent>,
  peerStatuses: Map<string, PeerStatus>,
  onNodeUnhealthy?: () => Promise<void> | void,
  groupCred?: string,
  shareCred?: string
) {
  // Start simplified connectivity monitoring
  const recreateNodeFn = async () => {
    if (onNodeUnhealthy) {
      const result = onNodeUnhealthy();
      if (result instanceof Promise) {
        await result;
      }
    }
  };
  startConnectivityMonitoring(node, addServerLog, recreateNodeFn);

  // Setup connection monitoring
  setupConnectionMonitoring(node, addServerLog);

  // Basic node events - matching Igloo Desktop
  node.on('closed', () => {
    addServerLog('bifrost', 'Bifrost node is closed');
    stopConnectivityMonitoring();
  });

  node.on('error', (error: unknown) => {
    addServerLog('error', 'Node error', error);
    updateNodeActivity(addServerLog);
  });

  node.on('ready', (data: unknown) => {
    // Log basic info about the ready event without the potentially problematic data object
    const logData = data && typeof data === 'object' ?
      { message: 'Node ready event received', hasData: true, dataType: typeof data } :
      data;
    addServerLog('ready', 'Node is ready', logData);
    updateNodeActivity(addServerLog);
  });

  node.on('bounced', (reason: string, msg: unknown) => {
    addServerLog('bifrost', `Message bounced: ${reason}`, msg);
    updateNodeActivity(addServerLog);
  });

  // Enhanced connection events
  node.on('connect', () => {
    addServerLog('bifrost', 'Node connected');
    updateNodeActivity(addServerLog);
  });

  node.on('disconnect', () => {
    addServerLog('warning', 'Node disconnected');
  });

  node.on('reconnect', () => {
    addServerLog('bifrost', 'Node reconnected');
    updateNodeActivity(addServerLog);
  });

  node.on('reconnecting', () => {
    addServerLog('bifrost', 'Node reconnecting...');
  });

  // Message events
  node.on('message', (msg: unknown) => {
    updateNodeActivity(addServerLog); // Update activity on every message
    
    try {
      if (msg && typeof msg === 'object' && 'tag' in msg) {
        const messageData = msg as { tag: unknown; [key: string]: unknown };
        const tag = messageData.tag;

        if (typeof tag === 'string') {
          // Handle peer status updates for ping messages
          if (tag === '/ping/req' || tag === '/ping/res') {
            // Extract pubkey from env.pubkey (Nostr event structure)
            let fromPubkey: string | undefined = undefined;
            
            if ('env' in messageData && typeof messageData.env === 'object' && messageData.env !== null) {
              const env = messageData.env as any;
              if ('pubkey' in env && typeof env.pubkey === 'string') {
                fromPubkey = env.pubkey;
              }
            }
            
            // Fallback: check for direct 'from' field
            if (!fromPubkey && 'from' in messageData && typeof messageData.from === 'string') {
              fromPubkey = messageData.from;
            }
            
            if (fromPubkey) {
              const normalizedPubkey = normalizePubkey(fromPubkey);
              
              // Calculate latency for responses
              let latency: number | undefined = undefined;
              if (tag === '/ping/res') {
                if ('latency' in messageData && typeof messageData.latency === 'number') {
                  latency = messageData.latency;
                } else if ('timestamp' in messageData && typeof messageData.timestamp === 'number') {
                  latency = Date.now() - messageData.timestamp;
                }
              }
              
              // Update peer status - use normalized key but preserve original pubkey format
              const existingStatus = peerStatuses.get(normalizedPubkey);
              const updatedStatus: PeerStatus = {
                pubkey: existingStatus?.pubkey || fromPubkey, // Preserve the original format if we have it
                online: true,
                lastSeen: new Date(),
                latency: latency || existingStatus?.latency,
                lastPingAttempt: existingStatus?.lastPingAttempt
              };
              
              peerStatuses.set(normalizedPubkey, updatedStatus);
              
              // Broadcast peer status update for peer list (not logged to event stream)
              broadcastEvent({
                type: 'peer-status-internal',
                message: '', // Internal use only - not logged
                data: {
                  pubkey: fromPubkey,
                  status: updatedStatus,
                  eventType: tag
                },
                timestamp: new Date().toLocaleTimeString(),
                id: Math.random().toString(36).substring(2, 11)
              });
              
            }
          }

          const eventInfo = EVENT_MAPPINGS[tag as keyof typeof EVENT_MAPPINGS];
          if (eventInfo) {
            addServerLog(eventInfo.type, eventInfo.message, msg);
          } else if (tag.startsWith('/sign/')) {
            addServerLog('sign', `Signature event: ${tag}`, msg);
          } else if (tag.startsWith('/ecdh/')) {
            addServerLog('ecdh', `ECDH event: ${tag}`, msg);
          } else if (tag.startsWith('/ping/')) {
            const selfPing = isSelfPing(messageData, groupCred, shareCred);
            if (!selfPing) {
              addServerLog('bifrost', `Ping event: ${tag}`, msg);
            }
          } else {
            addServerLog('bifrost', `Message received: ${tag}`, msg);
          }
        } else {
          addServerLog('bifrost', 'Message received (invalid tag type)', {
            tagType: typeof tag,
            tag,
            originalMessage: msg
          });
        }
      } else {
        addServerLog('bifrost', 'Message received (no tag)', msg);
      }
    } catch (error) {
      addServerLog('bifrost', 'Error parsing message event', { error, originalMessage: msg });
    }
  });

  // Special handlers for events with different signatures - matching Igloo Desktop
  try {
    const ecdhSenderRejHandler = (reason: string, pkg: any) => {
      updateNodeActivity(addServerLog);
      addServerLog('ecdh', `ECDH request rejected: ${reason}`, pkg);
    };
    const ecdhSenderRetHandler = (reason: string, pkgs: string) => {
      updateNodeActivity(addServerLog);
      addServerLog('ecdh', `ECDH shares aggregated: ${reason}`, pkgs);
    };
    const ecdhSenderErrHandler = (reason: string, msgs: unknown[]) => {
      updateNodeActivity(addServerLog);
      addServerLog('ecdh', `ECDH share aggregation failed: ${reason}`, msgs);
    };
    const ecdhHandlerRejHandler = (reason: string, msg: unknown) => {
      updateNodeActivity(addServerLog);
      addServerLog('ecdh', `ECDH rejection sent: ${reason}`, msg);
    };

    node.on('/ecdh/sender/rej', ecdhSenderRejHandler);
    node.on('/ecdh/sender/ret', ecdhSenderRetHandler);
    node.on('/ecdh/sender/err', ecdhSenderErrHandler);
    node.on('/ecdh/handler/rej', ecdhHandlerRejHandler);

    const signSenderRejHandler = (reason: string, pkg: any) => {
      updateNodeActivity(addServerLog);
      // Filter out common websocket connection errors to reduce noise
      if (reason === 'websocket closed' || reason === 'connection timeout') {
        addServerLog('sign', `Signature request rejected due to network issue: ${reason}`, null);
      } else {
        addServerLog('sign', `Signature request rejected: ${reason}`, pkg);
      }
    };
    const signSenderRetHandler = (reason: string, msgs: any[]) => {
      updateNodeActivity(addServerLog);
      addServerLog('sign', `Signature shares aggregated: ${reason}`, msgs);
    };
    const signSenderErrHandler = (reason: string, msgs: unknown[]) => {
      updateNodeActivity(addServerLog);
      addServerLog('sign', `Signature share aggregation failed: ${reason}`, msgs);
    };
    const signHandlerRejHandler = (reason: string, msg: unknown) => {
      updateNodeActivity(addServerLog);
      // Filter out common websocket connection errors to reduce noise
      if (reason === 'websocket closed' || reason === 'connection timeout') {
        addServerLog('sign', `Signature rejection sent due to network issue: ${reason}`, null);
      } else {
        addServerLog('sign', `Signature rejection sent: ${reason}`, msg);
      }
    };

    node.on('/sign/sender/rej', signSenderRejHandler);
    node.on('/sign/sender/ret', signSenderRetHandler);
    node.on('/sign/sender/err', signSenderErrHandler);
    node.on('/sign/handler/rej', signHandlerRejHandler);

    // Legacy direct event listeners for backward compatibility - only for events NOT handled by message handler
    const legacyEvents = [
      // Only include events that aren't already handled by EVENT_MAPPINGS via message handler
      { event: '/ecdh/sender/req', type: 'ecdh', message: 'ECDH request sent' },
      { event: '/ecdh/sender/res', type: 'ecdh', message: 'ECDH responses received' },
      { event: '/sign/sender/req', type: 'sign', message: 'Signature request sent' },
      { event: '/sign/sender/res', type: 'sign', message: 'Signature responses received' },
      // Note: Removed /ecdh/handler/req, /ecdh/handler/res, /sign/handler/req, /sign/handler/res 
      // because they're already handled by the message handler via EVENT_MAPPINGS
    ];

    legacyEvents.forEach(({ event, type, message }) => {
      try {
        const handler = (msg: unknown) => {
          updateNodeActivity(addServerLog);
          addServerLog(type, message, msg);
        };
        (node as any).on(event, handler);
      } catch (e) {
        // Silently ignore if event doesn't exist
      }
    });
  } catch (e) {
    addServerLog('bifrost', 'Error setting up some legacy event listeners', e);
  }

  // Catch-all for any other events - but exclude ping events since they're handled by message handler
  node.on('*', (event: any) => {
    // Only log events that aren't already handled above, and exclude ping events to avoid duplicates
    if (event !== 'message' && 
        event !== 'closed' && 
        event !== 'error' && 
        event !== 'ready' && 
        event !== 'bounced' &&
        event !== 'connect' &&
        event !== 'disconnect' &&
        event !== 'reconnect' &&
        event !== 'reconnecting' &&
        !event.startsWith('/ping/') &&
        !event.startsWith('/sign/') &&
        !event.startsWith('/ecdh/')) {
      updateNodeActivity(addServerLog);
      addServerLog('bifrost', `Bifrost event: ${event}`);
    }
  });

  // Log health monitoring status
  addServerLog('system', 'Health monitoring and enhanced event listeners configured');
}

interface ParsedEnvPolicies {
  policies: NodePolicyInput[];
  requestedCount: number;
}

function parseEnvPeerPolicies(
  policiesRaw: string | undefined,
  addServerLog?: ReturnType<typeof createAddServerLog>
): ParsedEnvPolicies | null {
  if (!policiesRaw) return null;
  const trimmed = policiesRaw.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    const policyEntries = Array.isArray(parsed) ? parsed : [parsed];
    const normalized = normalizeNodePolicies(policyEntries as any);
    const policies: NodePolicyInput[] = normalized.map(policy => ({
      pubkey: policy.pubkey,
      allowSend: policy.allowSend,
      allowReceive: policy.allowReceive,
      label: policy.label,
      roles: policy.roles,
      metadata: policy.metadata,
      note: policy.note,
      source: policy.source ?? 'config'
    }));

    return {
      policies,
      requestedCount: policyEntries.length
    };
  } catch (error) {
    if (addServerLog) {
      addServerLog('warning', 'Failed to parse PEER_POLICIES env value', {
        error: error instanceof Error ? error.message : String(error)
      });
    } else {
      console.warn('[node] Failed to parse PEER_POLICIES env value', error);
    }
    return null;
  }
}

// Enhanced node creation with better error handling and retry logic
export async function createNodeWithCredentials(
  groupCred: string,
  shareCred: string,
  relaysEnv?: string,
  addServerLog?: ReturnType<typeof createAddServerLog>,
  peerPoliciesRaw?: string
): Promise<ServerBifrostNode | null> {
  let relays = getValidRelays(relaysEnv);

  const parsedPolicies = parseEnvPeerPolicies(peerPoliciesRaw, addServerLog);
  const configPolicies = parsedPolicies && parsedPolicies.policies.length > 0
    ? parsedPolicies.policies
    : undefined;

  if (parsedPolicies) {
    if (configPolicies && addServerLog) {
      addServerLog('info', `Applying ${configPolicies.length} peer polic${configPolicies.length === 1 ? 'y' : 'ies'} from environment configuration`);
    } else if (parsedPolicies.requestedCount > 0 && addServerLog) {
      addServerLog('warn', 'PEER_POLICIES env value provided no valid entries after normalization');
    }
  }

  let startupPolicies = configPolicies ? [...configPolicies] : undefined;

  try {
    const fallbackPolicies = await loadFallbackPeerPolicies();
    if (fallbackPolicies.length > 0) {
      startupPolicies = mergePolicyInputs(startupPolicies, fallbackPolicies);
      if (addServerLog) {
        addServerLog('info', `Restored ${fallbackPolicies.length} stored peer polic${fallbackPolicies.length === 1 ? 'y' : 'ies'} for headless/API clients`);
      }
    }
  } catch (error) {
    if (addServerLog) {
      addServerLog('warn', 'Failed to restore stored peer policies', {
        error: error instanceof Error ? error.message : String(error)
      });
    } else {
      console.warn('[node] Failed to restore stored peer policies', error);
    }
  }

  // Minimal startup self-test: drop relays that reject kind 20004 (Bifrost)
  try {
    const tested = await filterRelaysForKindSupport(relays, 20004, addServerLog);
    if (tested.length === 0) {
      if (addServerLog) addServerLog('warning', 'All configured relays reject kind 20004; proceeding with original list but server may log policy rejections');
    } else if (tested.length < relays.length) {
      const dropped = relays.filter(r => !tested.includes(r));
      if (addServerLog) addServerLog('info', `Filtering ${dropped.length} relay(s) that reject kind 20004`, { dropped, kept: tested });
      relays = tested;
    }
  } catch (e) {
    if (addServerLog) addServerLog('warning', 'Relay self-test failed; using configured relays as-is', e);
  }
  
  if (addServerLog) {
    addServerLog('info', 'Creating and connecting node...');
  }
  
  try {
    // Use enhanced node creation with better connection management
    let connectionAttempts = 0;
    const maxAttempts = 5; // Increased from 3
    
    while (connectionAttempts < maxAttempts) {
      connectionAttempts++;
      
      try {
        if (addServerLog) {
          addServerLog('info', `Connection attempt ${connectionAttempts}/${maxAttempts} using ${relays.length} relays`);
        }
        
        const result = await createConnectedNode({
          group: groupCred,
          share: shareCred,
          relays,
          connectionTimeout: 30000,  // Increased to 30 seconds
          autoReconnect: true,       // Enable auto-reconnection
          ...(startupPolicies ? { policies: startupPolicies } : {})
        }, {
          enableLogging: false,      // Disable internal logging to avoid duplication
          logLevel: 'error'          // Only log errors from igloo-core
        });
        
        if (result.node) {
          const node = result.node as unknown as ServerBifrostNode;

          try {
            const timeoutMs = getOpTimeoutMs();
            const boundedTimeout = Math.max(5000, Math.min(timeoutMs, 120000));
            const client: any = node?.client;
            if (client && typeof client === 'object' && client.config && typeof client.config === 'object') {
              const currentTimeout = Number(client.config.req_timeout);
              const needsUpdate = !Number.isFinite(currentTimeout) || currentTimeout !== boundedTimeout;
              if (needsUpdate) {
                client.config.req_timeout = boundedTimeout;
                if (addServerLog) {
                  addServerLog('debug', `Adjusted node request timeout to ${boundedTimeout}ms`);
                }
              }
            }
          } catch (error) {
            if (addServerLog) {
              addServerLog('warn', 'Failed to adjust node request timeout', {
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }

          if (addServerLog) {
            addServerLog('info', 'Node connected and ready');

            // Log connection state info
            if (result.state) {
              addServerLog('info', `Connected to ${result.state.connectedRelays.length}/${relays.length} relays`);
              
              // Log which relays are connected
              if (result.state.connectedRelays.length > 0) {
                addServerLog('info', `Active relays: ${result.state.connectedRelays.join(', ')}`);
              }
              
              // Log detailed node state for diagnostics
              addServerLog('debug', 'Node state details', {
                isReady: result.state.isReady,
                isConnected: result.state.isConnected,
                isConnecting: result.state.isConnecting,
                relayCount: result.state.connectedRelays.length
              });
            }
            
            // Log internal client details for debugging keepalive
            const client = (node as any)._client || (node as any).client;
            if (client) {
              addServerLog('debug', 'Node client capabilities', {
                hasConnect: typeof client.connect === 'function',
                hasPing: typeof client.ping === 'function',
                hasClose: typeof client.close === 'function',
                hasUpdate: typeof client.update === 'function',
                isReady: client._is_ready || client.is_ready || false
              });

              // Wrap node for metrics via non-invasive proxies
              // Avoids mutating third-party internals
              // Note: internal library calls may not be intercepted
              // unless routed through exposed properties
            }
            
            // Check if node has ping capability
            if (typeof (node as any).ping === 'function') {
              addServerLog('debug', 'Node has ping capability for keepalive');
            } else {
              addServerLog('debug', 'Node lacks ping capability - will rely on relay reconnection for connectivity');
            }
          }
          
          // Create instrumented proxy and use it for subsequent operations
          const wrappedNode = createInstrumentedNode(node, addServerLog);

          // Perform initial connectivity check and await completion to avoid startup races
          if (addServerLog) {
            try {
              // Validate INITIAL_CONNECTIVITY_DELAY environment variable
              let initialDelay = 5000; // Safe default
              const envValue = process.env.INITIAL_CONNECTIVITY_DELAY;
              if (envValue) {
                const parsed = parseInt(envValue, 10);
                if (Number.isFinite(parsed) && parsed > 0) {
                  initialDelay = parsed;
                } else {
                  addServerLog('warning', `Invalid INITIAL_CONNECTIVITY_DELAY value: "${envValue}". Using default: ${initialDelay}ms`);
                }
              }
              await new Promise(resolve => setTimeout(resolve, initialDelay));
              const isConnected = await checkRelayConnectivity(wrappedNode, addServerLog);
              addServerLog('info', `Initial connectivity check: ${isConnected ? 'PASSED' : 'FAILED'}`);
    
              // If initial check fails, log a warning but don't fail node creation
              // The monitoring loop will handle recovery
              if (!isConnected) {
                addServerLog('warning', 'Initial connectivity check failed - monitoring will attempt recovery');
              }
            } catch (e) {
              addServerLog('error', 'Initial connectivity check threw an error', e);
              // Don't fail node creation - let monitoring handle it
            }
          }
          
          return wrappedNode;
        } else {
          throw new Error('Enhanced node creation returned no node');
        }
      } catch (enhancedError) {
        if (addServerLog) {
          addServerLog('warn', `Enhanced connection attempt ${connectionAttempts} failed: ${enhancedError instanceof Error ? enhancedError.message : 'Unknown error'}`);
        }
        
        // If this was the last attempt, try basic connection
        if (connectionAttempts === maxAttempts) {
          if (addServerLog) {
            addServerLog('info', 'All enhanced attempts failed, trying basic connection...');
          }
          
          try {
            const basicNode = await createAndConnectNode({
              group: groupCred,
              share: shareCred,
              relays,
              ...(configPolicies ? { policies: configPolicies } : {})
            });
            if (basicNode) {
              const node = basicNode as unknown as ServerBifrostNode;
              if (addServerLog) {
                addServerLog('info', 'Node connected and ready (basic mode)');
              }
              const wrappedNode = createInstrumentedNode(node, addServerLog);
              return wrappedNode;
            }
          } catch (basicError) {
            if (addServerLog) {
              addServerLog('error', `Basic connection also failed: ${basicError instanceof Error ? basicError.message : 'Unknown error'}`);
            }
          }
        } else {
          // Progressive backoff - wait longer between retries
          const waitTime = Math.min(2000 * connectionAttempts, 10000);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
  } catch (error) {
    if (addServerLog) {
      addServerLog('error', 'Failed to create initial Bifrost node', error);
    }
  }
  
  return null;
}

// Export health information
export function getNodeHealth() {
  return {
    ...nodeHealth,
    timeSinceLastActivity: Date.now() - nodeHealth.lastActivity.getTime(),
    timeSinceLastConnectivityCheck: Date.now() - nodeHealth.lastConnectivityCheck.getTime()
  };
}

// Export publish metrics for monitoring
export function getPublishMetrics() {
  const now = Date.now();
  const windowAge = now - publishMetrics.windowStart;
  const failureRate = publishMetrics.totalAttempts > 0
    ? (publishMetrics.totalFailures / publishMetrics.totalAttempts) * 100
    : 0;

  // Convert Maps to objects for JSON serialization
  const relayFailures: Record<string, number> = {};
  publishMetrics.failuresByRelay.forEach((count, relay) => {
    relayFailures[relay] = count;
  });

  const reasonBreakdown: Record<string, number> = {};
  publishMetrics.failuresByReason.forEach((count, reason) => {
    reasonBreakdown[reason] = count;
  });

  return {
    totalAttempts: publishMetrics.totalAttempts,
    totalFailures: publishMetrics.totalFailures,
    failureRate: failureRate.toFixed(1),
    windowAge: Math.round(windowAge / 1000), // seconds
    windowSize: METRICS_WINDOW / 1000, // seconds
    isAboveThreshold: publishMetrics.totalFailures > FAILURE_THRESHOLD,
    threshold: FAILURE_THRESHOLD,
    failuresByRelay: relayFailures,
    failuresByReason: reasonBreakdown
  };
}

// Export cleanup function
export function cleanupMonitoring() {
  stopConnectivityMonitoring();
}

// Reset monitoring state completely (for manual restarts)
export function resetHealthMonitoring() {
  nodeHealth = {
    lastActivity: new Date(),
    lastConnectivityCheck: new Date(),
    isConnected: true,
    consecutiveConnectivityFailures: 0
  };
} 
