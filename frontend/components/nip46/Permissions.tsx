import React, { useMemo } from 'react'
import type { Nip46SessionApi, PermissionPolicy } from './types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Badge } from '../ui/badge'
import { cn } from '../../lib/utils'
import { Code, Lock, Key, Shield, Sparkles, Wand2, Plus, Asterisk } from 'lucide-react'

const PERMISSION_METADATA: Array<{
  id: string
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  {
    id: 'get_public_key',
    label: 'Share identity pubkey',
    description: 'Allows the client to read the signer’s Nostr public key.',
    icon: Shield
  },
  {
    id: 'nip44_encrypt',
    label: 'Encrypt messages (NIP-44)',
    description: 'Enable modern content encryption between the client and signer.',
    icon: Key
  },
  {
    id: 'nip44_decrypt',
    label: 'Decrypt messages (NIP-44)',
    description: 'Allow the signer to decrypt NIP-44 payloads sent by the client.',
    icon: Key
  },
  {
    id: 'nip04_encrypt',
    label: 'Encrypt legacy payloads (NIP-04)',
    description: 'Support older clients that still rely on NIP-04 encryption.',
    icon: Lock
  },
  {
    id: 'nip04_decrypt',
    label: 'Decrypt legacy payloads (NIP-04)',
    description: 'Allow decrypting NIP-04 ciphertexts for backwards compatibility.',
    icon: Lock
  }
]

const RECOMMENDED_KINDS = [1, 4, 7] as const

const QUICK_ACTION_BUTTON_CLASSES =
  'flex items-center gap-1 rounded-md border border-blue-900/30 bg-gray-900/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-200 transition-colors hover:border-blue-500/60 hover:bg-blue-900/20 hover:text-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

const normalizePolicy = (policy?: PermissionPolicy | null): PermissionPolicy => ({
  methods: { ...(policy?.methods ?? {}) },
  kinds: { ...(policy?.kinds ?? {}) }
})

interface PermissionsDropdownProps {
  session: Nip46SessionApi
  editingPolicy: PermissionPolicy
  newEventKind: string
  saving?: boolean
  onPolicyChange: (policy: PermissionPolicy) => void
  onEventKindChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}

interface PermissionToggleProps {
  metadata: typeof PERMISSION_METADATA[number]
  enabled: boolean
  onToggle: (enabled: boolean) => void
}

const PermissionToggle: React.FC<PermissionToggleProps> = ({ metadata, enabled, onToggle }) => {
  const Icon = metadata.icon
  const controlId = React.useId()

  return (
    <label
      htmlFor={controlId}
      className={cn(
        'group flex items-start gap-3 rounded-lg border border-blue-900/30 bg-gray-900/40 p-3 transition-colors',
        'hover:border-blue-900/50 hover:bg-gray-900/60',
        enabled && 'border-blue-500/60 bg-blue-900/20'
      )}
    >
      <span className="mt-1 text-blue-300">
        <Icon className="h-4 w-4" />
      </span>
      <div className="flex flex-col gap-1 text-left">
        <span className="text-sm font-medium text-blue-100">{metadata.label}</span>
        <span className="text-xs leading-relaxed text-gray-400">{metadata.description}</span>
      </div>
      <input
        id={controlId}
        type="checkbox"
        className="ml-auto mt-1 h-4 w-4 rounded border-blue-900/60 bg-gray-950 text-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
        checked={enabled}
        onChange={(event) => onToggle(event.target.checked)}
      />
    </label>
  )
}

export function PermissionsDropdown({
  session,
  editingPolicy,
  newEventKind,
  saving,
  onPolicyChange,
  onEventKindChange,
  onSave,
  onCancel
}: PermissionsDropdownProps) {
  const policy = useMemo(() => normalizePolicy(editingPolicy), [editingPolicy])

  const applyPolicy = (mutate: (next: PermissionPolicy) => void) => {
    const next = normalizePolicy(policy)
    mutate(next)
    onPolicyChange(next)
  }

  const signEventEnabled = policy.methods?.sign_event === true
  const allKindsEnabled = policy.kinds?.['*'] === true

  const eventKinds = useMemo(() => {
    return Object.entries(policy.kinds || {})
      .filter(([key, value]) => key !== '*' && value)
      .map(([key]) => Number(key))
      .filter(value => Number.isFinite(value))
      .sort((a, b) => a - b)
  }, [policy.kinds])

  const allowedMethodCount = useMemo(
    () => Object.values(policy.methods || {}).filter(Boolean).length,
    [policy.methods]
  )
  const hasAnyKinds = useMemo(
    () => Object.values(policy.kinds || {}).some(Boolean),
    [policy.kinds]
  )
  const hasCustomPolicy = allowedMethodCount > 0 || hasAnyKinds

  const handleSignEventToggle = (enabled: boolean) => {
    applyPolicy(next => {
      next.methods.sign_event = enabled
      if (!enabled) {
        next.kinds = {}
      }
    })
    if (!enabled) {
      onEventKindChange('')
    }
  }

  const toggleMethod = (id: string, enabled: boolean) => {
    applyPolicy(next => {
      next.methods[id] = enabled
      if (id === 'sign_event' && !enabled) {
        next.kinds = {}
      }
    })
  }

  const addEventKind = (kind: number) => {
    applyPolicy(next => {
      next.methods.sign_event = true
      if (!Number.isFinite(kind)) return
      const key = String(kind)
      if (next.kinds[key]) return
      next.kinds[key] = true
    })
  }

  const removeEventKind = (kind: number) => {
    applyPolicy(next => {
      delete next.kinds[String(kind)]
      const stillEnabled = Object.values(next.kinds).some(Boolean)
      if (!stillEnabled) {
        next.methods.sign_event = false
      }
    })
    if (newEventKind === String(kind)) {
      onEventKindChange('')
    }
  }

  const toggleAllowAllKinds = (enabled: boolean) => {
    applyPolicy(next => {
      if (enabled) {
        next.methods.sign_event = true
        next.kinds['*'] = true
        return
      }
      delete next.kinds['*']
      const stillEnabled = Object.values(next.kinds).some(Boolean)
      if (!stillEnabled) {
        next.methods.sign_event = false
      }
    })
    if (!enabled) {
      onEventKindChange('')
    }
  }

  const clearEventKinds = () => {
    applyPolicy(next => {
      next.kinds = {}
      next.methods.sign_event = false
    })
    onEventKindChange('')
  }

  const handleAddKindFromInput = () => {
    const trimmed = newEventKind.trim()
    if (!/^\d+$/.test(trimmed)) return
    const numeric = Number(trimmed)
    if (!Number.isFinite(numeric)) return
    addEventKind(numeric)
    onEventKindChange('')
  }

  const applyRecommendedPreset = () => {
    applyPolicy(next => {
      next.methods.sign_event = true
      next.methods.get_public_key = true
      next.methods.nip44_encrypt = true
      next.methods.nip44_decrypt = true
      for (const kind of RECOMMENDED_KINDS) {
        next.kinds[String(kind)] = true
      }
    })
  }

  const handleResetPolicy = () => {
    onPolicyChange({ methods: {}, kinds: {} })
    onEventKindChange('')
  }

  const methodSummary = allowedMethodCount > 0
    ? `${allowedMethodCount} method${allowedMethodCount === 1 ? '' : 's'} auto-approved`
    : 'No methods auto-approved yet'

  const kindSummary = signEventEnabled
    ? allKindsEnabled
      ? 'All event kinds will auto-approve'
      : eventKinds.length > 0
        ? `${eventKinds.length} event kind${eventKinds.length === 1 ? '' : 's'} auto-approved`
        : 'Add event kinds to auto-approve signing'
    : 'Event signing requires manual approval'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="gap-1"
          onClick={applyRecommendedPreset}
          disabled={saving}
        >
          <Sparkles className="h-4 w-4" />
          Apply recommended
        </Button>
        {hasCustomPolicy ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1 text-blue-200 hover:text-blue-100"
            onClick={handleResetPolicy}
            disabled={saving}
          >
            <Wand2 className="h-4 w-4" />
            Reset overrides
          </Button>
        ) : null}
      </div>

      <div className="rounded-lg border border-blue-900/30 bg-gray-900/40 p-4 shadow-lg">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-100">
                <Code className="h-4 w-4 text-blue-300" />
                Sign event requests
              </div>
              <p className="text-xs leading-relaxed text-gray-400">
                Control which event kinds this client can auto-approve for remote signing.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-gray-400">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                {signEventEnabled ? 'Enabled' : 'Disabled'}
              </span>
              <input
                type="checkbox"
                checked={signEventEnabled}
                onChange={(event) => handleSignEventToggle(event.target.checked)}
                className="h-4 w-4 rounded border-blue-900/60 bg-gray-950 text-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
              />
            </label>
          </div>

          {signEventEnabled ? (
            <div className="space-y-3 rounded-lg border border-blue-900/30 bg-blue-900/15 p-3">
              <div className="flex flex-wrap gap-2">
                {allKindsEnabled ? (
                  <Badge variant="info" className="flex items-center gap-1 text-[11px] uppercase">
                    <Asterisk className="h-3.5 w-3.5" />
                    All kinds
                    <button
                      type="button"
                      className="ml-1 text-blue-200 hover:text-blue-100"
                      onClick={() => toggleAllowAllKinds(false)}
                    >
                      ×
                    </button>
                  </Badge>
                ) : eventKinds.length ? (
                  eventKinds.map(kind => (
                    <Badge key={kind} variant="info" className="flex items-center gap-1">
                      kind {kind}
                      <button
                        type="button"
                        className="text-blue-200 hover:text-blue-100"
                        onClick={() => removeEventKind(kind)}
                        aria-label={`Remove event kind ${kind}`}
                      >
                        ×
                      </button>
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs italic text-gray-400">
                    No event kinds added yet. Requests will require manual approval.
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="Add event kind (e.g. 1)"
                  value={newEventKind}
                  onChange={(event) => onEventKindChange(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleAddKindFromInput()}
                  disabled={allKindsEnabled}
                  className="h-9 w-full sm:max-w-[200px] border-blue-900/40 bg-gray-950/80 text-xs text-blue-100 placeholder:text-gray-500"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleAddKindFromInput}
                  disabled={allKindsEnabled || !newEventKind.trim()}
                  className="gap-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add kind
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                {RECOMMENDED_KINDS.map(kind => (
                  <button
                    key={kind}
                    type="button"
                    className={QUICK_ACTION_BUTTON_CLASSES}
                    onClick={() => addEventKind(kind)}
                    disabled={saving}
                  >
                    <Plus className="h-3 w-3" />
                    Kind {kind}
                  </button>
                ))}
                <button
                  type="button"
                  className={QUICK_ACTION_BUTTON_CLASSES}
                  onClick={() => toggleAllowAllKinds(!allKindsEnabled)}
                  disabled={saving}
                >
                  <Asterisk className="h-3 w-3" />
                  {allKindsEnabled ? 'Restrict kinds' : 'Allow any kind'}
                </button>
                {(eventKinds.length > 0 || allKindsEnabled) && (
                  <button
                    type="button"
                    className={QUICK_ACTION_BUTTON_CLASSES}
                    onClick={clearEventKinds}
                    disabled={saving}
                  >
                    <Wand2 className="h-3 w-3" />
                    Clear kinds
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-blue-900/30 bg-gray-900/40 p-4 shadow-lg">
        <div className="mb-3 text-sm font-semibold text-blue-100">Encryption & identity</div>
        <div className="grid gap-3 md:grid-cols-2">
          {PERMISSION_METADATA.map(metadata => (
            <PermissionToggle
              key={metadata.id}
              metadata={metadata}
              enabled={policy.methods?.[metadata.id] === true}
              onToggle={(value) => toggleMethod(metadata.id, value)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="text-xs text-gray-400 space-y-1">
          <div>{methodSummary}</div>
          <div>{kindSummary}</div>
        </div>
        <div className="flex items-center gap-2">
          {saving ? <Badge variant="info">Saving…</Badge> : null}
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={saving}>
            Save changes
          </Button>
        </div>
      </div>
    </div>
  )
}
