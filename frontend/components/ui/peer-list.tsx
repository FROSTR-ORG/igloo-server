import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button } from './button';
import { IconButton } from './icon-button';
import { Badge } from './badge';
import { Tooltip } from './tooltip';
import { RefreshCw, ChevronDown, ChevronUp, Radio, SlidersHorizontal, HelpCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

interface PeerPolicy {
  pubkey: string;
  normalizedPubkey: string;
  allowSend: boolean | null;
  allowReceive: boolean | null;
  status: string;
  lastUpdated: Date | null;
  effectiveSend: boolean | null;
  effectiveReceive: boolean | null;
  hasExplicitPolicy: boolean;
  source?: string | null;
}

interface PeerStatus {
  pubkey: string;
  online: boolean;
  lastSeen?: Date;
  latency?: number;
  lastPingAttempt?: Date;
  policy: PeerPolicy;
}

interface PeerListProps {
  node: any; // Not used in server architecture, kept for compatibility
  groupCredential: string;
  shareCredential: string;
  isSignerRunning: boolean;
  disabled?: boolean;
  className?: string;
  authHeaders?: Record<string, string>;
  defaultExpanded?: boolean;
}

// Utility function to parse date values safely
function parseDate(value: any): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return isNaN(date.getTime()) ? undefined : date;
}

const toPolicyKey = (pubkey: string): string => {
  if (typeof pubkey !== 'string') return '';
  const trimmed = pubkey.trim().toLowerCase();
  if ((trimmed.startsWith('02') || trimmed.startsWith('03')) && trimmed.length === 66) {
    return trimmed.slice(2);
  }
  return trimmed;
};

function normalizePolicy(policy: any, fallbackPubkey: string): PeerPolicy {
  const raw = policy && typeof policy === 'object' ? policy : {};
  const normalizedPubkey = typeof raw.normalizedPubkey === 'string' && raw.normalizedPubkey.length > 0
    ? raw.normalizedPubkey
    : fallbackPubkey;

  const allowSend = typeof raw.allowSend === 'boolean' ? raw.allowSend : null;
  const allowReceive = typeof raw.allowReceive === 'boolean' ? raw.allowReceive : null;
  const hasExplicitPolicy = Boolean(raw.hasExplicitPolicy);

  const effectiveSend = typeof raw.effectiveSend === 'boolean'
    ? raw.effectiveSend
    : (typeof allowSend === 'boolean' ? allowSend : null);
  const effectiveReceive = typeof raw.effectiveReceive === 'boolean'
    ? raw.effectiveReceive
    : (typeof allowReceive === 'boolean' ? allowReceive : null);

  return {
    pubkey: typeof raw.pubkey === 'string' && raw.pubkey.length > 0 ? raw.pubkey : fallbackPubkey,
    normalizedPubkey,
    allowSend,
    allowReceive,
    status: typeof raw.status === 'string' ? raw.status : 'unknown',
    lastUpdated: raw.lastUpdated ? parseDate(raw.lastUpdated) ?? null : null,
    effectiveSend,
    effectiveReceive,
    hasExplicitPolicy,
    source: typeof raw.source === 'string' ? raw.source : null
  };
}

const getPolicyToggleClasses = (isAllowed: boolean, canEdit: boolean) => cn(
  'h-8 px-3 text-xs font-semibold tracking-wide uppercase font-mono border rounded-md transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:border-gray-700 disabled:text-gray-500 disabled:bg-gray-800/20 disabled:opacity-60 flex items-center justify-center',
  isAllowed
    ? 'text-green-300 border-green-500/40 bg-green-900/10 hover:bg-green-900/20'
    : 'text-red-300 border-red-500/40 bg-red-900/10 hover:bg-red-900/20',
  !canEdit && 'opacity-80'
);

interface PolicyStateLabels {
  buttonLabel: string;
  statusLabel: string;
  isAllowed: boolean;
}

const derivePolicyState = (
  explicitValue: boolean | null | undefined,
  effectiveValue: boolean | null | undefined
): PolicyStateLabels => {
  if (explicitValue === true) {
    return {
      buttonLabel: 'Allow',
      statusLabel: 'allow',
      isAllowed: true
    };
  }

  if (explicitValue === false) {
    return {
      buttonLabel: 'Block',
      statusLabel: 'block',
      isAllowed: false
    };
  }

  if (effectiveValue === true) {
    return {
      buttonLabel: 'Default (Allow)',
      statusLabel: 'default (allow)',
      isAllowed: true
    };
  }

  if (effectiveValue === false) {
    return {
      buttonLabel: 'Default (Block)',
      statusLabel: 'default (block)',
      isAllowed: false
    };
  }

  return {
    buttonLabel: 'Default',
    statusLabel: 'default',
    isAllowed: true
  };
};

const PeerList: React.FC<PeerListProps> = ({
  node, // Not used but kept for compatibility
  groupCredential,
  shareCredential,
  isSignerRunning,
  disabled = false,
  className,
  authHeaders = {},
  defaultExpanded = false
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [peers, setPeers] = useState<PeerStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfPubkey, setSelfPubkey] = useState<string | null>(null);
  const [pingingPeers, setPingingPeers] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInitialPingSweep, setIsInitialPingSweep] = useState(false);
  const [policyPanelPeer, setPolicyPanelPeer] = useState<string | null>(null);
  const [policySavingPeers, setPolicySavingPeers] = useState<Set<string>>(new Set());
  const [policyPeerErrors, setPolicyPeerErrors] = useState<Map<string, string>>(new Map());
  const hasUserToggledRef = useRef(false);

  useEffect(() => {
    if (defaultExpanded && !hasUserToggledRef.current) {
      setIsExpanded(true);
    }
  }, [defaultExpanded]);

  const setPolicyBusyState = useCallback((key: string, busy: boolean) => {
    setPolicySavingPeers(prev => {
      const next = new Set(prev);
      if (busy) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const setPeerPolicyError = useCallback((key: string, message: string | null) => {
    setPolicyPeerErrors(prev => {
      const next = new Map(prev);
      if (message) {
        next.set(key, message);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

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
      const response = await fetch('/api/peers', {
        headers: authHeaders
      });
      if (response.ok) {
        const data = await response.json();
        setPeers(data.peers.map((peer: any) => ({
          ...peer,
          lastSeen: parseDate(peer.lastSeen),
          lastPingAttempt: parseDate(peer.lastPingAttempt),
          policy: normalizePolicy(peer.policy, peer.pubkey)
        })));
      } else {
        throw new Error('Failed to fetch peers');
      }
    } catch (error) {
      console.error('Error fetching peers:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch peers');
    }
  }, [isSignerRunning, disabled, authHeaders]);

  // Fetch self pubkey
  const fetchSelfPubkey = useCallback(async () => {
    if (!isSignerRunning || disabled) {
      setSelfPubkey(null);
      return;
    }

    try {
      const response = await fetch('/api/peers/self', {
        headers: authHeaders
      });
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
  }, [isSignerRunning, disabled, authHeaders]);

  // Initialize peer list
  useEffect(() => {
    if (!isSignerRunning || !groupCredential || !shareCredential || disabled) {
      setPeers([]);
      setError(null);
      setSelfPubkey(null);
      setIsInitialPingSweep(false);
      setPolicyPanelPeer(null);
      setPolicySavingPeers(new Set());
      setPolicyPeerErrors(new Map());
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
            headers: { 
              'Content-Type': 'application/json',
              ...authHeaders
            },
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
            lastSeen: parseDate(status.lastSeen) ?? peer.lastSeen,
            latency: status.latency ? Number(status.latency) : peer.latency,
            lastPingAttempt: parseDate(status.lastPingAttempt) ?? peer.lastPingAttempt
          } as PeerStatus;
        }
        // Try match without 02 prefix
        const peerWithout02 = peer.pubkey.startsWith('02') ? peer.pubkey.slice(2) : peer.pubkey;
        const pingWithout02 = pubkey.startsWith('02') ? pubkey.slice(2) : pubkey;
        if (peerWithout02 === pingWithout02) {
          return {
            ...peer,
            online: Boolean(status.online),
            lastSeen: parseDate(status.lastSeen) ?? peer.lastSeen,
            latency: status.latency ? Number(status.latency) : peer.latency,
            lastPingAttempt: parseDate(status.lastPingAttempt) ?? peer.lastPingAttempt
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
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders
        },
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
                lastSeen: parseDate(result.status.lastSeen) ?? peer.lastSeen,
                latency: result.status.latency ? Number(result.status.latency) : peer.latency,
                lastPingAttempt: parseDate(result.status.lastPingAttempt) ?? peer.lastPingAttempt
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

  const updatePeerPolicy = useCallback(async (peer: PeerStatus, changes: { allowSend?: boolean; allowReceive?: boolean }) => {
    if (!isSignerRunning || disabled) {
      return;
    }

    const policyKey = toPolicyKey(peer.policy.normalizedPubkey || peer.pubkey);
    const targetPubkey = encodeURIComponent(peer.policy.normalizedPubkey || peer.pubkey);
    setPolicyBusyState(policyKey, true);
    setPeerPolicyError(policyKey, null);

    try {
      const response = await fetch(`/api/peers/${targetPubkey}/policy`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify(changes)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to update policy';
        setPeerPolicyError(policyKey, message);
        return;
      }

      const normalizedPolicy = normalizePolicy(data.policy, peer.pubkey);
      setPeers(prev => prev.map(existing => existing.pubkey === peer.pubkey ? {
        ...existing,
        policy: normalizedPolicy
      } : existing));
    } catch (error) {
      console.error(`[PeerList] Policy update failed for ${peer.pubkey}:`, error);
      setPeerPolicyError(policyKey, 'Failed to update policy');
    } finally {
      setPolicyBusyState(policyKey, false);
    }
  }, [authHeaders, disabled, isSignerRunning, setPolicyBusyState, setPeerPolicyError]);

  const resetPeerPolicy = useCallback(async (peer: PeerStatus) => {
    if (!isSignerRunning || disabled) {
      return;
    }

    const policyKey = toPolicyKey(peer.policy.normalizedPubkey || peer.pubkey);
    const targetPubkey = encodeURIComponent(peer.policy.normalizedPubkey || peer.pubkey);
    setPolicyBusyState(policyKey, true);
    setPeerPolicyError(policyKey, null);

    try {
      const response = await fetch(`/api/peers/${targetPubkey}/policy`, {
        method: 'DELETE',
        headers: authHeaders
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to reset policy';
        setPeerPolicyError(policyKey, message);
        return;
      }

      const normalizedPolicy = normalizePolicy(data.policy, peer.pubkey);
      setPeers(prev => prev.map(existing => existing.pubkey === peer.pubkey ? {
        ...existing,
        policy: normalizedPolicy
      } : existing));
    } catch (error) {
      console.error(`[PeerList] Policy reset failed for ${peer.pubkey}:`, error);
      setPeerPolicyError(policyKey, 'Failed to reset policy');
    } finally {
      setPolicyBusyState(policyKey, false);
    }
  }, [authHeaders, disabled, isSignerRunning, setPolicyBusyState, setPeerPolicyError]);

  const handlePolicyPanelToggle = useCallback((peerPubkey: string) => {
    const key = toPolicyKey(peerPubkey);
    setPolicyPanelPeer(prev => prev === key ? null : key);
  }, []);

  // Ping all peers
  const pingAllPeers = useCallback(async () => {
    if (!isSignerRunning || peers.length === 0) {
      return;
    }
    try {
      const response = await fetch('/api/peers/ping', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders
        },
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
    hasUserToggledRef.current = true;
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
          <span className="text-blue-200 text-sm font-medium select-none">Peer List</span>
          
          {/* Status indicators */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
            <div className={cn(
              "w-2 h-2 rounded-full flex-shrink-0",
              getStatusIndicator() === 'success' ? 'bg-green-500' :
              getStatusIndicator() === 'warning' ? 'bg-yellow-500' :
              getStatusIndicator() === 'error' ? 'bg-red-500' : 'bg-gray-500'
            )}></div>
            
            {stats.total > 0 && (
              <>
                <Badge variant="success" className="text-xs px-1.5 py-0.5 whitespace-nowrap">
                  {stats.online} online
                </Badge>
                <Badge variant="default" className="text-xs px-1.5 py-0.5 whitespace-nowrap">
                  {stats.total} total
                </Badge>
                {stats.avgPing && (
                  <Badge variant="info" className="text-xs px-1.5 py-0.5 whitespace-nowrap">
                    Avg: {stats.avgPing}ms
                  </Badge>
                )}
              </>
            )}
            
            {error && (
              <Badge variant="error" className="text-xs px-1.5 py-0.5 whitespace-nowrap">
                Error
              </Badge>
            )}
          </div>
        </div>
        <div onClick={e => e.stopPropagation()} className="flex-shrink-0">
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
                  const policyKey = toPolicyKey(peer.pubkey);
                  const policySummary = peer.policy;
                  const isPinging = pingingPeers.has(peer.pubkey);
                  const isPolicyBusy = policySavingPeers.has(policyKey);
                  const isPolicyOpen = policyPanelPeer === policyKey;
                  const peerPolicyError = policyPeerErrors.get(policyKey) ?? null;
                  const outboundPolicy = derivePolicyState(
                    policySummary.allowSend,
                    policySummary.effectiveSend
                  );
                  const inboundPolicy = derivePolicyState(
                    policySummary.allowReceive,
                    policySummary.effectiveReceive
                  );
                  const sendAllowed = outboundPolicy.isAllowed;
                  const receiveAllowed = inboundPolicy.isAllowed;
                  const hasExplicitPolicy = policySummary.hasExplicitPolicy;
                  const canEditPolicies = isSignerRunning && !disabled;

                  return (
                    <div key={peer.pubkey} className="relative bg-gray-800/30 p-3 rounded border border-gray-700/30 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
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
                                ? `Online${peer.lastSeen && peer.lastSeen instanceof Date && !isNaN(peer.lastSeen.getTime()) ? ` - Last seen: ${peer.lastSeen.toLocaleTimeString()}` : ''}`
                                : `Offline - Timeouts are normal in P2P networks where peers may not be reachable directly`
                            }
                            position="top"
                          />

                          <div className="flex-1 min-w-0">
                            <div className="text-blue-300 text-sm font-mono break-all sm:truncate">
                              {peer.pubkey.slice(0, 16)}...{peer.pubkey.slice(-8)}
                            </div>
                            <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-xs text-gray-400">
                              <span className="whitespace-nowrap">Status: {peer.online ? 'Online' : 'Offline'}</span>
                              {peer.latency && <span className="whitespace-nowrap">• Ping: {peer.latency}ms</span>}
                              {peer.lastSeen && peer.lastSeen instanceof Date && !isNaN(peer.lastSeen.getTime()) && (
                                <span className="whitespace-nowrap">• Last seen: {peer.lastSeen.toLocaleTimeString()}</span>
                              )}
                              {!peer.online && peer.lastPingAttempt && peer.lastPingAttempt instanceof Date && !isNaN(peer.lastPingAttempt.getTime()) && (
                                <span className="whitespace-nowrap">• Last attempt: {peer.lastPingAttempt.toLocaleTimeString()}</span>
                              )}
                              <span className="whitespace-nowrap">
                                • Policy: out {outboundPolicy.statusLabel}, in {inboundPolicy.statusLabel}
                              </span>
                            </div>
                            {hasExplicitPolicy && (
                              <Badge
                                variant={sendAllowed && receiveAllowed ? 'success' : sendAllowed || receiveAllowed ? 'warning' : 'error'}
                                className="mt-1 text-xs px-1.5 py-0.5 whitespace-nowrap"
                              >
                                Policy override active
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-center relative">
                          <IconButton
                            variant="outline"
                            size="sm"
                            icon={<SlidersHorizontal className={cn('h-3 w-3', isPolicyOpen && 'text-blue-300')} />}
                            onClick={() => handlePolicyPanelToggle(peer.pubkey)}
                            tooltip={disabled ? 'Policies disabled while signer is stopped' : 'Configure peer policy'}
                            disabled={disabled}
                            className={cn(
                              'transition-all duration-200 border-gray-700 bg-gray-800/60 hover:bg-gray-700/80',
                              isPolicyOpen && 'border-blue-500/40 bg-blue-900/20'
                            )}
                          />
                          <IconButton
                            variant="default"
                            size="sm"
                            icon={<Radio className="h-3 w-3" />}
                            onClick={() => handlePingPeer(peer.pubkey)}
                            tooltip="Ping this peer"
                            disabled={!isSignerRunning || disabled || isPinging}
                            className={cn(
                              "transition-all duration-200",
                              isPinging && "animate-pulse"
                            )}
                          />

                          {isPolicyOpen && (
                            <div className="absolute right-0 top-full mt-2 w-72 rounded-md border border-gray-800/80 bg-gray-900/95 shadow-xl shadow-black/40 z-20">
                              <div className="p-3 space-y-3 text-xs text-gray-300">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium uppercase tracking-wide text-gray-200">Policy controls</span>
                                  <Tooltip
                                    position="top"
                                    width="w-72"
                                    triggerClassName="cursor-help"
                                    focusable
                                    trigger={<HelpCircle className="h-3.5 w-3.5 text-blue-300" />}
                                    content={
                                      <div className="space-y-1 text-blue-100">
                                        <p>Directional policies determine whether this peer can receive (inbound) or initiate (outbound) signing traffic with your node.</p>
                                        <p className="text-blue-200/80">For smoother coordination keep outbound enabled only for the minimal set of online peers and disable it for peers you know are offline.</p>
                                      </div>
                                    }
                                  />
                                  {isPolicyBusy && (
                                    <Badge variant="info" className="uppercase tracking-wide">Saving…</Badge>
                                  )}
                                  {policySummary.source === 'config' && (
                                    <Badge variant="orange" className="uppercase tracking-wide">From config</Badge>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className={getPolicyToggleClasses(outboundPolicy.isAllowed, canEditPolicies)}
                                    onClick={() => updatePeerPolicy(peer, { allowSend: !outboundPolicy.isAllowed })}
                                    disabled={!canEditPolicies || isPolicyBusy}
                                  >
                                    {`Outbound ${outboundPolicy.buttonLabel}`}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className={getPolicyToggleClasses(inboundPolicy.isAllowed, canEditPolicies)}
                                    onClick={() => updatePeerPolicy(peer, { allowReceive: !inboundPolicy.isAllowed })}
                                    disabled={!canEditPolicies || isPolicyBusy}
                                  >
                                    {`Inbound ${inboundPolicy.buttonLabel}`}
                                  </Button>
                                </div>

                                {!canEditPolicies && (
                                  <Badge variant="warning" className="uppercase tracking-wide">Start signer to edit policies</Badge>
                                )}

                                {hasExplicitPolicy && (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => resetPeerPolicy(peer)}
                                    disabled={!canEditPolicies || isPolicyBusy}
                                    className="text-[11px] text-gray-400 hover:text-gray-200"
                                  >
                                    Reset to defaults
                                  </Button>
                                )}

                                <div className="text-[11px] text-gray-500 space-y-1">
                                  <p>Directional defaults come from your runtime configuration unless overridden here.</p>
                                  <p>Outbound controls requests you initiate; inbound gates requests arriving from this peer.</p>
                                </div>

                                {peerPolicyError && (
                                  <div className="text-[11px] text-red-400">{peerPolicyError}</div>
                                )}

                                <div className="text-[11px] text-gray-600">
                                  Last update: {policySummary.lastUpdated ? policySummary.lastUpdated.toLocaleString() : 'Inherits defaults'}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
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
