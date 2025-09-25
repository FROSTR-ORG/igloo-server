// Shared types for route handlers

/**
 * Shared type for user IDs across different auth methods.
 *
 * Type Safety: Only JSON-serializable types
 * ------------------------------------------
 * This type excludes bigint to prevent JSON serialization errors.
 * - string: For large IDs that exceed Number.MAX_SAFE_INTEGER
 * - number: For standard numeric IDs within safe integer range
 *
 * For BigInt conversion, use the helper functions below:
 * - userIdFromBigInt(): Converts bigint to string representation
 * - parseUserIdSafe(): Parses input and returns serializable type
 */
export type UserId = string | number;

/**
 * Converts a bigint user ID to a JSON-serializable string format.
 * Use this when receiving bigint from database or other sources.
 */
export function userIdFromBigInt(id: bigint): UserId {
  return id.toString();
}

/**
 * Type guard to check if a value can be safely used as a UserId
 */
export function isValidUserId(value: unknown): value is UserId {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Number.isSafeInteger(value) && value > 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return false;
    try {
      const asBigInt = BigInt(trimmed);
      return asBigInt > 0n;
    } catch {
      return false;
    }
  }
  return false;
}

export interface PeerStatus {
  pubkey: string;
  online: boolean;
  lastSeen?: Date;
  latency?: number;
  lastPingAttempt?: Date;
}

// Allowed event types for Bifrost node
export type BifrostNodeEvent =
  | 'closed'
  | 'error'
  | 'ready'
  | 'bounced'
  | 'message'
  | '/ping/req'
  | '/ping/res'
  | '/sign/req'
  | '/sign/res'
  | '/sign/rej'
  | '/sign/ret'
  | '/sign/err'
  | '/ecdh/req'
  | '/ecdh/res'
  | '/ecdh/rej'
  | '/ecdh/ret'
  | '/ecdh/err';

// Ping result type for node.req.ping
export interface PingResult {
  ok: boolean;
  latency?: number;
  error?: string;
  [key: string]: any;
}

import type { BifrostNode } from '@frostr/bifrost';

// Align server node type with upstream BifrostNode to avoid casts/mismatches
export type ServerBifrostNode = BifrostNode;

export interface AuthContext {
  userId?: UserId; // Support string (env auth), number (database user id), and bigint
  authenticated: boolean;
  // password removed - should be passed as explicit parameter
}

// Per-request auth data with secure ephemeral getters for sensitive information
// Secrets are stored in non-enumerable/non-serializable storage and accessed via getters
// that clear the data after first access to prevent leakage
export interface RequestAuth {
  userId?: UserId;
  authenticated: boolean;
  // Removed password and derivedKey properties - access only via secure getters
  
  // Secure getter functions that clear sensitive data after first access
  // These access secrets from ephemeral storage (WeakMap/closure) and clear after reading
  getPassword?(): string | undefined;
  getDerivedKey?(): Uint8Array | undefined;
  destroySecrets?(): void;
}

import type { ServerWebSocket } from 'bun';

// WebSocket data type for event streams
type EventStreamData = { isEventStream: true };

// Base context for all routes - without updateNode function
export interface NodeCredentialSnapshot {
  group: string;
  share: string;
  relaysEnv?: string;
  peerPoliciesRaw?: string;
  source?: 'env' | 'dynamic';
}

export interface UpdateNodeOptions {
  credentials?: NodeCredentialSnapshot | null;
}

export interface RouteContext {
  node: ServerBifrostNode | null;
  peerStatuses: Map<string, PeerStatus>;
  eventStreams: Set<ServerWebSocket<EventStreamData>>;
  addServerLog: (type: string, message: string, data?: any) => void;
  broadcastEvent: (event: { type: string; message: string; data?: any; timestamp: string; id: string }) => void;
  auth?: AuthContext;
  requestId?: string;
  clientIp?: string;
  restartState?: {
    blockedByCredentials: boolean;
  };
}

// Privileged context for trusted/authenticated routes that need node management
export interface PrivilegedRouteContext extends RouteContext {
  // Synchronously updates the node reference and performs cleanup
  // Note: This is NOT async - it returns void, not Promise<void>
  updateNode: (newNode: ServerBifrostNode | null, options?: UpdateNodeOptions) => void;
}

export interface ApiResponse {
  headers: Record<string, string>;
} 
