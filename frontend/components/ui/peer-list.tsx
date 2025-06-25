import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from './button';
import { IconButton } from './icon-button';
import { Badge } from './badge';
import { Tooltip } from './tooltip';
import { RefreshCw, ChevronDown, ChevronUp, RadioTower, Radio } from 'lucide-react';
import { cn } from '../../lib/utils';

interface PeerStatus {
  pubkey: string;
  online: boolean;
  lastSeen?: Date;
  latency?: number;
  lastPingAttempt?: Date;
}

interface PeerListProps {
  node: any; // Not used in server architecture, kept for compatibility
  groupCredential: string;
  shareCredential: string;
  isSignerRunning: boolean;
  disabled?: boolean;
  className?: string;
}

const PeerList: React.FC<PeerListProps> = ({
  node, // Not used but kept for compatibility
  groupCredential,
  shareCredential,
  isSignerRunning,
  disabled = false,
  className
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [peers, setPeers] = useState<PeerStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfPubkey, setSelfPubkey] = useState<string | null>(null);
  const [pingingPeers, setPingingPeers] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInitialPingSweep, setIsInitialPingSweep] = useState(false);

  // Calculate statistics
  const stats = useMemo(() => {
    const total = peers.length;
    const online = peers.filter(p => p.online).length;
    const offline = total - online;
    const avgPing = peers
      .filter(p => p.latency && p.latency > 0)
      .reduce((acc, p, _, arr) => acc + (p.latency! / arr.length), 0);
    
    return {
      total,
      online,
      offline,
      avgPing: avgPing > 0 ? Math.round(avgPing) : null
    };
  }, [peers]);

  // Fetch peers from server
  const fetchPeers = useCallback(async () => {
    if (!isSignerRunning || disabled) {
      setPeers([]);
      return;
    }

    try {
      const response = await fetch('/api/peers');
      if (response.ok) {
        const data = await response.json();
        setPeers(data.peers.map((peer: any) => ({
          ...peer,
          lastSeen: peer.lastSeen ? new Date(peer.lastSeen) : undefined,
          lastPingAttempt: peer.lastPingAttempt ? new Date(peer.lastPingAttempt) : undefined
        })));
      } else {
        throw new Error('Failed to fetch peers');
      }
    } catch (error) {
      console.error('Error fetching peers:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch peers');
    }
  }, [isSignerRunning, disabled]);

  // Fetch self pubkey
  const fetchSelfPubkey = useCallback(async () => {
    if (!isSignerRunning || disabled) {
      setSelfPubkey(null);
      return;
    }

    try {
      const response = await fetch('/api/peers/self');
      if (response.ok) {
        const data = await response.json();
        setSelfPubkey(data.pubkey);
      } else {
        // This is not critical, so we don't set error state
        console.debug('Could not fetch self pubkey:', await response.text());
      }
    } catch (error) {
      console.debug('Error fetching self pubkey:', error);
    }
  }, [isSignerRunning, disabled]);

  // Initialize peer list
  useEffect(() => {
    if (!isSignerRunning || !groupCredential || !shareCredential || disabled) {
      setPeers([]);
      setError(null);
      setSelfPubkey(null);
      setIsInitialPingSweep(false);
      return;
    }

    let isActive = true;

    const initializePeerList = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch self pubkey and peers
        await Promise.all([
          fetchSelfPubkey(),
          fetchPeers()
        ]);

        if (!isActive) return;

        // Perform initial ping sweep
        setIsInitialPingSweep(true);
        try {
          await fetch('/api/peers/ping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: 'all' })
          });
          
          // Refresh peer list after ping sweep
          await fetchPeers();
        } catch (pingError) {
          console.debug('Initial ping sweep failed:', pingError);
          // Don't set error state for ping failures
        } finally {
          if (isActive) {
            setIsInitialPingSweep(false);
          }
        }

      } catch (error) {
        console.error('[PeerList] Failed to initialize peer list:', error);
        if (isActive) {
          setError(error instanceof Error ? error.message : 'Failed to initialize peer list');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    initializePeerList();

    return () => {
      isActive = false;
    };
  }, [isSignerRunning, groupCredential, shareCredential, disabled, fetchSelfPubkey, fetchPeers]);

  // Unified handler for peer status and ping updates
  const handlePeerUpdate = (event: CustomEvent) => {
    const { pubkey, status } = event.detail;
    setPeers(prev => {
      const updated = prev.map(peer => {
        // Try exact match first
        if (peer.pubkey === pubkey) {
          return {
            ...peer,
            online: Boolean(status.online),
            lastSeen: status.lastSeen ? new Date(status.lastSeen) : peer.lastSeen,
            latency: status.latency ? Number(status.latency) : peer.latency,
            lastPingAttempt: status.lastPingAttempt ? new Date(status.lastPingAttempt) : peer.lastPingAttempt
          } as PeerStatus;
        }
        // Try match without 02 prefix
        const peerWithout02 = peer.pubkey.startsWith('02') ? peer.pubkey.slice(2) : peer.pubkey;
        const pingWithout02 = pubkey.startsWith('02') ? pubkey.slice(2) : pubkey;
        if (peerWithout02 === pingWithout02) {
          return {
            ...peer,
            online: Boolean(status.online),
            lastSeen: status.lastSeen ? new Date(status.lastSeen) : peer.lastSeen,
            latency: status.latency ? Number(status.latency) : peer.latency,
            lastPingAttempt: status.lastPingAttempt ? new Date(status.lastPingAttempt) : peer.lastPingAttempt
          } as PeerStatus;
        }
        return peer;
      });
      return updated;
    });
  };

  // Listen for peer status and ping updates via custom events from the main SSE connection
  useEffect(() => {
    if (!isSignerRunning) return;

    window.addEventListener('peerStatusUpdate', handlePeerUpdate as EventListener);
    window.addEventListener('peerPingUpdate', handlePeerUpdate as EventListener);
    
    return () => {
      window.removeEventListener('peerStatusUpdate', handlePeerUpdate as EventListener);
      window.removeEventListener('peerPingUpdate', handlePeerUpdate as EventListener);
    };
  }, [isSignerRunning]);

  // Ping individual peer
  const handlePingPeer = useCallback(async (peerPubkey: string) => {
    if (!isSignerRunning) {
      return;
    }
    setPingingPeers(prev => new Set(prev).add(peerPubkey));

    try {
      const response = await fetch('/api/peers/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: peerPubkey })
      });

      const result = await response.json();
      
      if (result.status) {
        // Update peer status immediately
        setPeers(prev => prev.map(peer => 
          peer.pubkey === peerPubkey 
            ? {
                ...peer,
                online: Boolean(result.status.online),
                lastSeen: result.status.lastSeen ? new Date(result.status.lastSeen) : peer.lastSeen,
                latency: result.status.latency ? Number(result.status.latency) : peer.latency,
                lastPingAttempt: result.status.lastPingAttempt ? new Date(result.status.lastPingAttempt) : peer.lastPingAttempt
              } as PeerStatus
            : peer
        ));
      }
    } catch (error) {
      console.warn(`[PeerList] Ping failed to ${peerPubkey}:`, error);
    } finally {
      setPingingPeers(prev => {
        const newSet = new Set(prev);
        newSet.delete(peerPubkey);
        return newSet;
      });
    }
  }, [isSignerRunning]);

  // Ping all peers
  const pingAllPeers = useCallback(async () => {
    if (!isSignerRunning || peers.length === 0) {
      return;
    }
    try {
      const response = await fetch('/api/peers/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'all' })
      });
      
      const result = await response.json();
      
      // Refresh peer list after pinging all
      await fetchPeers();
    } catch (error) {
      console.warn('[PeerList] Ping all failed:', error);
    }
  }, [isSignerRunning, peers.length, fetchPeers]);

  // Enhanced refresh that includes pinging
  const handleRefresh = useCallback(async () => {
    if (!isSignerRunning) return;

    setIsRefreshing(true);
    try {
      // Fetch updated peer list and ping all peers
      await Promise.all([
        fetchPeers(),
        pingAllPeers()
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [isSignerRunning, fetchPeers, pingAllPeers]);

  const handleToggle = () => {
    setIsExpanded(prev => !prev);
  };

  const getStatusIndicator = () => {
    if (!isSignerRunning) return 'error';
    if (stats.online > 0) return 'success';
    if (stats.total > 0) return 'warning';
    return 'default';
  };

  const actions = (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 italic">
        {isExpanded ? "Click to collapse" : "Click to expand"}
      </span>
      <IconButton
        variant="default"
        size="sm"
        icon={<RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />}
        onClick={(e) => {
          e.stopPropagation();
          handleRefresh();
        }}
        tooltip="Refresh peer list and ping all"
        disabled={!isSignerRunning || disabled || isRefreshing}
      />
    </div>
  );

  return (
    <div className={cn("space-y-2", className)}>
      {/* Collapsible Header */}
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
          <span className="text-blue-200 text-sm font-medium select-none">Peer List</span>
          
          {/* Status indicators */}
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-2 h-2 rounded-full",
              getStatusIndicator() === 'success' ? 'bg-green-500' :
              getStatusIndicator() === 'warning' ? 'bg-yellow-500' :
              getStatusIndicator() === 'error' ? 'bg-red-500' : 'bg-gray-500'
            )}></div>
            
            {stats.total > 0 && (
              <>
                <Badge variant="success" className="text-xs px-1.5 py-0.5">
                  {stats.online} online
                </Badge>
                <Badge variant="default" className="text-xs px-1.5 py-0.5">
                  {stats.total} total
                </Badge>
                {stats.avgPing && (
                  <Badge variant="info" className="text-xs px-1.5 py-0.5">
                    Avg: {stats.avgPing}ms
                  </Badge>
                )}
              </>
            )}
            
            {error && (
              <Badge variant="error" className="text-xs px-1.5 py-0.5">
                Error
              </Badge>
            )}
          </div>
        </div>
        <div onClick={e => e.stopPropagation()}>
          {actions}
        </div>
      </div>

      {/* Collapsible Content */}
      <div 
        className={cn(
          "transition-all duration-300 ease-in-out overflow-hidden",
          isExpanded ? "max-h-[400px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="bg-gray-900/30 rounded border border-gray-800/30 p-4 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-blue-400">
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading peers...</span>
              </div>
            </div>
          ) : isInitialPingSweep ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-blue-400">
                <Radio className="h-4 w-4 animate-pulse" />
                <span className="text-sm">Detecting online peers...</span>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-center space-y-2">
                <p className="text-red-400 text-sm">{error}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefresh}
                  className="text-blue-400 hover:text-blue-300"
                  disabled={!isSignerRunning}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : peers.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-gray-500 text-sm">
                {!isSignerRunning ? 'Start signer to discover peers' : 'No peers discovered yet'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Peer list */}
              <div className="space-y-2 max-h-[250px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900/30">
                {peers.map((peer) => {
                  const isPinging = pingingPeers.has(peer.pubkey);
                  
                  return (
                    <div key={peer.pubkey} className="flex items-center justify-between bg-gray-800/30 p-3 rounded border border-gray-700/30">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Tooltip
                          trigger={
                            <div className={cn(
                              "w-3 h-3 rounded-full flex-shrink-0",
                              peer.online ? 'bg-green-500' : 'bg-red-500'
                            )}></div>
                          }
                          content={
                            peer.online 
                              ? `Online${peer.lastSeen ? ` - Last seen: ${peer.lastSeen.toLocaleTimeString()}` : ''}` 
                              : `Offline - Timeouts are normal in P2P networks where peers may not be reachable directly`
                          }
                          position="top"
                        />
                        
                        <div className="flex-1 min-w-0">
                          <div className="text-blue-300 text-sm font-mono truncate">
                            {peer.pubkey.slice(0, 16)}...{peer.pubkey.slice(-8)}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            <span>Status: {peer.online ? 'Online' : 'Offline'}</span>
                            {peer.latency && (
                              <span>• Ping: {peer.latency}ms</span>
                            )}
                            {peer.lastSeen && (
                              <span>• Last seen: {peer.lastSeen.toLocaleTimeString()}</span>
                            )}
                            {!peer.online && peer.lastPingAttempt && (
                              <span>• Last attempt: {peer.lastPingAttempt.toLocaleTimeString()}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      <IconButton
                        variant="default"
                        size="sm"
                        icon={<Radio className="h-3 w-3" />}
                        onClick={() => handlePingPeer(peer.pubkey)}
                        tooltip="Ping this peer"
                        disabled={!isSignerRunning || disabled || isPinging}
                        className={cn(
                          "ml-2 transition-all duration-200",
                          isPinging && "animate-pulse"
                        )}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PeerList; 