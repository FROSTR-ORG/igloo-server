// Base request card component
import { RequestCardHeader, RequestCardBody } from './shared.js'
import type { BaseCardProps, PermRequest } from './types.js'
import type { UseRequestsResult } from '@/demo/hooks/useRequests.js'

function BaseRequestActions({ 
  request, 
  requests 
}: { 
  request: PermRequest
  requests: UseRequestsResult 
}) {
  const { handleApprove, handleDeny, handleApproveAll, handleDenyAll } = requests
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
    </div>
  )
}

export function BaseRequestCard(props: BaseCardProps) {
  const { request, requests } = props

  return (
    <div className="request-card">
      <RequestCardHeader 
        request={request}
      />
      <RequestCardBody 
        request={request} 
        isExpanded={props.isExpanded} 
        onToggleExpanded={() => requests.toggleExpanded(request.id)} 
      />
      <BaseRequestActions 
        request={request}
        requests={requests}
      />
    </div>
  )
} 