import React from 'react'
import { PermissionPolicy, SignerSession } from './types'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Shield, Plus, X } from 'lucide-react'

// Common NIP-46 permissions (excluding non-configurable ones)
const COMMON_PERMISSIONS = [
  'sign_event',
  'nip04_encrypt',
  'nip04_decrypt',
  'nip44_encrypt',
  'nip44_decrypt'
]

interface PermissionsDropdownProps {
  session: SignerSession
  editingPermissions: PermissionPolicy
  newEventKind: string
  onPermissionChange: (permissions: PermissionPolicy) => void
  onEventKindChange: (eventKind: string) => void
  onUpdateSession: () => void
}

export function PermissionsDropdown({
  session,
  editingPermissions,
  newEventKind,
  onPermissionChange,
  onEventKindChange,
  onUpdateSession
}: PermissionsDropdownProps) {

  const updatePermission = (permission: string, enabled: boolean) => {
    onPermissionChange({
      ...editingPermissions,
      methods: {
        ...editingPermissions.methods,
        [permission]: enabled
      }
    })
  }

  const addEventKind = () => {
    const kind = parseInt(newEventKind || '0')
    if (isNaN(kind)) return

    onPermissionChange({
      ...editingPermissions,
      kinds: {
        ...editingPermissions.kinds,
        [kind]: true
      }
    })

    // Clear the input
    onEventKindChange('')
  }

  const removeEventKind = (kind: number) => {
    const updatedKinds = { ...editingPermissions.kinds }
    delete updatedKinds[kind]
    
    onPermissionChange({
      ...editingPermissions,
      kinds: updatedKinds
    })
  }

  return (
    <div className="session-permissions-dropdown">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="h-5 w-5 text-blue-400" />
        <h4 className="permissions-title">Permissions</h4>
      </div>
      
      <div className="permissions-list">
        {COMMON_PERMISSIONS.map(permission => {
          if (permission === 'sign_event') {
            const eventKinds = Object.keys(editingPermissions.kinds || {})
              .map(kind => parseInt(kind))
              .filter(kind => editingPermissions.kinds[kind])
              .sort((a, b) => a - b)
            
            return (
              <div key={permission} className="permission-item sign-event-permission">
                <div className="permission-header">
                  <span className="permission-name">{permission}</span>
                </div>
                <div className="event-kinds-list">
                  {eventKinds.length === 0 && (
                    <span className="text-xs text-gray-500 italic">No event kinds allowed</span>
                  )}
                  {eventKinds.map(kind => (
                    <div key={kind} className="event-kind-item">
                      <span className="event-kind-number">{kind}</span>
                      <button
                        onClick={() => removeEventKind(kind)}
                        className="remove-event-kind-btn"
                        title="Remove this event kind"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div className="add-event-kind">
                  <input
                    type="number"
                    placeholder="Event kind (e.g. 1)"
                    value={newEventKind}
                    onChange={(e) => onEventKindChange(e.target.value)}
                    className="event-kind-input"
                    onKeyPress={(e) => e.key === 'Enter' && addEventKind()}
                  />
                  <button
                    onClick={addEventKind}
                    className="add-event-kind-btn"
                    title="Add event kind"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>
              </div>
            )
          } else {
            const isEnabled = editingPermissions.methods?.[permission] === true
            
            return (
              <div key={permission} className="permission-item">
                <label className="permission-label">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(e) => updatePermission(permission, e.target.checked)}
                    className="permission-checkbox"
                  />
                  <span className="permission-name">{permission}</span>
                </label>
              </div>
            )
          }
        })}
      </div>
      
      <div className="permissions-actions">
        <Button
          onClick={onUpdateSession}
          className="permissions-update-btn bg-blue-600 hover:bg-blue-700 text-blue-100"
        >
          Update Permissions
        </Button>
      </div>
    </div>
  )
}