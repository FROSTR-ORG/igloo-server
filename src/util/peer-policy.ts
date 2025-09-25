import type { NodePolicyInput } from '@frostr/igloo-core'

export interface PeerPolicyRecord {
  pubkey: string
  allowSend?: boolean
  allowReceive?: boolean
  label?: string
  note?: string
}

export const sanitizePeerPolicyEntries = (input: unknown): PeerPolicyRecord[] => {
  if (!Array.isArray(input)) return []

  const sanitized: PeerPolicyRecord[] = []
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const pubkeyRaw = typeof record.pubkey === 'string' ? record.pubkey.trim() : ''
    if (!pubkeyRaw) continue

    const allowSend = typeof record.allowSend === 'boolean' ? record.allowSend : undefined
    const allowReceive = typeof record.allowReceive === 'boolean' ? record.allowReceive : undefined
    const label = typeof record.label === 'string' && record.label.length > 0 ? record.label : undefined
    const note = typeof record.note === 'string' && record.note.length > 0 ? record.note : undefined

    const normalizedPubkey = pubkeyRaw.toLowerCase()
    const hasNonDefaultOverride =
      (allowSend === false) ||
      (allowReceive === false) ||
      label !== undefined ||
      note !== undefined

    if (!hasNonDefaultOverride) {
      continue
    }

    const sanitizedRecord: PeerPolicyRecord = {
      pubkey: normalizedPubkey,
      ...(allowSend !== undefined ? { allowSend } : {}),
      ...(allowReceive !== undefined ? { allowReceive } : {}),
      ...(label !== undefined ? { label } : {}),
      ...(note !== undefined ? { note } : {})
    }

    sanitized.push(sanitizedRecord)
  }

  return sanitized
}

export const mergePolicyInputs = (
  basePolicies: NodePolicyInput[] | undefined,
  overridePolicies: PeerPolicyRecord[]
): NodePolicyInput[] => {
  const merged = new Map<string, NodePolicyInput>()

  if (basePolicies) {
    for (const policy of basePolicies) {
      if (!policy?.pubkey) continue
      merged.set(policy.pubkey.toLowerCase(), { ...policy })
    }
  }

  for (const policy of overridePolicies) {
    const key = policy.pubkey.toLowerCase()
    const existing = merged.get(key)

    const overrideFields: Partial<NodePolicyInput> = {}
    if (typeof policy.allowSend === 'boolean') {
      overrideFields.allowSend = policy.allowSend
    }
    if (typeof policy.allowReceive === 'boolean') {
      overrideFields.allowReceive = policy.allowReceive
    }
    if (typeof policy.label === 'string' && policy.label.length > 0) {
      overrideFields.label = policy.label
    }
    if (typeof policy.note === 'string' && policy.note.length > 0) {
      overrideFields.note = policy.note
    }

    merged.set(key, {
      ...(existing ?? { pubkey: key }),
      ...overrideFields,
      pubkey: key,
      source: 'runtime'
    })
  }

  return Array.from(merged.values())
}
