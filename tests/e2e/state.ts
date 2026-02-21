import fs from 'fs';
import { z } from 'zod';

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

/**
 * Zod schema for SmokeTestState persisted by global-setup.
 * Validates shape and types before returning from loadState.
 */
const smokeTestStateSchema = z.object({
  port: z.number().int().positive(),
  baseUrl: z.string().min(1, 'baseUrl must be non-empty'),
  tmpDir: z.string(),
  serverPid: z.number().int().nonnegative(),
  cosignerPid: z.number().int().nonnegative(),
  sessionId: z.string().min(1, 'sessionId must be non-empty'),
  apiKey: z.string().nullable(),
  apiKeyId: z.string().nullable(),
  groupCredential: z.string(),
  shareCredentials: z.array(z.string()),
  groupPubkeyHex: z.string(),
  adminUsername: z.string(),
  adminPassword: z.string(),
  adminSecret: z.string(),
});

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
    const parsed: unknown = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const result = smokeTestStateSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map(i => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      throw new Error(`validation failed: ${issues}`);
    }
    return result.data as SmokeTestState;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid smoke test state in ${stateFile}: ${detail}`);
  }
}
