import fs from 'fs';

export interface SmokeTestState {
  port: number;
  baseUrl: string;
  tmpDir: string;
  serverPid: number;
  cosignerPid: number;
  sessionId: string;
  apiKey: string | null;
  apiKeyId: string | null;
  groupCredential: string;
  shareCredentials: string[];
  groupPubkeyHex: string; // x-only (no 02/03 prefix), used for NIP-44/NIP-04
  adminUsername: string;
  adminPassword: string;
  adminSecret: string;
}

const STUB: SmokeTestState = {
  port: 18002,
  baseUrl: 'http://localhost:18002',
  tmpDir: '',
  serverPid: 0,
  cosignerPid: 0,
  sessionId: '',
  apiKey: null,
  apiKeyId: null,
  groupCredential: '',
  shareCredentials: [],
  groupPubkeyHex: '',
  adminUsername: '',
  adminPassword: '',
  adminSecret: '',
};

/**
 * Load shared test state written by global-setup.
 * During test discovery (--list) or if SMOKE_STATE_FILE is not yet set, returns
 * a harmless stub so that module-level const initialisations succeed.
 * The real values are always present when tests actually execute.
 */
export function loadState(): SmokeTestState {
  const stateFile = process.env.SMOKE_STATE_FILE;
  if (!stateFile) return STUB;
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8')) as SmokeTestState;
  } catch {
    return STUB;
  }
}
