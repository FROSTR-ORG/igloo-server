// Shared types for route handlers

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

export interface ServerBifrostNode {
  on: (
    event: BifrostNodeEvent,
    callback:
      | ((...args: any[]) => void) // fallback for unknown events
      | ((error: Error) => void) // 'error'
      | (() => void) // 'closed'
      | ((data: any) => void) // 'ready', 'message', etc.
      | ((reason: string, msg: any) => void) // 'bounced'
  ) => void;
  req: {
    ping: (pubkey: string) => Promise<PingResult>;
    // Add other req methods if needed
  };
  // Add other properties/methods as needed
}

export interface AuthContext {
  userId?: string | number; // Support both string (env auth) and number (database user id)
  authenticated: boolean;
  // password removed - should be passed as explicit parameter
}

// Per-request auth data that includes sensitive information
export interface RequestAuth {
  userId?: string | number;
  authenticated: boolean;
  password?: string; // Transient password for database users - never stored in context
  readonly derivedKey?: Uint8Array | ArrayBuffer; // Derived key for decryption operations (binary, non-serializable) - only Uint8Array/Buffer accepted in practice
  
  // Secure getter functions that clear sensitive data after first access
  getPassword?(): string | undefined;
  getDerivedKey?(): Uint8Array | ArrayBuffer | undefined;
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
}

// Privileged context for trusted/authenticated routes that need node management
export interface PrivilegedRouteContext extends RouteContext {
  updateNode: (newNode: ServerBifrostNode | null) => void;
}

export interface ApiResponse {
  headers: Record<string, string>;
} 