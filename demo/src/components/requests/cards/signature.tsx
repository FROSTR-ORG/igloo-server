// Note signature request card component
import { RequestCardHeader, RequestCardBody } from './shared.js'
import type { NoteSignatureCardProps, PermRequest } from './types.js'
import type { UseRequestsResult } from '@/demo/hooks/useRequests.js'

function NoteSignatureActions({ 
  request, 
  requests
}: {
  request: PermRequest
  requests: UseRequestsResult
}) {
  const { handleApprove, handleDeny, handleApproveAll, handleDenyAll, handleApproveAllKinds, handleDenyAllKinds } = requests
  // Extract event kind from content if available
  const getEventKind = (): number | null => {
    try {
      if (request.content && typeof request.content === 'object') {
        const content = request.content as any
        if (content.kind !== undefined) return content.kind
        // Try to parse if it's a JSON string
        if (typeof content === 'string') {
          const parsed = JSON.parse(content)
          return parsed.kind || null
        }
      }
      return null
    } catch {
      return null
    }
  }

  const eventKind = getEventKind()

  return (
    <div className="request-actions">
      <div className="request-actions-primary">
        <button
          onClick={() => handleApprove(request.id)}
          className="request-btn request-btn-approve"
        >
          Approve
        </button>
        <button
          onClick={() => handleDeny(request.id)}
          className="request-btn request-btn-deny"
        >
          Deny
        </button>
      </div>
      <div className="request-actions-bulk">
        <button
          onClick={handleApproveAll}
          className="request-btn request-btn-approve-all"
        >
          Approve All
        </button>
        <button
          onClick={handleDenyAll}
          className="request-btn request-btn-deny-all"
        >
          Deny All
        </button>
      </div>
      {eventKind !== null && (
        <div className="request-actions-kinds">
          <button
            onClick={() => handleApproveAllKinds(eventKind)}
            className="request-btn request-btn-approve-kinds"
          >
            Approve All Kind {eventKind}
          </button>
          <button
            onClick={() => handleDenyAllKinds(eventKind)}
            className="request-btn request-btn-deny-kinds"
          >
            Deny All Kind {eventKind}
          </button>
        </div>
      )}
    </div>
  )
}

export function NoteSignatureRequestCard(props: NoteSignatureCardProps) {
  const { request, requests } = props

  return (
    <div className="request-card request-card-signature">
      <RequestCardHeader 
        request={request}
      />
      <RequestCardBody 
        request={request} 
        isExpanded={props.isExpanded} 
        onToggleExpanded={() => requests.toggleExpanded(request.id)} 
      />
      <NoteSignatureActions 
        request={request}
        requests={requests}
      />
    </div>
  )
} 