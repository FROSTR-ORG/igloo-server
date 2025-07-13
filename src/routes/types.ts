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
  userId?: string;
  authenticated: boolean;
}

import type { ServerWebSocket } from 'bun';

// Base context for all routes - without updateNode function
export interface RouteContext {
  node: ServerBifrostNode | null;
  peerStatuses: Map<string, PeerStatus>;
  eventStreams: Set<ServerWebSocket<any>>;
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