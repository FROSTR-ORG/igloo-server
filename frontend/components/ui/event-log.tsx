import React, { useRef, useEffect, useCallback, memo, useState, useMemo } from "react";
import { IconButton } from "./icon-button";
import { StatusIndicator } from "./status-indicator";
import { Badge } from "./badge";
import { Button } from "./button";
import { Trash2, ChevronDown, ChevronUp, Filter, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { LogEntry, type LogEntryData } from "./log-entry";

interface EventLogProps {
  logs: LogEntryData[];
  isSignerRunning?: boolean;
  onClearLogs: () => void;
  title?: string;
  hideHeader?: boolean;
  autoExpandTypes?: string[];
}

export const EventLog = memo(({
  logs,
  isSignerRunning = false,
  onClearLogs,
  title = "Event Log",
  hideHeader = false,
  autoExpandTypes = []
}: EventLogProps) => {
  const logEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const previousLogIdsRef = useRef<string[] | null>(null);

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

  useEffect(() => {
    if (!autoExpandTypes.length) {
      previousLogIdsRef.current = logs.map(log => log.id);
      return;
    }

    if (previousLogIdsRef.current === null) {
      previousLogIdsRef.current = logs.map(log => log.id);
      return;
    }

    const prevIds = previousLogIdsRef.current;
    const newEntries = logs.filter(log => !prevIds.includes(log.id));
    previousLogIdsRef.current = logs.map(log => log.id);

    if (!isExpanded && newEntries.some(log => autoExpandTypes.includes(log.type))) {
      setIsExpanded(true);
    }
  }, [logs, autoExpandTypes, isExpanded]);

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
          className="flex flex-col sm:flex-row sm:items-center justify-between bg-gray-800/50 p-2.5 rounded cursor-pointer hover:bg-gray-800/70 transition-colors gap-2 sm:gap-0"
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
          <div className="flex items-center gap-2 min-w-0">
            {isExpanded ? 
              <ChevronUp className="h-4 w-4 text-blue-400 flex-shrink-0" /> : 
              <ChevronDown className="h-4 w-4 text-blue-400 flex-shrink-0" />
            }
            <span className="text-blue-200 text-sm font-medium select-none">{title}</span>
            <StatusIndicator 
              status={getStatusIndicator()}
              count={activeFilters.size > 0 ? filteredLogs.length : logs.length}
            />
            {activeFilters.size > 0 && (
              <Badge variant="info" className="text-xs px-1.5 py-0.5 bg-blue-600/20 text-blue-400 border-blue-500/30 whitespace-nowrap">
                {activeFilters.size} filter{activeFilters.size !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          <div onClick={e => e.stopPropagation()} className="flex-shrink-0">
            {actions}
          </div>
        </div>
      )}
      
      {/* Filter Controls */}
      {showFilters && isExpanded && availableEventTypes.length > 0 && (
        <div className="bg-gray-900/30 border border-gray-800/30 rounded p-3 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-0">
            <span className="text-blue-200 text-sm font-medium">Filter by Event Type</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAllFilters}
                className="text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-600/10 h-6 px-2 whitespace-nowrap"
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-600/20 h-6 px-2 whitespace-nowrap"
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
                  <span className="text-gray-500 font-light whitespace-nowrap">({count})</span>
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
