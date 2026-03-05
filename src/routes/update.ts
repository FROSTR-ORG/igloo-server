import { RouteContext, RequestAuth } from './types.js';
import { getSecureCorsHeaders, mergeVaryHeaders } from './utils.js';
import { HEADLESS, SKIP_ADMIN_SECRET_VALIDATION } from '../const.js';
import { readFileSync } from 'fs';

type UpdateSource = 'github-release' | 'github-tags';

interface UpdateResult {
  latestVersion: string;
  releaseUrl?: string;
  source: UpdateSource;
}

interface CachedUpdate {
  fetchedAt: number;
  result?: UpdateResult;
  error?: string;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  normalized: string;
}

interface UpdateResponse {
  enabled: boolean;
  managedDeployment: boolean;
  currentVersion: string;
  updateAvailable: boolean;
  latestVersion?: string;
  releaseUrl?: string;
  checkedAt?: string;
  source?: UpdateSource;
  error?: string;
}

const UPDATE_CHECK_TIMEOUT_MS = parseInt(process.env['UPDATE_CHECK_TIMEOUT_MS'] ?? '5000', 10) || 5000;
const UPDATE_CHECK_TTL_MS = parseInt(process.env['UPDATE_CHECK_TTL_MS'] ?? '21600000', 10) || 21_600_000; // 6 hours
const UPDATE_CHECK_FAILURE_TTL_MS = parseInt(process.env['UPDATE_CHECK_FAILURE_TTL_MS'] ?? '900000', 10) || 900_000; // 15 minutes
const ALLOW_PRERELEASE_UPDATES = parseBoolean(process.env['ALLOW_PRERELEASE_UPDATES']);

const GITHUB_OWNER = 'FROSTR-ORG';
const GITHUB_REPO = 'igloo-server';
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const TAGS_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/tags?per_page=100`;

const PACKAGE_JSON_URL = new URL('../../package.json', import.meta.url);

let cachedVersion: string | null = null;
let cachedUpdate: CachedUpdate | null = null;

function parseBoolean(value?: string): boolean {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  return trimmed === 'true' || trimmed === '1' || trimmed === 'yes';
}

function getCurrentVersion(): string {
  const override = process.env['APP_VERSION']?.trim();
  if (override) return override;

  if (cachedVersion) return cachedVersion;
  try {
    const raw = readFileSync(PACKAGE_JSON_URL, 'utf8');
    const data = JSON.parse(raw) as { version?: string };
    if (typeof data.version === 'string' && data.version.trim().length > 0) {
      cachedVersion = data.version.trim();
      return cachedVersion;
    }
  } catch (error) {
    console.warn('[update-check] Failed to read package.json version:', error);
  }
  cachedVersion = '0.0.0';
  return cachedVersion;
}

function parseVersion(raw: string, allowPrerelease: boolean): ParsedVersion | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withoutPrefix = trimmed.startsWith('v') || trimmed.startsWith('V')
    ? trimmed.slice(1)
    : trimmed;
  const dashIdx = withoutPrefix.indexOf('-');
  const core = dashIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, dashIdx);
  const prerelease = dashIdx === -1 ? undefined : withoutPrefix.slice(dashIdx + 1);
  const parts = core.split('.');
  if (parts.length < 3) return null;
  if (parts.some(p => p === '' || !/^\d+$/.test(p))) return null;

  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = Number(parts[2]);

  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }

  if (prerelease && !allowPrerelease) return null;

  return {
    major,
    minor,
    patch,
    prerelease: prerelease ?? null,
    normalized: `${major}.${minor}.${patch}`
  };
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) return a.prerelease.localeCompare(b.prerelease);

  return 0;
}

function isCacheValid(cache: CachedUpdate): boolean {
  const ttl = cache.error ? UPDATE_CHECK_FAILURE_TTL_MS : UPDATE_CHECK_TTL_MS;
  return Date.now() - cache.fetchedAt < ttl;
}

function buildHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'igloo-server'
  };
  const token = process.env['GITHUB_TOKEN']?.trim();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLatestVersion(): Promise<UpdateResult> {
  const headers = buildHeaders();
  const releaseResponse = await fetchWithTimeout(RELEASES_URL, { headers });

  if (releaseResponse.ok) {
    const payload = await releaseResponse.json() as { tag_name?: string; html_url?: string };
    const tagName = typeof payload.tag_name === 'string' ? payload.tag_name : '';
    const parsed = parseVersion(tagName, ALLOW_PRERELEASE_UPDATES);
    if (parsed) {
      return {
        latestVersion: parsed.normalized,
        releaseUrl: typeof payload.html_url === 'string' ? payload.html_url : undefined,
        source: 'github-release'
      };
    }
  }

  const tagsResponse = await fetchWithTimeout(TAGS_URL, { headers });
  if (!tagsResponse.ok) {
    throw new Error(`GitHub tag fetch failed with status ${tagsResponse.status}`);
  }

  const tags = await tagsResponse.json() as Array<{ name?: string }>;
  let latest: ParsedVersion | null = null;
  let latestRaw: string | null = null;

  for (const tag of tags) {
    if (!tag?.name) continue;
    const parsed = parseVersion(tag.name, ALLOW_PRERELEASE_UPDATES);
    if (!parsed) continue;
    if (!latest || compareVersions(parsed, latest) > 0) {
      latest = parsed;
      latestRaw = tag.name;
    }
  }

  if (!latest) {
    throw new Error('No valid semver tags found in GitHub response.');
  }

  const tagName = latestRaw ?? `v${latest.normalized}`;
  return {
    latestVersion: latest.normalized,
    releaseUrl: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/tree/${tagName}`,
    source: 'github-tags'
  };
}

export async function handleUpdateRoute(
  req: Request,
  url: URL,
  _context: RouteContext,
  _auth?: RequestAuth | null
): Promise<Response | null> {
  if (url.pathname !== '/api/update') return null;

  const corsHeaders = getSecureCorsHeaders(req);
  const mergedVary = mergeVaryHeaders(corsHeaders);

  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'Vary': mergedVary,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-ID',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  }

  const managedDeployment = HEADLESS || SKIP_ADMIN_SECRET_VALIDATION || parseBoolean(process.env['MANAGED_DEPLOYMENT']);
  const updateCheckDisabled = parseBoolean(process.env['UPDATE_CHECK_DISABLED']);
  const updateCheckEnabled = !managedDeployment && !updateCheckDisabled;
  const currentVersion = getCurrentVersion();

  if (!updateCheckEnabled) {
    const response: UpdateResponse = {
      enabled: false,
      managedDeployment,
      currentVersion,
      updateAvailable: false
    };
    return Response.json(response, { headers });
  }

  if (!cachedUpdate || !isCacheValid(cachedUpdate)) {
    try {
      const result = await fetchLatestVersion();
      cachedUpdate = { fetchedAt: Date.now(), result };
    } catch (error) {
      cachedUpdate = {
        fetchedAt: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown update check error'
      };
    }
  }

  if (!cachedUpdate || !cachedUpdate.result) {
    const response: UpdateResponse = {
      enabled: true,
      managedDeployment,
      currentVersion,
      updateAvailable: false,
      checkedAt: new Date(cachedUpdate?.fetchedAt ?? Date.now()).toISOString(),
      error: cachedUpdate?.error ?? 'Update check unavailable'
    };
    return Response.json(response, { headers });
  }

  const currentParsed = parseVersion(currentVersion, true);
  const latestParsed = parseVersion(cachedUpdate.result.latestVersion, true);

  const updateAvailable = Boolean(
    currentParsed &&
    latestParsed &&
    compareVersions(latestParsed, currentParsed) > 0
  );

  const response: UpdateResponse = {
    enabled: true,
    managedDeployment,
    currentVersion,
    updateAvailable,
    latestVersion: cachedUpdate.result.latestVersion,
    releaseUrl: cachedUpdate.result.releaseUrl,
    source: cachedUpdate.result.source,
    checkedAt: new Date(cachedUpdate.fetchedAt).toISOString()
  };

  return Response.json(response, { headers });
}
