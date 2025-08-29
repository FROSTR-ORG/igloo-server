import { useClientCtx } from '@/demo/context/client.js'
import { useRequests } from '@/demo/hooks/useRequests.js'

import {
  BaseRequestCard,
  NoteSignatureRequestCard
} from './cards/index.js'

export function RequestsView() {
  const ctx = useClientCtx()
  const requestsHook = useRequests()
  const { pendingRequests, expanded, isLoading, notificationEnabled } = requestsHook

  // Show locked state if client is locked
  if (ctx.status === 'locked') {
    return (
      <div className="requests-container">
        <h2 className="section-header">Permission Requests</h2>
        <p className="requests-error">🔒 Please unlock your client to view permission requests</p>
      </div>
    )
  }

  // Show loading state if client is null but not locked
  if (isLoading) {
    return (
      <div className="requests-container">
        <h2 className="section-header">Permission Requests</h2>
        <p className="requests-empty">Loading...</p>
      </div>
    )
  }

  return (
    <div className="requests-container">
      <h2 className="section-header">Permission Requests</h2>
      
      {/* Show notification status */}
      {notificationEnabled && (
        <div style={{ 
          backgroundColor: '#4CAF50', 
          color: '#fff', 
          padding: '8px 12px', 
          borderRadius: '4px', 
          marginBottom: '10px',
          fontSize: '14px'
        }}>
          🔔 Notifications enabled - you'll be notified of new requests
        </div>
      )}
      
      {/* Show offline warning if client is offline */}
      {ctx.status === 'offline' && (
        <div style={{ 
          backgroundColor: '#ffa500', 
          color: '#000', 
          padding: '10px', 
          borderRadius: '4px', 
          marginBottom: '10px' 
        }}>
          ⚠️ Client is offline. New requests will not appear until connection is restored.
        </div>
      )}

      {/* Pending Requests */}
      <div className="requests-section">
        {pendingRequests.length === 0 ? (
          <p className="requests-empty">No pending requests</p>
        ) : (
          <div className="requests-list">
            {pendingRequests.map((request) => {
              const isExpanded = expanded.has(request.id)
              
              if (request.request_type === 'note_signature') {
                return (
                  <NoteSignatureRequestCard
                    key={request.id}
                    request={request}
                    isExpanded={isExpanded}
                    requests={requestsHook}
                  />
                )
              } else {
                return (
                  <BaseRequestCard
                    key={request.id}
                    request={request}
                    isExpanded={isExpanded}
                    requests={requestsHook}
                  />
                )
              }
            })}
          </div>
        )}
      </div>
    </div>
  )
}
