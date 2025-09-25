import { promises as fs } from 'fs'
import path from 'path'
import { sanitizePeerPolicyEntries, type PeerPolicyRecord } from '../util/peer-policy.js'

const DATA_DIR = path.join(process.cwd(), 'data')
const POLICY_FILE = path.join(DATA_DIR, 'peer-policies.json')

async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 })
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error
  }
}

async function writeJsonAtomic(filePath: string, payload: object): Promise<void> {
  const tempPath = `${filePath}.tmp`
  const data = `${JSON.stringify(payload, null, 2)}\n`
  await fs.writeFile(tempPath, data, { mode: 0o600 })
  await fs.rename(tempPath, filePath)
}

export const loadFallbackPeerPolicies = async (): Promise<PeerPolicyRecord[]> => {
  try {
    const raw = await fs.readFile(POLICY_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return sanitizePeerPolicyEntries(parsed)
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return []
    }
    console.warn('[peer-policy-store] Failed to load fallback peer policies:', error)
    return []
  }
}

export const saveFallbackPeerPolicies = async (
  policies: PeerPolicyRecord[] | null
): Promise<void> => {
  if (!policies || policies.length === 0) {
    try {
      await fs.unlink(POLICY_FILE)
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
    }
    return
  }

  const sanitized = sanitizePeerPolicyEntries(policies)
  if (sanitized.length === 0) {
    await saveFallbackPeerPolicies(null)
    return
  }

  await ensureDataDir()
  await writeJsonAtomic(POLICY_FILE, sanitized)
}
