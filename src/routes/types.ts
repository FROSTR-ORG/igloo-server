// Shared types for route handlers

/**
 * Shared type for user IDs across different auth methods.
 * 
 * IMPORTANT: BigInt Serialization Warning
 * ----------------------------------------
 * The bigint type is included for flexibility but requires careful handling:
 * - JSON.stringify() does NOT natively support BigInt and will throw TypeError
 * - Before JSON serialization, convert bigint to string or number:
 *   - Use toString() for preserving large values: userId.toString()
 *   - Use Number() if value fits in safe integer range: Number(userId)
 * 
 * Current usage patterns in codebase:
 * - status.ts: Converts bigint to number after validation (lines 59-63)
 * - app-header.tsx: Converts to string for display: String(userId)
 * - No direct JSON serialization of raw userId found in Response.json() calls
 * 
 * Recommended: Always validate and convert bigint before serialization.
 */
export type UserId = string | number | bigint;

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
}

import type { ServerWebSocket } from 'bun';

// WebSocket data type for event streams
type EventStreamData = { isEventStream: true };

// Base context for all routes - without updateNode function
export interface RouteContext {
  node: ServerBifrostNode | null;
  peerStatuses: Map<string, PeerStatus>;
  eventStreams: Set<ServerWebSocket<EventStreamData>>;
  addServerLog: (type: string, message: string, data?: any) => void;
  broadcastEvent: (event: { type: string; message: string; data?: any; timestamp: string; id: string }) => void;
  auth?: AuthContext;
  requestId?: string;
  clientIp?: string;
}

// Privileged context for trusted/authenticated routes that need node management
export interface PrivilegedRouteContext extends RouteContext {
  updateNode: (newNode: ServerBifrostNode | null) => void;
}

export interface ApiResponse {
  headers: Record<string, string>;
} 