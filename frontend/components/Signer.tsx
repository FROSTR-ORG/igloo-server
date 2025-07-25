import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback, useMemo } from "react"
import { Button } from "./ui/button"
import { IconButton } from "./ui/icon-button"
import { Tooltip } from "./ui/tooltip"
import { Copy, Check, X, HelpCircle, ChevronDown, ChevronRight, User } from "lucide-react"
import { EventLog, type LogEntryData } from "./EventLog"
import { Input } from "./ui/input"
import PeerList from "./ui/peer-list"
// Import real igloo-core functions
import { 
  validateShare, 
  validateGroup, 
  decodeShare, 
  decodeGroup, 
  createConnectedNode,
  getShareDetailsWithGroup,
  cleanupBifrostNode
} from '@frostr/igloo-core'
// Import types from shared types file
import type { SignerHandle, SignerProps } from '../types'

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

const DEFAULT_RELAY = "wss://relay.primal.net";

// Helper function to extract share information using real igloo-core functions
const getShareInfo = (groupCredential: string, shareCredential: string, shareName?: string, realPubkey?: string) => {
  try {
    if (!groupCredential || !shareCredential) return null;

    // Decode both group and share credentials directly
    const decodedGroup = decodeGroup(groupCredential);
    const decodedShare = decodeShare(shareCredential);

    // Find the corresponding commit in the group
    const commit = decodedGroup.commits.find((c: any) => c.idx === decodedShare.idx);

    if (commit) {
      return {
        index: decodedShare.idx,
        pubkey: realPubkey || commit.pubkey, // Use real pubkey if available, otherwise use commit pubkey
        shareName: shareName || `Share ${decodedShare.idx}`,
        threshold: decodedGroup.threshold,
        totalShares: decodedGroup.commits.length
      };
    }

    return null;
  } catch (error) {
    console.error('Error getting share info:', error);
    return null;
  }
};

const Signer = forwardRef<SignerHandle, SignerProps>(({ initialData, authHeaders = {} }, ref) => {
  const [isSignerRunning, setIsSignerRunning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [signerSecret, setSignerSecret] = useState("");
  const [isShareValid, setIsShareValid] = useState(false);
  const [relayUrls, setRelayUrls] = useState<string[]>([DEFAULT_RELAY]);
  const [newRelayUrl, setNewRelayUrl] = useState("");

  const [groupCredential, setGroupCredential] = useState("");
  const [isGroupValid, setIsGroupValid] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [serverStatus, setServerStatus] = useState<{
    serverRunning: boolean;
    nodeActive: boolean;
    hasCredentials: boolean;
    relayCount: number;
    timestamp: string;
  } | null>(null);

  const [copiedStates, setCopiedStates] = useState({
    group: false,
    share: false
  });
  const [expandedItems, setExpandedItems] = useState<Record<'group' | 'share', boolean>>({
    group: false,
    share: false
  });
  const [logs, setLogs] = useState<LogEntryData[]>([]);
  const [realSelfPubkey, setRealSelfPubkey] = useState<string | null>(null);

  // Reference for compatibility with parent component
  const nodeRef = useRef<any | null>(null);

  // Expose the stopSigner method to parent components through ref
  useImperativeHandle(ref, () => ({
    stopSigner: async () => {
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

  // Note: Logging is now handled server-side via SSE - no client addLog needed

  // Note: Event listeners are now handled server-side via SSE
  // All node events are captured on the server and streamed to frontend

  // Clean up event listeners before node cleanup
  const cleanupEventListeners = useCallback(() => {
    // Event listeners are now handled server-side, no client cleanup needed
  }, []);

  // Clean node cleanup using igloo-core
  const cleanupNode = useCallback(() => {
    if (nodeRef.current) {
      // First clean up our event listeners
      cleanupEventListeners();

      try {
        // Use igloo-core's cleanup - it handles the manual cleanup internally
        cleanupBifrostNode(nodeRef.current);
        // Note: You may see a warning about 'removeAllListeners not available' from igloo-core.
        // This is expected and harmless. Consider filing an issue upstream to suppress or handle this internally.
      } catch (error) {
        console.error('Unexpected error during cleanup:', error);
      } finally {
        nodeRef.current = null;
      }
    }
  }, [cleanupEventListeners]);

  // Function to check server status
  const checkServerStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/status', {
        headers: authHeaders
      });
      const status = await response.json();
      setServerStatus(status);
      
      // Update signer running state based on server node status
      const wasRunning = isSignerRunning;
      const nowRunning = status.nodeActive && status.hasCredentials;
      
      if (wasRunning !== nowRunning) {
        setIsSignerRunning(nowRunning);
        setIsConnecting(false);
        
        // Status changes are now logged server-side via node events
        // No need for client-side logging here
      }
      

      } catch (error) {
      console.error('Error checking server status:', error);
      // If we can't reach the server, assume signer is not running
      if (isSignerRunning) {
        setIsSignerRunning(false);
        setIsConnecting(false);
        // Connection errors will be handled by the EventSource error handler
      }
    }
  }, [isSignerRunning]);

  // Poll server status every 5 seconds
  useEffect(() => {
    checkServerStatus(); // Check immediately
    const interval = setInterval(checkServerStatus, 5000);
    return () => clearInterval(interval);
  }, [checkServerStatus]);

  // Fetch real self pubkey when signer is running
  useEffect(() => {
    if (!isSignerRunning || !isGroupValid || !isShareValid) {
      setRealSelfPubkey(null);
      return;
    }

    const fetchSelfPubkey = async () => {
      try {
        const response = await fetch('/api/peers/self', {
        headers: authHeaders
      });
        if (response.ok) {
          const data = await response.json();
          setRealSelfPubkey(data.pubkey);
        }
      } catch (error) {
        // Silently ignore errors fetching self pubkey
      }
    };
    fetchSelfPubkey();
  }, [isSignerRunning, isGroupValid, isShareValid]);

  // Connect to server event stream via WebSocket
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let isConnecting = false;
    let isMounted = true;
    let reconnectAttempts = 0;

    // Exponential backoff configuration
    const BASE_DELAY = 1000; // 1 second base delay
    const MAX_DELAY = 30000; // 30 seconds maximum delay
    const JITTER_RANGE = 1000; // 0-1 second jitter

    /**
     * Calculate reconnection delay using exponential backoff with jitter
     * @param attempt - Current attempt number (0-based)
     * @returns Delay in milliseconds
     */
    const calculateReconnectDelay = (attempt: number): number => {
      const exponentialDelay = BASE_DELAY * Math.pow(2, attempt);
      const cappedDelay = Math.min(exponentialDelay, MAX_DELAY);
      const jitter = Math.random() * JITTER_RANGE;
      return cappedDelay + jitter;
    };

    const connect = () => {
      if (!isMounted || isConnecting) return;
      
      isConnecting = true;
      
      try {
                 // Determine WebSocket URL (handle both http and https)
         const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
         let wsUrl = `${protocol}//${window.location.host}/api/events`;
         
         // Add authentication parameters for WebSocket connection
         // Since WebSocket doesn't support custom headers during upgrade,
         // we need to pass auth info via URL parameters
         const params = new URLSearchParams();
         
         // Check if we have auth headers and convert them to URL params
         if (authHeaders['X-API-Key']) {
           params.set('apiKey', authHeaders['X-API-Key']);
         } else if (authHeaders['X-Session-ID']) {
           params.set('sessionId', authHeaders['X-Session-ID']);
         } else if (authHeaders['Authorization'] && authHeaders['Authorization'].startsWith('Basic ')) {
           // For basic auth, we'll rely on cookies or handle it server-side
           // The server should accept the connection if the user is already authenticated
         }
         
         if (params.toString()) {
           wsUrl += '?' + params.toString();
         }
         
         ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          isConnecting = false;
          reconnectAttempts = 0; // Reset attempt count on successful connection
          console.log('WebSocket connected to event stream');
        };
        
        ws.onmessage = (event) => {
          try {
            const logEntry = JSON.parse(event.data);
            
            // Handle internal peer events (don't add to logs but dispatch for peer list)
            if (logEntry.type === 'peer-status-internal' && logEntry.data) {
              window.dispatchEvent(new CustomEvent('peerStatusUpdate', {
                detail: logEntry.data
              }));
              return; // Don't add to event log
            }
            
            if (logEntry.type === 'peer-ping-internal' && logEntry.data) {
              window.dispatchEvent(new CustomEvent('peerPingUpdate', {
                detail: logEntry.data
              }));
              return; // Don't add to event log
            }
            
            // Add all other server log entries to our local logs (original Igloo Desktop events)
            setLogs(prev => [...prev, logEntry]);
          } catch (error) {
            console.error('Error parsing WebSocket event:', error);
          }
        };
        
        ws.onerror = (error) => {
          console.error('WebSocket connection error:', error);
          isConnecting = false;
        };
        
        ws.onclose = (event) => {
          isConnecting = false;
          console.log('WebSocket connection closed:', event.code, event.reason);
          
          // Attempt to reconnect if the component is still mounted and close wasn't intentional
          if (isMounted && event.code !== 1000) { // 1000 = normal closure
            const delay = calculateReconnectDelay(reconnectAttempts);
            console.log(`Attempting to reconnect WebSocket in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts + 1})...`);
            reconnectAttempts++;
            
            reconnectTimeout = setTimeout(() => {
              if (isMounted) {
                connect();
              }
            }, delay);
          }
        };
        
      } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        isConnecting = false;
        
        // Retry connection after delay using exponential backoff
        if (isMounted) {
          const delay = calculateReconnectDelay(reconnectAttempts);
          console.log(`Retrying WebSocket connection in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts + 1})...`);
          reconnectAttempts++;
          
          reconnectTimeout = setTimeout(() => {
            if (isMounted) {
              connect();
            }
          }, delay);
        }
      }
    };

    // Initial connection
    connect();
    
    // Cleanup on unmount
    return () => {
      isMounted = false;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (ws) {
        ws.close(1000, 'Component unmounting'); // Normal closure
      }
    };
  }, []);

  // Add effect to cleanup on unmount
  useEffect(() => {
    // Cleanup function that runs when component unmounts
    return () => {
      if (nodeRef.current) {
        // Cleanup handled server-side when credentials are removed
        cleanupNode();
      }
    };
  }, [cleanupNode]); // Include dependencies

  // Fetch initial data from server .env file
  useEffect(() => {
    const fetchEnvData = async () => {
      try {
        const response = await fetch('/api/env', {
        headers: authHeaders
      });
        const envVars = await response.json();
        
        // Set values from environment variables
        if (envVars.SHARE_CRED) {
          setSignerSecret(envVars.SHARE_CRED);
          const validation = validateShare(envVars.SHARE_CRED);
          setIsShareValid(validation.isValid);
        }
        
        if (envVars.GROUP_CRED) {
          setGroupCredential(envVars.GROUP_CRED);
          const validation = validateGroup(envVars.GROUP_CRED);
          setIsGroupValid(validation.isValid);
        }
        
        if (envVars.GROUP_NAME) {
          setSignerName(envVars.GROUP_NAME);
        }
        
        // Load relays from environment if available
        if (envVars.RELAYS) {
          try {
            let relays: string[] = [];
            
            // Try to parse as JSON first
            if (envVars.RELAYS.startsWith('[')) {
              relays = JSON.parse(envVars.RELAYS);
            } else {
              // Handle comma-separated or space-separated strings
              relays = envVars.RELAYS
                .split(/[,\s]+/)
                .map((relay: string) => relay.trim())
                .filter((relay: string) => relay.length > 0);
            }
            
            if (Array.isArray(relays) && relays.length > 0) {
              setRelayUrls(relays);
            } else {
              // If no valid relays found, save default relays
              saveRelaysToEnv([DEFAULT_RELAY]);
            }
      } catch (error) {
            console.warn('Failed to parse RELAYS from env:', error);
            // Fallback: treat the whole string as a single relay if it looks like a URL
            if (typeof envVars.RELAYS === 'string' && envVars.RELAYS.includes('://')) {
              setRelayUrls([envVars.RELAYS]);
            } else {
              // Save default relays if parsing failed
              saveRelaysToEnv([DEFAULT_RELAY]);
            }
          }
        } else {
          // If no RELAYS environment variable exists, save the default
          saveRelaysToEnv([DEFAULT_RELAY]);
        }
      } catch (error) {
        console.error('Error fetching environment variables:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchEnvData();
  }, []);

  // Validate initial data (fallback for when props are provided)
  useEffect(() => {
    if (initialData?.share && !signerSecret) {
      setSignerSecret(initialData.share);
      const validation = validateShare(initialData.share);
      setIsShareValid(validation.isValid);
    }

    if (initialData?.groupCredential && !groupCredential) {
      setGroupCredential(initialData.groupCredential);
      const validation = validateGroup(initialData.groupCredential);
      setIsGroupValid(validation.isValid);
    }
    
    if (initialData?.name && !signerName) {
      setSignerName(initialData.name);
    }
  }, [initialData, signerSecret, groupCredential, signerName]);

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

  // Save credentials to server .env file
  const saveCredentialsToEnv = async (share?: string, group?: string) => {
    try {
      const updateData: Record<string, string> = {};
      if (share !== undefined) updateData.SHARE_CRED = share;
      if (group !== undefined) updateData.GROUP_CRED = group;
      
      if (Object.keys(updateData).length > 0) {
        await fetch('/api/env', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders
          },
          body: JSON.stringify(updateData)
        });
      }
    } catch (error) {
      console.error('Error saving credentials to env:', error);
    }
  };

  const handleShareChange = (value: string) => {
    setSignerSecret(value);
    const validation = validateShare(value);

    // Try deeper validation with real decoder if basic validation passes
    if (validation.isValid && value.trim()) {
      try {
        // If this doesn't throw, it's a valid share
        const decodedShare = decodeShare(value);

        // Additional structure validation - igloo-core returns proper structure
        if (typeof decodedShare.idx !== 'number' ||
          typeof decodedShare.seckey !== 'string' ||
          typeof decodedShare.binder_sn !== 'string' ||
          typeof decodedShare.hidden_sn !== 'string') {
          setIsShareValid(false);
          return;
        }

        setIsShareValid(true);
        // Save valid share to env
        saveCredentialsToEnv(value, undefined);
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

    // Try deeper validation with real decoder if basic validation passes
    if (validation.isValid && value.trim()) {
      try {
        // If this doesn't throw, it's a valid group
        const decodedGroup = decodeGroup(value);

        // Additional structure validation - igloo-core returns proper structure
        if (typeof decodedGroup.threshold !== 'number' ||
          typeof decodedGroup.group_pk !== 'string' ||
          !Array.isArray(decodedGroup.commits) ||
          decodedGroup.commits.length === 0) {
          setIsGroupValid(false);
          return;
        }

        setIsGroupValid(true);
        // Save valid group to env
        saveCredentialsToEnv(undefined, value);
      } catch {
        setIsGroupValid(false);
      }
    } else {
      setIsGroupValid(validation.isValid);
    }
  };

  // Save relay URLs to server .env file
  const saveRelaysToEnv = async (relays: string[]) => {
    try {
      await fetch('/api/env', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({
          RELAYS: JSON.stringify(relays)
        })
      });
    } catch (error) {
      console.error('Error saving relays to env:', error);
    }
  };

  const handleAddRelay = () => {
    const isAlreadyAdded = relayUrls.indexOf(newRelayUrl) !== -1;
    if (newRelayUrl && !isAlreadyAdded) {
      const newRelays = [...relayUrls, newRelayUrl];
      setRelayUrls(newRelays);
      setNewRelayUrl("");
      saveRelaysToEnv(newRelays);
    }
  };

  const handleRemoveRelay = (urlToRemove: string) => {
    const newRelays = relayUrls.filter(url => url !== urlToRemove);
    setRelayUrls(newRelays);
    saveRelaysToEnv(newRelays);
  };

  // Expose the stopSigner method for compatibility (server-managed, no action needed)
  const handleStopSigner = async () => {
    // Signer is managed by the server - no manual stop needed
  };

  // Show loading state while fetching environment variables
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center py-12">
          <div className="text-blue-300">Loading signer configuration...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add the pulse style */}
      <style>{pulseStyle}</style>
      <div className="flex items-center">
        <div className="flex flex-col">
          <h2 className="text-blue-300 text-lg">Server-managed signer status</h2>
        </div>
        <Tooltip
          trigger={<HelpCircle size={18} className="ml-2 text-blue-400 cursor-pointer" />}
          position="right"
          content={
            <>
              <p className="mb-2 font-semibold">Server-Managed Signer:</p>
              <p>The signer runs automatically on the server when credentials are configured. It will handle signature requests from clients and communicate with other nodes through your configured relays.</p>
            </>
          }
        />
      </div>

      {/* Share Information Header */}
      {(() => {
        const shareInfo = getShareInfo(groupCredential, signerSecret, signerName || initialData?.name, realSelfPubkey || undefined);
        return shareInfo && isGroupValid && isShareValid ? (
          <div className="border border-blue-800/30 rounded-lg p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2">
                <User className="h-5 w-5 text-blue-400" />
                <span className="text-blue-200 font-medium">{shareInfo.shareName}</span>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 text-sm">
                <div className="text-gray-300">
                  Index: <span className="text-blue-400 font-mono">{shareInfo.index}</span>
                </div>
                <div className="text-gray-400 hidden sm:block">•</div>
                <div className="text-gray-300">
                  Threshold: <span className="text-blue-400">{shareInfo.threshold}</span>/<span className="text-blue-400">{shareInfo.totalShares || '?'}</span>
                </div>
              </div>
            </div>
            <div className="mt-2">
              <div className="text-gray-300 text-sm">
                Pubkey: <span className="font-mono text-xs break-all sm:truncate sm:block">{shareInfo.pubkey}</span>
              </div>
            </div>
          </div>
        ) : null;
      })()}

      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-0">
            <Tooltip
              trigger={
                <Input
                  type="text"
                  value={groupCredential}
                  onChange={(e) => handleGroupChange(e.target.value)}
                  className="bg-gray-800/50 border-gray-700/50 text-blue-300 py-2 text-sm w-full font-mono text-xs sm:text-sm"
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
            <div className="flex gap-2 sm:ml-2">
              <Tooltip
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopy(groupCredential, 'group')}
                    className="bg-blue-800/30 text-blue-400 hover:text-blue-300 hover:bg-blue-800/50"
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
                    className="bg-blue-800/30 text-blue-400 hover:text-blue-300 hover:bg-blue-800/50"
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

          <div className="flex flex-col sm:flex-row gap-2 sm:gap-0">
            <Tooltip
              trigger={
                <Input
                  type="password"
                  value={signerSecret}
                  onChange={(e) => handleShareChange(e.target.value)}
                  className="bg-gray-800/50 border-gray-700/50 text-blue-300 py-2 text-sm w-full font-mono text-xs sm:text-sm"
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
            <div className="flex gap-2 sm:ml-2">
              <Tooltip
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopy(signerSecret, 'share')}
                    className="bg-blue-800/30 text-blue-400 hover:text-blue-300 hover:bg-blue-800/50"
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
                    className="bg-blue-800/30 text-blue-400 hover:text-blue-300 hover:bg-blue-800/50"
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

          <div className="flex items-center justify-center mt-6">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isSignerRunning
                  ? 'bg-green-500 pulse-animation'
                  : isConnecting
                    ? 'bg-yellow-500 pulse-animation'
                    : 'bg-red-500'
                }`}></div>
              <span className="text-gray-300">
                Server Signer: {
                  isSignerRunning ? 'Running' :
                    isConnecting ? 'Starting...' :
                      'Stopped'
                }
              </span>
              {serverStatus && (
                <span className="text-gray-400 text-sm ml-2">
                  ({serverStatus.nodeActive ? 'Node Active' : 'Node Inactive'})
                </span>
              )}
            </div>
          </div>
          
          {!isSignerRunning && isShareValid && isGroupValid && (
            <div className="mt-4 p-3 bg-blue-900/30 rounded-lg">
              <div className="text-blue-300 text-sm">
                <strong>Server-Managed Signer:</strong> The signer runs automatically on the server when credentials are configured. 
                {!serverStatus?.hasCredentials && " Save your credentials to start the signer."}
                {serverStatus?.hasCredentials && !serverStatus?.nodeActive && " Server is starting the signer node..."}
              </div>
            </div>
          )}
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
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-0">
            <Input
              type="text"
              placeholder="Add relay URL"
              value={newRelayUrl}
              onChange={(e) => setNewRelayUrl(e.target.value)}
              className="bg-gray-800/50 border-gray-700/50 text-blue-300 py-2 text-sm w-full"
            />
            <Button
              onClick={handleAddRelay}
              className="sm:ml-2 bg-blue-800/30 text-blue-400 hover:text-blue-300 hover:bg-blue-800/50"
              disabled={!newRelayUrl.trim()}
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
                  disabled={relayUrls.length <= 1}
                />
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Peer List and Event Log with consistent spacing */}
      <div className="space-y-4">
        <PeerList
          node={null}
          groupCredential={groupCredential}
          shareCredential={signerSecret}
          isSignerRunning={isSignerRunning}
          disabled={!isGroupValid || !isShareValid}
          authHeaders={authHeaders}
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