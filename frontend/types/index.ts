// Base types from igloo-core and bifrost
export interface DecodedShare {
  binder_sn: string;
  hidden_sn: string;
  idx: number;
  seckey: string;
}

export interface DecodedGroup {
  threshold: number;
  group_pk: string;
  commits: Array<{
    idx: number;
    pubkey: string;
    hidden_pn: string;
    binder_pn: string;
  }>;
  relays?: string[];
}

export interface ValidationResult {
  isValid: boolean;
  message?: string;
}

// Igloo Share management types
export interface IglooShareMetadata {
  binder_sn?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface IglooShare {
  id: string;
  name: string;
  share: string;
  salt: string;
  groupCredential: string;
  savedAt?: string;
  shareCredential?: string;
  metadata?: IglooShareMetadata;
}

// Bifrost types (from @frostr/bifrost)
export interface SignatureEntry {
  id: string;
  pubkey: string;
  signature: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface ECDHPackage {
  type: 'ecdh';
  data: unknown;
  timestamp: number;
}

export interface SignSessionPackage {
  type: 'sign';
  data: unknown;
  timestamp: number;
}

// Bifrost Node types
export interface BifrostNode {
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  off: (event: string, callback?: (...args: unknown[]) => void) => void;
  disconnect: () => Promise<void>;
  // Add other node methods as needed
}

export interface NodeState {
  isReady: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  connectedRelays: string[];
}

export interface ConnectedNodeResult {
  node: BifrostNode;
  state: NodeState;
}

// Event Log types
export interface LogEntryData {
  timestamp: string;
  type: string;
  message: string;
  data?: unknown;
  id: string;
}

// Bifrost message types
export interface BifrostMessage {
  type: string;
  id?: string;
  tag?: string;
  content?: string;
  reason?: string;
  [key: string]: unknown;
}

// Console types for error handling
export interface ConsoleWarnOverride {
  (message: string, ...args: unknown[]): void;
}

// Generic data structure for rendering
export type RenderableData = DecodedGroup | DecodedShare | Record<string, unknown>;

// Signer types
export interface SignerHandle {
  stopSigner: () => Promise<void>;
  checkStatus: () => Promise<void>;
}

export interface SignerProps {
  initialData?: {
    share: string;
    groupCredential: string;
    name?: string;
    threshold?: number;
    totalShares?: number;
    relays?: string[];
  };
  authHeaders?: Record<string, string>;
  /**
   * Callback invoked when the `Signer` component is mounted and ready for interaction.
   * Consumers can safely call methods on the forwarded ref (e.g., `checkStatus`).
   */
  onReady?: () => void;
}

// Keyset types
export interface KeysetProps {
  groupCredential: string;
  shareCredentials: string[];
  name: string;
  onFinish?: () => void;
}

// Recovery types
export interface RecoverProps {
  initialShare?: string;
  initialGroupCredential?: string;
  defaultThreshold?: number;
  defaultTotalShares?: number;
}

// Noble crypto library types for test mocks
export interface NobleHashFunction {
  (data: Uint8Array): Uint8Array;
}

export interface NoblePBKDF2Options {
  c: number;
  dkLen: number;
}

export interface NobleCipher {
  encrypt: (data: Uint8Array) => Uint8Array;
  decrypt: (data: Uint8Array) => Uint8Array;
}

// Event handler types
export type EventCallback<T = unknown> = (data: T) => void;
export type BifrostEventCallback = (data: BifrostMessage) => void;
export type ECDHEventCallback = (data: BifrostMessage | BifrostMessage[]) => void;
export type SignEventCallback = (data: BifrostMessage | BifrostMessage[]) => void; 