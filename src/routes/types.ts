// Shared types for route handlers

export interface PeerStatus {
  pubkey: string;
  online: boolean;
  lastSeen?: Date;
  latency?: number;
  lastPingAttempt?: Date;
}

export interface ServerBifrostNode {
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  req: {
    ping: (pubkey: string) => Promise<unknown>;
    // Add other req methods if needed
  };
  // Add other properties/methods as needed
}

export interface AuthContext {
  userId?: string;
  authenticated: boolean;
}

export interface RouteContext {
  node: ServerBifrostNode | null;
  peerStatuses: Map<string, PeerStatus>;
  eventStreams: Set<ReadableStreamDefaultController>;
  addServerLog: (type: string, message: string, data?: any) => void;
  broadcastEvent: (event: { type: string; message: string; data?: any; timestamp: string; id: string }) => void;
  updateNode?: (newNode: ServerBifrostNode | null) => void;
  auth?: AuthContext;
}

export interface ApiResponse {
  headers: Record<string, string>;
} 