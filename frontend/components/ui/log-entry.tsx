import React, { memo, useCallback } from "react";
import { Badge } from "./badge";
import { ChevronRight, Info } from "lucide-react";
import { cn } from "../../lib/utils";

export interface LogEntryData {
  timestamp: string;
  type: string;
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  id: string;
}

interface LogEntryProps {
  log: LogEntryData;
}

// Map log types to badge variants
const getLogVariant = (type: string) => {
  switch(type) {
    case 'error': return 'error';
    case 'ready': return 'success';
    case 'disconnect': return 'warning';
    case 'bifrost': return 'info';
    case 'ecdh': return 'purple';
    case 'sign': return 'orange';
    default: return 'default';
  }
};

const truncateMiddle = (value: string, lead = 8, tail = 6) => {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
};

// Utility function to format log data with proper error handling
function formatLogData(data: any): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch (error) {
    // Try to provide more useful information about the data
    try {
      const dataType = typeof data;
      const isArray = Array.isArray(data);
      const constructorName = data?.constructor?.name;
      
      let preview = '';
      if (dataType === 'object' && data !== null) {
        try {
          const keys = Object.keys(data);
          preview = `Object with keys: [${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}]`;
        } catch {
          preview = `${constructorName || 'Object'} (non-enumerable)`;
        }
      } else {
        preview = `${dataType}: ${String(data).slice(0, 100)}${String(data).length > 100 ? '...' : ''}`;
      }
      
      return `Unable to serialize data to JSON
Type: ${isArray ? 'Array' : dataType}${constructorName ? ` (${constructorName})` : ''}
Preview: ${preview}
Error: ${error instanceof Error ? error.message : 'Circular reference or non-serializable data'}

This is likely a complex object from the Bifrost node containing circular references or functions.`;
    } catch {
      return 'Error: Unable to format data (complex object with circular references or non-serializable data)';
    }
  }
}

export const LogEntry = memo(({ log }: LogEntryProps) => {
  const [isMessageExpanded, setIsMessageExpanded] = React.useState(false);
  const hasData = log.data && Object.keys(log.data).length > 0;

  const handleClick = useCallback(() => {
    if (hasData) {
      setIsMessageExpanded(prev => !prev);
    }
  }, [hasData]);

  const signatureSummary = React.useMemo(() => {
    if (log.type !== 'sign' || !log.data) return null;
    const session = typeof log.data.session === 'string' ? log.data.session : null;
    const eventId = typeof log.data.eventId === 'string' ? log.data.eventId : null;
    const kind = typeof log.data.kind === 'number' ? log.data.kind : null;
    const parts: string[] = [];
    if (session) parts.push(`session ${truncateMiddle(session)}`);
    if (kind != null) parts.push(`kind ${kind}`);
    if (eventId) parts.push(`event ${truncateMiddle(eventId)}`);
    return parts.length ? parts.join(' · ') : null;
  }, [log]);

  const formattedData = React.useMemo(() => {
    if (!hasData) return null;
    return formatLogData(log.data);
  }, [log.data, hasData]);

  return (
    <div className="mb-2 last:mb-0 bg-gray-800/40 p-2 rounded hover:bg-gray-800/50 transition-colors">
      <div 
        className={cn(
          "flex items-center gap-2",
          hasData && "cursor-pointer select-none"
        )}
        onClick={handleClick}
        role={hasData ? "button" : undefined}
        tabIndex={hasData ? 0 : undefined}
        onKeyDown={hasData ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        } : undefined}
      >
        {hasData ? (
          <div 
            className="text-blue-400 transition-transform duration-200 w-4 h-4 flex-shrink-0" 
            style={{ 
              transform: isMessageExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
            aria-label={isMessageExpanded ? "Collapse details" : "Expand details"}
          >
            <ChevronRight className="h-4 w-4" />
          </div>
        ) : (
          <div className="w-4 h-4 flex-shrink-0 text-gray-600/30">
            <Info className="h-4 w-4" />
          </div>
        )}
        <span className="text-gray-500 text-xs font-light">{log.timestamp}</span>
        <Badge variant={getLogVariant(log.type)}>
          {log.type.toUpperCase()}
        </Badge>
        <span className="text-gray-300">{log.message}</span>
      </div>
      {signatureSummary && (
        <div className="mt-1 pl-6 text-[11px] text-gray-500 font-mono">
          {signatureSummary}
        </div>
      )}
      {hasData && (
        <div className={cn(
          "transition-all duration-200 ease-in-out overflow-hidden",
          isMessageExpanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
        )}>
          <pre className="mt-2 text-xs bg-gray-900/50 p-2 rounded overflow-x-auto text-gray-400 shadow-inner">
            {formattedData}
          </pre>
        </div>
      )}
    </div>
  );
});

LogEntry.displayName = 'LogEntry'; 
