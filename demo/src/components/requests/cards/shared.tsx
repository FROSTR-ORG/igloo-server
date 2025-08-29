// Shared components for request cards
import type { PermRequest } from './types.js'

export function RequestCardHeader({ 
  request
}: { 
  request: PermRequest
}) {
  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  return (
    <div className="request-header">
      <div className="request-header-content">
        {request.session_origin && (
          <>
            {request.session_origin.image && (
              <img 
                src={request.session_origin.image} 
                alt={`${request.session_origin.name || 'Unknown'} icon`}
                className="request-origin-icon"
              />
            )}
            <div className="request-header-text">
              <div className="request-header-top">
                <span className="request-method">{request.method}</span>
                <span className="request-timestamp">
                  {formatTimestamp(request.timestamp)}
                </span>
              </div>
              <div className="request-origin-info">
                <span className="request-origin-name">
                  {request.session_origin.name ?? 'Unknown Session'}
                </span>
                {request.session_origin.url && (
                  <a 
                    href={request.session_origin.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="request-origin-url"
                  >
                    {new URL(request.session_origin.url).hostname}
                  </a>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function RequestCardBody({ 
  request, 
  isExpanded, 
  onToggleExpanded 
}: { 
  request: PermRequest
  isExpanded: boolean
  onToggleExpanded: () => void
}) {
  const formatContent = (content: unknown): string => {
    if (!content) return 'No content'
    if (typeof content === 'string') return content
    return JSON.stringify(content, null, 2)
  }

  const getContentPreview = (content: unknown): string => {
    const formatted = formatContent(content)
    if (formatted.length <= 100) return formatted
    return formatted.slice(0, 100) + '...'
  }

  return (
    <div className="request-body">
      <div className="request-content-container">
        <button
          onClick={onToggleExpanded}
          className="request-content-toggle"
          title={isExpanded ? 'Hide details' : 'Show details'}
        >
          {isExpanded ? '−' : '+'}
        </button>
        
        {!isExpanded && !!request.content && (
          <div className="request-content-preview">
            <pre className="request-content-text">
               {getContentPreview(request.content)}
             </pre>
          </div>
        )}
        
        {isExpanded && (
          <div className="request-content-full">
            <pre className="request-content-text">
               {formatContent(request.content)}
             </pre>
          </div>
        )}
      </div>
    </div>
  )
} 