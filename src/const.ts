// Parse RELAYS environment variable more robustly
export const RELAYS: string[] = (() => {
  const relaysEnv = process.env['RELAYS'];
  if (!relaysEnv) return [];
  
  try {
    // Try to parse as JSON first
    if (relaysEnv.startsWith('[')) {
      const parsed = JSON.parse(relaysEnv);
      if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
        return parsed;
      } else {
        // Not a valid array of strings
        return [];
      }
    } else {
      // Handle comma-separated strings
      return relaysEnv.split(',').map(url => url.trim()).filter(url => url.length > 0);
    }
  } catch {
    return [];
  }
})();

export const HOST_NAME = process.env['HOST_NAME'] ?? 'localhost'
export const HOST_PORT = parseInt(process.env['HOST_PORT'] ?? '8002', 10)

// Raw credential strings for igloo-core functions - treat empty/whitespace as absent
export const GROUP_CRED = (() => {
  const cred = process.env['GROUP_CRED'];
  if (!cred) return undefined;
  const trimmed = cred.trim();
  return trimmed.length > 0 ? trimmed : undefined;
})();

export const SHARE_CRED = (() => {
  const cred = process.env['SHARE_CRED'];
  if (!cred) return undefined;
  const trimmed = cred.trim();
  return trimmed.length > 0 ? trimmed : undefined;
})();

// Admin secret for initial onboarding - treat empty/whitespace and sentinel value as absent
const shouldAutoGenerateAdminSecret = (() => {
  const ci = typeof process.env['CI'] === 'string' && process.env['CI']?.toLowerCase() === 'true';
  const nodeEnvTest = process.env['NODE_ENV'] === 'test';
  const explicit = typeof process.env['AUTO_ADMIN_SECRET'] === 'string' && process.env['AUTO_ADMIN_SECRET']?.toLowerCase() === 'true';
  return ci || nodeEnvTest || explicit;
})();

export const ADMIN_SECRET = (() => {
  const rawSecret = process.env['ADMIN_SECRET'];
  const trimmed = typeof rawSecret === 'string' ? rawSecret.trim() : undefined;

  const isUnset = !trimmed || trimmed === 'REQUIRED_ADMIN_SECRET_NOT_SET';

  if (isUnset && shouldAutoGenerateAdminSecret) {
    const fallback = 'ci-auto-admin-secret';
    process.env['ADMIN_SECRET'] = fallback;
    console.warn('[init] ADMIN_SECRET was unset. Generated ephemeral secret for CI/test environment.');
    return fallback;
  }

  if (!trimmed) return undefined;
  return trimmed.length > 0 ? trimmed : undefined;
})();

// Headless mode - parse boolean flexibly, treat empty/whitespace as false
export const HEADLESS = (() => {
  const value = process.env['HEADLESS'];
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  const normalized = trimmed.toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
})();

// Helper function to check if credentials are available
export const hasCredentials = () => GROUP_CRED !== undefined && SHARE_CRED !== undefined

// Skip admin secret validation during onboarding (for Umbrel and similar managed deployments)
// When true, users skip the "Enter Admin Secret" screen and go directly to account creation.
// The ADMIN_SECRET is still set and used internally, but users don't need to enter it manually.
export const SKIP_ADMIN_SECRET_VALIDATION = (() => {
  const value = process.env['SKIP_ADMIN_SECRET_VALIDATION'];
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  const normalized = trimmed.toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
})();
