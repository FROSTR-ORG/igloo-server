import React from "react";
import { EventLog as UIEventLog } from "@/components/ui/event-log";
import type { LogEntryData } from "@/components/ui/log-entry";

export type { LogEntryData } from "@/components/ui/log-entry";

export interface EventLogProps {
  logs: LogEntryData[];
  isSignerRunning: boolean;
  onClearLogs: () => void;
  hideHeader?: boolean;
}

export const EventLog: React.FC<EventLogProps> = ({ logs, isSignerRunning, onClearLogs, hideHeader }) => {
  return (
    <UIEventLog
      logs={logs}
      isSignerRunning={isSignerRunning}
      onClearLogs={onClearLogs}
      hideHeader={hideHeader}
    />
  );
}; 





import React, { useRef, useEffect, useCallback, memo, useState, useMemo } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, ChevronDown, ChevronUp, Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogEntry, type LogEntryData } from "@/components/ui/log-entry";

interface EventLogProps {
  logs: LogEntryData[];
  isSignerRunning?: boolean;
  onClearLogs: () => void;
  title?: string;
  hideHeader?: boolean;
}

export const EventLog = memo(({ 
  logs, 
  isSignerRunning = false, 
  onClearLogs,
  title = "Event Log",
  hideHeader = false
}: EventLogProps) => {
  const logEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  // Get unique event types from logs
  const availableEventTypes = useMemo(() => {
    const types = new Set(logs.map(log => log.type));
    return Array.from(types).sort();
  }, [logs]);

  // Filter logs based on active filters
  const filteredLogs = useMemo(() => {
    if (activeFilters.size === 0) {
      return logs;
    }
    return logs.filter(log => activeFilters.has(log.type));
  }, [logs, activeFilters]);

  const scrollToBottom = useCallback(() => {
    if (!containerRef.current) return;
    
    const { scrollHeight, clientHeight } = containerRef.current;
    const maxScrollTop = scrollHeight - clientHeight;
    const isScrolledNearBottom = containerRef.current.scrollTop >= maxScrollTop - 100;

    if (isScrolledNearBottom) {
      logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    if (isExpanded) {
      scrollToBottom();
    }
  }, [filteredLogs, isExpanded, scrollToBottom]);

  const handleClearClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClearLogs();
  }, [onClearLogs]);

  const handleFilterToggle = useCallback((eventType: string) => {
    setActiveFilters(prev => {
      const newFilters = new Set(prev);
      if (newFilters.has(eventType)) {
        newFilters.delete(eventType);
      } else {
        newFilters.add(eventType);
      }
      return newFilters;
    });
  }, []);

  const handleSelectAllFilters = useCallback(() => {
    setActiveFilters(new Set(availableEventTypes));
  }, [availableEventTypes]);

  const handleClearFilters = useCallback(() => {
    setActiveFilters(new Set());
  }, []);

  const getStatusIndicator = () => {
    if (logs.length === 0) return 'success';
    return isSignerRunning ? 'success' : 'error';
  };

  // Map log types to badge variants for filter buttons
  const getFilterVariant = (type: string) => {
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

  const actions = (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 italic">
        {isExpanded ? "Click to collapse" : "Click to expand"}
      </span>
      <IconButton
        variant="default"
        size="sm"
        icon={<Filter className="h-4 w-4" />}
        onClick={(e) => {
          e.stopPropagation();
          setShowFilters(prev => !prev);
        }}
        tooltip="Toggle filters"
        className={cn(
          "transition-all duration-200",
          (showFilters || activeFilters.size > 0) 
            ? "bg-blue-600/20 text-blue-400 border-blue-500/30" 
            : "hover:bg-gray-600/30"
        )}
      />
      <IconButton
        variant="default"
        size="sm"
        icon={<Trash2 className="h-4 w-4" />}
        onClick={handleClearClick}
        tooltip="Clear logs"
      />
    </div>
  );

  const handleToggle = () => {
    setIsExpanded(prev => !prev);
  };

  return (
    <div>
      {!hideHeader && (
        <div 
          className="flex items-center justify-between bg-gray-800/50 p-2.5 rounded cursor-pointer hover:bg-gray-800/70 transition-colors"
          onClick={handleToggle}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleToggle();
            }
          }}
        >
          <div className="flex items-center gap-2">
            {isExpanded ? 
              <ChevronUp className="h-4 w-4 text-blue-400" /> : 
              <ChevronDown className="h-4 w-4 text-blue-400" />
            }
            <span className="text-blue-200 text-sm font-medium select-none">{title}</span>
            <StatusIndicator 
              status={getStatusIndicator()}
              count={activeFilters.size > 0 ? filteredLogs.length : logs.length}
            />
            {activeFilters.size > 0 && (
              <Badge variant="info" className="text-xs px-1.5 py-0.5 bg-blue-600/20 text-blue-400 border-blue-500/30">
                {activeFilters.size} filter{activeFilters.size !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          <div onClick={e => e.stopPropagation()}>
            {actions}
          </div>
        </div>
      )}
      
      {/* Filter Controls */}
      {showFilters && isExpanded && availableEventTypes.length > 0 && (
        <div className="bg-gray-900/30 border border-gray-800/30 rounded p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-blue-200 text-sm font-medium">Filter by Event Type</span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAllFilters}
                className="text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-600/10 h-6 px-2"
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-600/20 h-6 px-2"
              >
                Clear All
              </Button>
              <IconButton
                variant="ghost"
                size="sm"
                icon={<X className="h-3 w-3" />}
                onClick={() => setShowFilters(false)}
                tooltip="Close filters"
                className="h-6 w-6 text-gray-500 hover:text-gray-300 hover:bg-gray-600/20"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {availableEventTypes.map((eventType) => {
              const isActive = activeFilters.has(eventType);
              const count = logs.filter(log => log.type === eventType).length;
              
              return (
                <button
                  key={eventType}
                  onClick={() => handleFilterToggle(eventType)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-all duration-200",
                    "border hover:scale-[1.02] active:scale-[0.98]",
                    isActive 
                      ? "bg-gray-800/60 border-gray-600/70 text-gray-100 shadow-sm" 
                      : "bg-gray-800/40 border-gray-700/50 text-gray-400 hover:text-gray-300 hover:bg-gray-800/50 hover:border-gray-600/60"
                  )}
                >
                  <Badge variant={getFilterVariant(eventType)} className="text-xs px-1.5 py-0.5">
                    {eventType.toUpperCase()}
                  </Badge>
                  <span className="text-gray-500 font-light">({count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      
      <div 
        className={cn(
          "transition-all duration-300 ease-in-out overflow-hidden",
          isExpanded ? "max-h-[300px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div 
          ref={containerRef}
          className="bg-gray-900/30 rounded border border-gray-800/30 p-3 overflow-y-auto h-[300px] scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900/30"
        >
          {filteredLogs.length > 0 ? (
            <>
              {filteredLogs.map((log) => (
                <LogEntry key={log.id} log={log} />
              ))}
              <div ref={logEndRef} />
            </>
          ) : logs.length > 0 && activeFilters.size > 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3">
                <p className="text-gray-500 text-sm">No logs match the current filters</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                  className="text-blue-400 hover:text-blue-300 hover:bg-blue-600/10 text-xs"
                >
                  Clear Filters
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500 text-sm">No logs available</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

EventLog.displayName = 'EventLog'; 





import React, { memo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";

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

export const LogEntry = memo(({ log }: LogEntryProps) => {
  const [isMessageExpanded, setIsMessageExpanded] = React.useState(false);
  const hasData = log.data && Object.keys(log.data).length > 0;

  const handleClick = useCallback(() => {
    if (hasData) {
      setIsMessageExpanded(prev => !prev);
    }
  }, [hasData]);

  const formattedData = React.useMemo(() => {
    if (!hasData) return null;
    try {
      return JSON.stringify(log.data, null, 2);
    } catch (error) {
      // Try to provide more useful information about the data
      try {
        const dataType = typeof log.data;
        const isArray = Array.isArray(log.data);
        const constructorName = log.data?.constructor?.name;
        
        let preview = '';
        if (dataType === 'object' && log.data !== null) {
          try {
            const keys = Object.keys(log.data);
            preview = `Object with keys: [${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}]`;
          } catch {
            preview = `${constructorName || 'Object'} (non-enumerable)`;
          }
        } else {
          preview = `${dataType}: ${String(log.data).slice(0, 100)}${String(log.data).length > 100 ? '...' : ''}`;
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






import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Tooltip } from "@/components/ui/tooltip"
import { createConnectedNode, validateShare, validateGroup, decodeShare, decodeGroup, cleanupBifrostNode } from "@frostr/igloo-core"
import { Copy, Check, X, HelpCircle, ChevronDown, ChevronRight, User } from "lucide-react"
import type { SignatureEntry, ECDHPackage, SignSessionPackage, BifrostNode } from '@frostr/bifrost'
import { EventLog, type LogEntryData } from "./EventLog"
import { Input } from "@/components/ui/input"
import PeerList from "@/components/ui/peer-list"
import type {
  SignerHandle,
  SignerProps
} from '@/types';

// Add CSS for the pulse animation
const pulseStyle = `
  @keyframes pulse {
    0% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.6;
      transform: scale(1.1);
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }
  
  .pulse-animation {
    animation: pulse 1.5s ease-in-out infinite;
    box-shadow: 0 0 5px 2px rgba(34, 197, 94, 0.6);
  }
`;

// Event mapping for cleaner message handling
const EVENT_MAPPINGS = {
  '/sign/req': { type: 'sign', message: 'Signature request received' },
  '/sign/res': { type: 'sign', message: 'Signature response sent' },
  '/sign/rej': { type: 'sign', message: 'Signature request rejected' },
  '/sign/ret': { type: 'sign', message: 'Signature shares aggregated' },
  '/sign/err': { type: 'sign', message: 'Signature share aggregation failed' },
  '/ecdh/req': { type: 'ecdh', message: 'ECDH request received' },
  '/ecdh/res': { type: 'ecdh', message: 'ECDH response sent' },
  '/ecdh/rej': { type: 'ecdh', message: 'ECDH request rejected' },
  '/ecdh/ret': { type: 'ecdh', message: 'ECDH shares aggregated' },
  '/ecdh/err': { type: 'ecdh', message: 'ECDH share aggregation failed' },
  '/ping/req': { type: 'bifrost', message: 'Ping request' },
  '/ping/res': { type: 'bifrost', message: 'Ping response' },
} as const;

const DEFAULT_RELAY = "wss://relay.primal.net";

// Helper function to extract share information
const getShareInfo = (groupCredential: string, shareCredential: string, shareName?: string) => {
  try {
    if (!groupCredential || !shareCredential) return null;

    const decodedGroup = decodeGroup(groupCredential);
    const decodedShare = decodeShare(shareCredential);

    // Find the corresponding commit in the group
    const commit = decodedGroup.commits.find(c => c.idx === decodedShare.idx);

    if (commit) {
      return {
        index: decodedShare.idx,
        pubkey: commit.pubkey,
        shareName: shareName || `Share ${decodedShare.idx}`,
        threshold: decodedGroup.threshold,
        totalShares: decodedGroup.commits.length
      };
    }

    return null;
  } catch (error) {
    return null;
  }
};

const Signer = forwardRef<SignerHandle, SignerProps>(({ initialData }, ref) => {
  const [isSignerRunning, setIsSignerRunning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [signerSecret, setSignerSecret] = useState(initialData?.share || "");
  const [isShareValid, setIsShareValid] = useState(false);
  const [relayUrls, setRelayUrls] = useState<string[]>([DEFAULT_RELAY]);
  const [newRelayUrl, setNewRelayUrl] = useState("");

  const [groupCredential, setGroupCredential] = useState(initialData?.groupCredential || "");
  const [isGroupValid, setIsGroupValid] = useState(false);

  const [copiedStates, setCopiedStates] = useState({
    group: false,
    share: false
  });
  const [expandedItems, setExpandedItems] = useState<Record<'group' | 'share', boolean>>({
    group: false,
    share: false
  });
  const [logs, setLogs] = useState<LogEntryData[]>([]);

  const nodeRef = useRef<BifrostNode | null>(null);
  // Track cleanup functions for event listeners to prevent memory leaks
  const cleanupListenersRef = useRef<(() => void)[]>([]);

  // Expose the stopSigner method to parent components through ref
  useImperativeHandle(ref, () => ({
    stopSigner: async () => {
      console.log('External stopSigner method called');
      if (isSignerRunning) {
        await handleStopSigner();
      }
    }
  }));

  // Helper function to safely detect duplicate log entries
  const isDuplicateLog = (newData: unknown, recentLogs: LogEntryData[]): boolean => {
    if (!newData || typeof newData !== 'object') {
      return false;
    }

    // Fast path: check for duplicate IDs and tags without serialization
    if ('id' in newData && 'tag' in newData && newData.id && newData.tag) {
      return recentLogs.some(log =>
        log.data &&
        typeof log.data === 'object' &&
        'id' in log.data &&
        'tag' in log.data &&
        log.data.id === newData.id &&
        log.data.tag === newData.tag
      );
    }

    // Fallback: safe serialization comparison for complex objects
    try {
      const newDataString = JSON.stringify(newData);
      return recentLogs.some(log => {
        if (!log.data) return false;

        try {
          const logDataString = typeof log.data === 'string'
            ? log.data
            : JSON.stringify(log.data);
          return logDataString === newDataString;
        } catch {
          // If serialization fails, assume not duplicate to avoid false positives
          return false;
        }
      });
    } catch {
      // If initial serialization fails (circular refs, etc.), skip duplicate check
      return false;
    }
  };

  const addLog = useCallback((type: string, message: string, data?: unknown) => {
    const timestamp = new Date().toLocaleTimeString();
    const id = Math.random().toString(36).substr(2, 9);

    setLogs(prev => {
      // Only check for duplicates if we have data to compare
      if (data) {
        const recentLogs = prev.slice(-5); // Check last 5 entries for performance
        if (isDuplicateLog(data, recentLogs)) {
          return prev; // Skip adding duplicate
        }
      }

      return [...prev, { timestamp, type, message, data, id }];
    });
  }, []);

  // Extracted event handling functions with cleanup capabilities
  const setupBasicEventListeners = useCallback((node: BifrostNode) => {
    const closedHandler = () => {
      addLog('bifrost', 'Bifrost node is closed');
      setIsSignerRunning(false);
      setIsConnecting(false);
    };

    const errorHandler = (error: unknown) => {
      addLog('error', 'Node error', error);
      setIsSignerRunning(false);
      setIsConnecting(false);
    };

    const readyHandler = (data: unknown) => {
      // Log basic info about the ready event without the potentially problematic data object
      const logData = data && typeof data === 'object' ?
        { message: 'Node ready event received', hasData: true, dataType: typeof data } :
        data;
      addLog('ready', 'Node is ready', logData);
      setIsConnecting(false);
      setIsSignerRunning(true);
    };

    const bouncedHandler = (reason: string, msg: unknown) =>
      addLog('bifrost', `Message bounced: ${reason}`, msg);

    // Add event listeners
    node.on('closed', closedHandler);
    node.on('error', errorHandler);
    node.on('ready', readyHandler);
    node.on('bounced', bouncedHandler);

    // Return cleanup function
    return () => {
      try {
        node.off('closed', closedHandler);
        node.off('error', errorHandler);
        node.off('ready', readyHandler);
        node.off('bounced', bouncedHandler);
      } catch (error) {
        console.warn('Error removing basic event listeners:', error);
      }
    };
  }, [addLog, setIsSignerRunning, setIsConnecting]);

  const setupMessageEventListener = useCallback((node: BifrostNode) => {
    const messageHandler = (msg: unknown) => {
      try {
        if (msg && typeof msg === 'object' && 'tag' in msg) {
          const messageData = msg as { tag: unknown;[key: string]: unknown };
          const tag = messageData.tag;

          // Ensure tag is a string before calling string methods
          if (typeof tag !== 'string') {
            addLog('bifrost', 'Message received (invalid tag type)', {
              tagType: typeof tag,
              tag,
              originalMessage: msg
            });
            return;
          }

          // Use the event mapping for cleaner code
          const eventInfo = EVENT_MAPPINGS[tag as keyof typeof EVENT_MAPPINGS];
          if (eventInfo) {
            addLog(eventInfo.type, eventInfo.message, msg);
          } else if (tag.startsWith('/sign/')) {
            addLog('sign', `Signature event: ${tag}`, msg);
          } else if (tag.startsWith('/ecdh/')) {
            addLog('ecdh', `ECDH event: ${tag}`, msg);
          } else if (tag.startsWith('/ping/')) {
            addLog('bifrost', `Ping event: ${tag}`, msg);
          } else {
            addLog('bifrost', `Message received: ${tag}`, msg);
          }
        } else {
          addLog('bifrost', 'Message received (no tag)', msg);
        }
      } catch (error) {
        addLog('bifrost', 'Error parsing message event', { error, originalMessage: msg });
      }
    };

    // Add event listener
    node.on('message', messageHandler);

    // Return cleanup function
    return () => {
      try {
        node.off('message', messageHandler);
      } catch (error) {
        console.warn('Error removing message event listener:', error);
      }
    };
  }, [addLog]);

  const setupLegacyEventListeners = useCallback((node: BifrostNode) => {
    const nodeAny = node as any;
    const cleanupFunctions: (() => void)[] = [];

    // Legacy direct event listeners for backward compatibility
    const legacyEvents = [
      // ECDH events
      { event: '/ecdh/sender/req', type: 'ecdh', message: 'ECDH request sent' },
      { event: '/ecdh/sender/res', type: 'ecdh', message: 'ECDH responses received' },
      { event: '/ecdh/handler/req', type: 'ecdh', message: 'ECDH request received' },
      { event: '/ecdh/handler/res', type: 'ecdh', message: 'ECDH response sent' },
      // Signature events
      { event: '/sign/sender/req', type: 'sign', message: 'Signature request sent' },
      { event: '/sign/sender/res', type: 'sign', message: 'Signature responses received' },
      { event: '/sign/handler/req', type: 'sign', message: 'Signature request received' },
      { event: '/sign/handler/res', type: 'sign', message: 'Signature response sent' },
      // Note: Ping events are handled by the main message handler - no duplicates needed
    ];

    legacyEvents.forEach(({ event, type, message }) => {
      try {
        const handler = (msg: unknown) => addLog(type, message, msg);
        nodeAny.on(event, handler);
        cleanupFunctions.push(() => {
          try {
            nodeAny.off(event, handler);
          } catch (e) {
            // Silently ignore cleanup errors for legacy events
          }
        });
      } catch (e) {
        // Silently ignore if event doesn't exist
      }
    });

    // Special handlers for events with different signatures
    try {
      const ecdhSenderRejHandler = (reason: string, pkg: ECDHPackage) =>
        addLog('ecdh', `ECDH request rejected: ${reason}`, pkg);
      const ecdhSenderRetHandler = (reason: string, pkgs: string) =>
        addLog('ecdh', `ECDH shares aggregated: ${reason}`, pkgs);
      const ecdhSenderErrHandler = (reason: string, msgs: unknown[]) =>
        addLog('ecdh', `ECDH share aggregation failed: ${reason}`, msgs);
      const ecdhHandlerRejHandler = (reason: string, msg: unknown) =>
        addLog('ecdh', `ECDH rejection sent: ${reason}`, msg);

      node.on('/ecdh/sender/rej', ecdhSenderRejHandler);
      node.on('/ecdh/sender/ret', ecdhSenderRetHandler);
      node.on('/ecdh/sender/err', ecdhSenderErrHandler);
      node.on('/ecdh/handler/rej', ecdhHandlerRejHandler);

      cleanupFunctions.push(() => {
        try {
          node.off('/ecdh/sender/rej', ecdhSenderRejHandler);
          node.off('/ecdh/sender/ret', ecdhSenderRetHandler);
          node.off('/ecdh/sender/err', ecdhSenderErrHandler);
          node.off('/ecdh/handler/rej', ecdhHandlerRejHandler);
        } catch (e) {
          console.warn('Error removing ECDH event listeners:', e);
        }
      });

      const signSenderRejHandler = (reason: string, pkg: SignSessionPackage) =>
        addLog('sign', `Signature request rejected: ${reason}`, pkg);
      const signSenderRetHandler = (reason: string, msgs: SignatureEntry[]) =>
        addLog('sign', `Signature shares aggregated: ${reason}`, msgs);
      const signSenderErrHandler = (reason: string, msgs: unknown[]) =>
        addLog('sign', `Signature share aggregation failed: ${reason}`, msgs);
      const signHandlerRejHandler = (reason: string, msg: unknown) =>
        addLog('sign', `Signature rejection sent: ${reason}`, msg);

      node.on('/sign/sender/rej', signSenderRejHandler);
      node.on('/sign/sender/ret', signSenderRetHandler);
      node.on('/sign/sender/err', signSenderErrHandler);
      node.on('/sign/handler/rej', signHandlerRejHandler);

      cleanupFunctions.push(() => {
        try {
          node.off('/sign/sender/rej', signSenderRejHandler);
          node.off('/sign/sender/ret', signSenderRetHandler);
          node.off('/sign/sender/err', signSenderErrHandler);
          node.off('/sign/handler/rej', signHandlerRejHandler);
        } catch (e) {
          console.warn('Error removing signature event listeners:', e);
        }
      });

      // Note: Ping events are handled by the main message handler and PeerList component
      // No need for additional ping event handlers here as they create duplicate/useless logs
    } catch (e) {
      addLog('bifrost', 'Error setting up some legacy event listeners', e);
    }

    // Return consolidated cleanup function
    return () => {
      cleanupFunctions.forEach(cleanup => {
        try {
          cleanup();
        } catch (error) {
          console.warn('Error in legacy event listener cleanup:', error);
        }
      });
    };
  }, [addLog]);

  // Clean up event listeners before node cleanup
  const cleanupEventListeners = useCallback(() => {
    cleanupListenersRef.current.forEach(cleanup => {
      try {
        cleanup();
      } catch (error) {
        console.warn('Error cleaning up event listeners:', error);
      }
    });
    cleanupListenersRef.current = [];
  }, []);

  // Clean node cleanup using igloo-core
  const cleanupNode = useCallback(() => {
    if (nodeRef.current) {
      // First clean up our event listeners
      cleanupEventListeners();

      // Temporarily suppress console.warn to hide expected igloo-core warnings
      const originalWarn = console.warn;
      const warnOverride = (message: string, ...args: unknown[]) => {
        // Only suppress the specific expected warning about removeAllListeners
        if (typeof message === 'string' && message.includes('removeAllListeners not available')) {
          return; // Skip this expected warning
        }
        originalWarn(message, ...args);
      };
      console.warn = warnOverride;

      try {
        // Use igloo-core's cleanup - it handles the manual cleanup internally
        cleanupBifrostNode(nodeRef.current);
      } catch (error) {
        console.error('Unexpected error during cleanup:', error);
      } finally {
        // Restore original console.warn
        console.warn = originalWarn;
        nodeRef.current = null;
      }
    }
  }, [cleanupEventListeners]);

  // Add effect to cleanup on unmount
  useEffect(() => {
    // Cleanup function that runs when component unmounts
    return () => {
      if (nodeRef.current) {
        addLog('info', 'Signer stopped due to page navigation');
        cleanupNode();
      }
    };
  }, [addLog, cleanupNode]); // Include dependencies

  // Validate initial data
  useEffect(() => {
    if (initialData?.share) {
      const validation = validateShare(initialData.share);
      setIsShareValid(validation.isValid);
    }

    if (initialData?.groupCredential) {
      const validation = validateGroup(initialData.groupCredential);
      setIsGroupValid(validation.isValid);
    }
  }, [initialData]);

  const handleCopy = async (text: string, field: 'group' | 'share') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStates(prev => ({ ...prev, [field]: true }));
      setTimeout(() => {
        setCopiedStates(prev => ({ ...prev, [field]: false }));
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const toggleExpanded = (id: 'group' | 'share') => {
    setExpandedItems(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Memoize decoded data to avoid repeated decoding on every render
  // Only decode when the corresponding pane is expanded to improve performance
  const decodedGroupData = useMemo(() => {
    if (!expandedItems.group || !groupCredential || !isGroupValid) return null;
    try {
      return decodeGroup(groupCredential);
    } catch (error) {
      console.warn('Failed to decode group credential:', error);
      return null;
    }
  }, [expandedItems.group, groupCredential, isGroupValid]);

  const decodedShareData = useMemo(() => {
    if (!expandedItems.share || !signerSecret || !isShareValid) return null;
    try {
      return decodeShare(signerSecret);
    } catch (error) {
      console.warn('Failed to decode share credential:', error);
      return null;
    }
  }, [expandedItems.share, signerSecret, isShareValid]);

  const renderDecodedInfo = (data: unknown, rawString?: string) => {
    // Safe JSON stringification with error handling
    const getJsonString = (obj: unknown): string => {
      try {
        return JSON.stringify(obj, null, 2);
      } catch (error) {
        // Handle circular references and other serialization errors
        try {
          // Attempt to stringify with a replacer function to handle circular refs
          const seen = new WeakSet();
          return JSON.stringify(obj, (key, value) => {
            if (typeof value === 'object' && value !== null) {
              if (seen.has(value)) {
                return '[Circular Reference]';
              }
              seen.add(value);
            }
            return value;
          }, 2);
        } catch (fallbackError) {
          // Final fallback - show error message
          return `[Serialization Error: ${error instanceof Error ? error.message : 'Unknown error'}]`;
        }
      }
    };

    return (
      <div className="space-y-3">
        {rawString && (
          <div className="space-y-1">
            <div className="text-xs text-gray-400 font-medium">Raw String:</div>
            <div className="bg-gray-900/50 p-3 rounded text-xs text-blue-300 font-mono break-all">
              {rawString}
            </div>
          </div>
        )}
        <div className="space-y-1">
          <div className="text-xs text-gray-400 font-medium">Decoded Data:</div>
          <pre className="bg-gray-900/50 p-3 rounded text-xs text-blue-300 font-mono overflow-x-auto">
            {getJsonString(data)}
          </pre>
        </div>
      </div>
    );
  };

  const handleShareChange = (value: string) => {
    setSignerSecret(value);
    const validation = validateShare(value);

    // Try deeper validation with bifrost decoder if basic validation passes
    if (validation.isValid && value.trim()) {
      try {
        // If this doesn't throw, it's a valid share
        const decodedShare = decodeShare(value);

        // Additional structure validation could be done here
        if (typeof decodedShare.idx !== 'number' ||
          typeof decodedShare.seckey !== 'string' ||
          typeof decodedShare.binder_sn !== 'string' ||
          typeof decodedShare.hidden_sn !== 'string') {
          setIsShareValid(false);
          return;
        }

        setIsShareValid(true);
      } catch {
        setIsShareValid(false);
      }
    } else {
      setIsShareValid(validation.isValid);
    }
  };

  const handleGroupChange = (value: string) => {
    setGroupCredential(value);
    const validation = validateGroup(value);

    // Try deeper validation with bifrost decoder if basic validation passes
    if (validation.isValid && value.trim()) {
      try {
        // If this doesn't throw, it's a valid group
        const decodedGroup = decodeGroup(value);

        // Additional structure validation
        if (typeof decodedGroup.threshold !== 'number' ||
          typeof decodedGroup.group_pk !== 'string' ||
          !Array.isArray(decodedGroup.commits) ||
          decodedGroup.commits.length === 0) {
          setIsGroupValid(false);
          return;
        }

        setIsGroupValid(true);
      } catch {
        setIsGroupValid(false);
      }
    } else {
      setIsGroupValid(validation.isValid);
    }
  };

  const handleAddRelay = () => {
    if (newRelayUrl && !relayUrls.includes(newRelayUrl)) {
      setRelayUrls([...relayUrls, newRelayUrl]);
      setNewRelayUrl("");
    }
  };

  const handleRemoveRelay = (urlToRemove: string) => {
    setRelayUrls(relayUrls.filter(url => url !== urlToRemove));
  };

  const handleStartSigner = async () => {
    if (!isShareValid || !isGroupValid || relayUrls.length === 0) {
      addLog('error', 'Missing or invalid required fields');
      return;
    }

    try {
      // Ensure cleanup before starting
      cleanupNode();
      setIsConnecting(true);
      addLog('info', 'Creating and connecting node...');

      // Use the improved createConnectedNode API which returns enhanced state info
      const result = await createConnectedNode({
        group: groupCredential,
        share: signerSecret,
        relays: relayUrls
      });

      nodeRef.current = result.node;

      // Set up all event listeners using our extracted functions
      const cleanupBasic = setupBasicEventListeners(result.node);
      const cleanupMessage = setupMessageEventListener(result.node);
      const cleanupLegacy = setupLegacyEventListeners(result.node);

      // Use the enhanced state info from createConnectedNode
      if (result.state.isReady) {
        addLog('info', 'Node connected and ready');
        setIsConnecting(false);
        setIsSignerRunning(true);
      } else {
        addLog('warning', 'Node created but not yet ready, waiting...');
        // Keep connecting state until ready
      }

      // Add cleanup functions to cleanupListenersRef
      cleanupListenersRef.current.push(cleanupBasic);
      cleanupListenersRef.current.push(cleanupMessage);
      cleanupListenersRef.current.push(cleanupLegacy);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', 'Failed to start signer', { error: errorMessage });
      cleanupNode();
      setIsSignerRunning(false);
      setIsConnecting(false);
    }
  };

  const handleStopSigner = async () => {
    try {
      cleanupNode();
      addLog('info', 'Signer stopped');
      setIsSignerRunning(false);
      setIsConnecting(false);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', 'Failed to stop signer', { error: errorMessage });
    }
  };

  const handleSignerButtonClick = () => {
    if (isSignerRunning) {
      handleStopSigner();
    } else {
      handleStartSigner();
    }
  };

  return (
    <div className="space-y-6">
      {/* Add the pulse style */}
      <style>{pulseStyle}</style>
      <div className="flex items-center">
        <h2 className="text-blue-300 text-lg">Start your signer to handle requests</h2>
        <Tooltip
          trigger={<HelpCircle size={18} className="ml-2 text-blue-400 cursor-pointer" />}
          position="right"
          content={
            <>
              <p className="mb-2 font-semibold">Important:</p>
              <p>The signer must be running to handle signature requests from clients. When active, it will communicate with other nodes through your configured relays.</p>
            </>
          }
        />
      </div>

      {/* Share Information Header */}
      {(() => {
        const shareInfo = getShareInfo(groupCredential, signerSecret, initialData?.name);
        return shareInfo && isGroupValid && isShareValid ? (
          <div className="border border-blue-800/30 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <User className="h-5 w-5 text-blue-400" />
                <span className="text-blue-200 font-medium">{shareInfo.shareName}</span>
              </div>
              <div className="text-gray-400">•</div>
              <div className="text-gray-300 text-sm">
                Index: <span className="text-blue-400 font-mono">{shareInfo.index}</span>
              </div>
              <div className="text-gray-400">•</div>
              <div className="text-gray-300 text-sm">
                Threshold: <span className="text-blue-400">{shareInfo.threshold}</span>/<span className="text-blue-400">{shareInfo.totalShares}</span>
              </div>
            </div>
            <div className="mt-2">
              <div className="text-gray-300 text-sm">
                Pubkey: <span className="font-mono text-xs truncate block">{shareInfo.pubkey}</span>
              </div>
            </div>
          </div>
        ) : null;
      })()}

      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex">
            <Tooltip
              trigger={
                <Input
                  type="text"
                  value={groupCredential}
                  onChange={(e) => handleGroupChange(e.target.value)}
                  className="bg-gray-800/50 border-gray-700/50 text-blue-300 py-2 text-sm w-full font-mono"
                  disabled={isSignerRunning || isConnecting}
                  placeholder="Enter your group credential (bfgroup...)"
                  aria-label="Group credential input"
                />
              }
              position="top"
              triggerClassName="w-full block"
              content={
                <>
                  <p className="mb-2 font-semibold">Group Credential:</p>
                  <p>
                    This is your group data that contains the public information about
                    your keyset, including the threshold and group public key. It starts
                    with &apos;bfgroup&apos; and is shared among all signers. It is used to
                    identify the group and the threshold for signing.
                  </p>
                </>
              }
            />
            <Tooltip
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleCopy(groupCredential, 'group')}
                  className="ml-2 bg-blue-800/30 text-blue-400 hover:text-blue-300 hover:bg-blue-800/50"
                  disabled={!groupCredential || !isGroupValid}
                  aria-label="Copy group credential"
                >
                  {copiedStates.group ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                </Button>
              }
              position="top"
              width="w-fit"
              content="Copy"
            />
            <Tooltip
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => toggleExpanded('group')}
                  className="ml-2 bg-blue-800/30 text-blue-400 hover:text-blue-300 hover:bg-blue-800/50"
                  disabled={!groupCredential || !isGroupValid}
                  aria-label="Toggle group credential details"
                >
                  {expandedItems['group'] ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </Button>
              }
              position="top"
              width="w-fit"
              content="Decoded"
            />
          </div>

          {expandedItems['group'] && groupCredential && isGroupValid && (
            <div className="mt-2">
              {decodedGroupData ? (
                renderDecodedInfo(decodedGroupData, groupCredential)
              ) : (
                <div className="bg-red-900/30 p-3 rounded text-xs text-red-300">
                  Failed to decode group credential
                </div>
              )}
            </div>
          )}

          <div className="flex">
            <Tooltip
              trigger={
                <Input
                  type="password"
                  value={signerSecret}
                  onChange={(e) => handleShareChange(e.target.value)}
                  className="bg-gray-800/50 border-gray-700/50 text-blue-300 py-2 text-sm w-full font-mono"
                  disabled={isSignerRunning || isConnecting}
                  placeholder="Enter your secret share (bfshare...)"
                  aria-label="Secret share input"
                />
              }
              position="top"
              triggerClassName="w-full block"
              content={
                <>
                  <p className="mb-2 font-semibold">Secret Share:</p>
                  <p>This is an individual secret share of the private key. Your keyset is split into shares and this is one of them. It starts with &apos;bfshare&apos; and should be kept private and secure. Each signer needs a share to participate in signing.</p>
                </>
              }
            />
            <Tooltip
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleCopy(signerSecret, 'share')}
                  className="ml-2 bg-blue-800/30 text-blue-400 hover:text-blue-300 hover:bg-blue-800/50"
                  disabled={!signerSecret || !isShareValid}
                  aria-label="Copy secret share"
                >
                  {copiedStates.share ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                </Button>
              }
              position="top"
              width="w-fit"
              content="Copy"
            />
            <Tooltip
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => toggleExpanded('share')}
                  className="ml-2 bg-blue-800/30 text-blue-400 hover:text-blue-300 hover:bg-blue-800/50"
                  disabled={!signerSecret || !isShareValid}
                  aria-label="Toggle share details"
                >
                  {expandedItems['share'] ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </Button>
              }
              position="top"
              width="w-fit"
              content="Decoded"
            />
          </div>

          {expandedItems['share'] && signerSecret && isShareValid && (
            <div className="mt-2">
              {decodedShareData ? (
                renderDecodedInfo(decodedShareData, signerSecret)
              ) : (
                <div className="bg-red-900/30 p-3 rounded text-xs text-red-300">
                  Failed to decode share credential
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between mt-6">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isSignerRunning
                  ? 'bg-green-500 pulse-animation'
                  : isConnecting
                    ? 'bg-yellow-500 pulse-animation'
                    : 'bg-red-500'
                }`}></div>
              <span className="text-gray-300">
                Signer {
                  isSignerRunning ? 'Running' :
                    isConnecting ? 'Connecting...' :
                      'Stopped'
                }
              </span>
            </div>
            <Button
              onClick={handleSignerButtonClick}
              className={`px-6 py-2 ${isSignerRunning
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-green-600 hover:bg-green-700"
                } transition-colors duration-200 text-sm font-medium hover:opacity-90 cursor-pointer`}
              disabled={!isShareValid || !isGroupValid || relayUrls.length === 0 || isConnecting}
            >
              {isSignerRunning ? "Stop Signer" : isConnecting ? "Connecting..." : "Start Signer"}
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center">
            <h3 className="text-blue-300 text-sm font-medium">Relay URLs</h3>
            <Tooltip
              trigger={<HelpCircle size={16} className="ml-2 text-blue-400 cursor-pointer" />}
              position="right"
              content={
                <>
                  <p className="mb-2 font-semibold">Important:</p>
                  <p>You must be connected to at least one relay to communicate with other signers. Ensure all signers have at least one common relay to coordinate successfully.</p>
                </>
              }
            />
          </div>
          <div className="flex">
            <Input
              type="text"
              placeholder="Add relay URL"
              value={newRelayUrl}
              onChange={(e) => setNewRelayUrl(e.target.value)}
              className="bg-gray-800/50 border-gray-700/50 text-blue-300 py-2 text-sm w-full"
              disabled={isSignerRunning || isConnecting}
            />
            <Button
              onClick={handleAddRelay}
              className="ml-2 bg-blue-800/30 text-blue-400 hover:text-blue-300 hover:bg-blue-800/50"
              disabled={!newRelayUrl.trim() || isSignerRunning || isConnecting}
            >
              Add
            </Button>
          </div>

          <div className="space-y-2">
            {relayUrls.map((relay, index) => (
              <div key={index} className="flex justify-between items-center bg-gray-800/30 py-2 px-3 rounded-md">
                <span className="text-blue-300 text-sm font-mono">{relay}</span>
                <IconButton
                  variant="destructive"
                  size="sm"
                  icon={<X className="h-4 w-4" />}
                  onClick={() => handleRemoveRelay(relay)}
                  tooltip="Remove relay"
                  disabled={isSignerRunning || isConnecting || relayUrls.length <= 1}
                />
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Peer List and Event Log with consistent spacing */}
      <div className="space-y-4">
        <PeerList
          node={nodeRef.current}
          groupCredential={groupCredential}
          shareCredential={signerSecret}
          isSignerRunning={isSignerRunning}
          disabled={!isGroupValid || !isShareValid}
        />

        <EventLog
          logs={logs}
          isSignerRunning={isSignerRunning}
          onClearLogs={() => setLogs([])}
        />
      </div>
    </div>
  );
});

Signer.displayName = 'Signer';

export default Signer;
export type { SignerHandle }; 