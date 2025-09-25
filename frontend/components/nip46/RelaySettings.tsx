import React, { useState } from 'react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { IconButton } from '../ui/icon-button'
import { Plus, X } from 'lucide-react'

interface RelaySettingsProps {
  relays: string[]
  onAdd: (relay: string) => Promise<void>
  onRemove: (relay: string) => Promise<void>
  loading?: boolean
  saving?: boolean
  error?: string | null
}

export function RelaySettings({ relays, onAdd, onRemove, loading = false, saving = false, error }: RelaySettingsProps) {
  const [value, setValue] = useState('')

  const handleAdd = async () => {
    const input = value.trim()
    if (!input) return
    try {
      await onAdd(input)
      setValue('')
    } catch {
      // error surface handled via parent `error`
    }
  }

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void handleAdd()
    }
  }

  return (
    <div className="rounded-md border border-blue-900/30 bg-gray-900/30 p-4 space-y-3">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-blue-200">NIP-46 Relay Pool</h3>
          <p className="text-xs text-gray-400">Relays used for nostr-connect traffic. Defaults are applied when this list is empty.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="wss://relay.example.com"
            className="bg-gray-900/60 border-blue-900/30"
            disabled={saving}
          />
          <Button onClick={handleAdd} disabled={saving || !value.trim()} className="flex items-center gap-1">
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </div>

      {error ? (
        <div className="text-xs text-red-400">{error}</div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {loading ? (
          <span className="text-xs text-gray-400">Loading relays...</span>
        ) : relays.length === 0 ? (
          <span className="text-xs text-gray-500 italic">No relays configured</span>
        ) : (
          relays.map(relay => (
            <span key={relay} className="inline-flex items-center gap-2 bg-gray-900/60 border border-blue-900/30 rounded-full px-3 py-1 text-xs text-blue-100">
              {relay}
              <IconButton
                variant="ghost"
                size="sm"
                icon={<X className="h-3 w-3" />}
                tooltip="Remove relay"
                onClick={() => onRemove(relay)}
                disabled={saving}
              />
            </span>
          ))
        )}
      </div>
    </div>
  )
}
