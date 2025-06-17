/* Tailwind-inspired base styles with Igloo Desktop design */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono:wght@400&display=swap');

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Share Tech Mono', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  color: #e2e8f0;
  background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #0f172a 100%);
  min-height: 100vh;
}

.container {
  max-width: 1024px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

/* Font classes */
.font-sharetech {
  font-family: 'Share Tech Mono', monospace;
}

.font-inter {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* Header styling */
h1, h2, h3 {
  font-family: 'Share Tech Mono', monospace;
}

/* Status dot animations */
.status-dot {
  transition: all 0.3s ease;
}

.status-dot.connected {
  background-color: #22c55e;
  box-shadow: 0 0 10px rgba(34, 197, 94, 0.5);
}

.status-dot.loading {
  background-color: #eab308;
  animation: pulse 2s infinite;
  box-shadow: 0 0 10px rgba(234, 179, 8, 0.5);
}

.status-dot.error {
  background-color: #ef4444;
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.5);
}

/* Pulse animation for loading states - matching Signer page */
.pulse-animation {
  animation: pulse 1.5s ease-in-out infinite;
  box-shadow: 0 0 5px 2px rgba(34, 197, 94, 0.6);
}

@keyframes pulse {
  0%, 100% { 
    opacity: 1; 
    transform: scale(1);
  }
  50% { 
    opacity: 0.6; 
    transform: scale(1.1);
  }
}

/* Button styles matching Igloo Desktop design */
.btn-primary {
  background: #22c55e;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: 'Share Tech Mono', monospace;
}

.btn-primary:hover {
  background: #16a34a;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
}

.btn-primary:disabled {
  background: #6b7280;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.btn-secondary {
  background: #374151;
  color: #d1d5db;
  border: 1px solid #4b5563;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: 'Share Tech Mono', monospace;
}

.btn-secondary:hover {
  background: #4b5563;
  border-color: #6b7280;
  transform: translateY(-1px);
}

.btn-danger {
  background: #dc2626;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: 'Share Tech Mono', monospace;
}

.btn-danger:hover {
  background: #b91c1c;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.4);
}

.btn-small {
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
}

/* Environment variables list */
.env-list {
  display: block;
  gap: 0.75rem;
}

.env-item {
  background: rgba(30, 41, 59, 0.4);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 0.5rem;
  padding: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  transition: all 0.2s ease;
}

.env-item:hover {
  border-color: rgba(59, 130, 246, 0.5);
  background: rgba(30, 41, 59, 0.6);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
}

.env-item.sensitive {
  border-left: 4px solid #eab308;
  background: rgba(251, 191, 36, 0.05);
}

.env-info {
  flex: 1;
}

.env-key {
  font-weight: 600;
  font-size: 1.1rem;
  color: #93c5fd;
  margin-bottom: 0.25rem;
  font-family: 'Share Tech Mono', monospace;
}

.env-value {
  color: #94a3b8;
  font-family: 'Share Tech Mono', monospace;
  background: rgba(0, 0, 0, 0.2);
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  word-break: break-all;
  font-size: 0.875rem;
}

.env-value.hidden {
  background: #374151;
  color: #374151;
  user-select: none;
  cursor: pointer;
  position: relative;
}

.env-value.hidden:hover::after {
  content: " (click to reveal)";
  color: #6b7280;
  position: absolute;
  right: -120px;
  white-space: nowrap;
}

.env-actions {
  display: flex;
  gap: 0.5rem;
  margin-left: 1rem;
}

/* No variables state */
.no-vars {
  text-align: center;
  padding: 3rem 1.25rem;
  color: #6b7280;
}

.no-vars p:first-child {
  font-size: 1.2rem;
  margin-bottom: 0.625rem;
}

/* Modal styles matching Igloo Desktop */
.modal-overlay {
  display: none;
  position: fixed;
  z-index: 1000;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  align-items: center;
  justify-content: center;
}

.modal-overlay.show {
  display: flex;
  animation: fadeIn 0.2s ease;
}

.modal-content {
  background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 0.75rem;
  width: 90%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  animation: slideIn 0.3s ease;
}

.modal-header {
  padding: 1.5rem 2rem 1rem;
  border-bottom: 1px solid rgba(75, 85, 99, 0.3);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  margin: 0;
  color: #93c5fd;
  font-size: 1.125rem;
  font-weight: 600;
  font-family: 'Share Tech Mono', monospace;
}

.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #6b7280;
  padding: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: all 0.2s ease;
  font-family: 'Share Tech Mono', monospace;
}

.modal-close:hover {
  background: rgba(75, 85, 99, 0.3);
  color: #d1d5db;
}

.modal-body {
  padding: 2rem;
}

/* Form styles */
.form-group {
  margin-bottom: 1.5rem;
}

.form-input {
  width: 100%;
  background: rgba(30, 41, 59, 0.5);
  border: 1px solid rgba(75, 85, 99, 0.5);
  border-radius: 0.375rem;
  padding: 0.75rem 1rem;
  color: #93c5fd;
  font-size: 0.875rem;
  font-family: 'Share Tech Mono', monospace;
  transition: all 0.2s ease;
}

.form-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  background: rgba(30, 41, 59, 0.7);
}

.form-input:disabled {
  background: rgba(55, 65, 81, 0.3);
  color: #6b7280;
  cursor: not-allowed;
}

.form-input::placeholder {
  color: #6b7280;
}

.form-hint {
  display: block;
  margin-top: 0.375rem;
  color: #9ca3af;
  font-size: 0.75rem;
  font-family: 'Share Tech Mono', monospace;
}

.form-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 2rem;
}

/* Copy button styles */
.copy-btn {
  background: rgba(59, 130, 246, 0.2);
  border: 1px solid rgba(59, 130, 246, 0.3);
  color: #60a5fa;
  padding: 0.5rem;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.copy-btn:hover {
  background: rgba(59, 130, 246, 0.3);
  border-color: rgba(59, 130, 246, 0.5);
  color: #93c5fd;
}

.copy-btn:disabled {
  background: rgba(75, 85, 99, 0.2);
  border-color: rgba(75, 85, 99, 0.3);
  color: #6b7280;
  cursor: not-allowed;
}

.copy-btn.success {
  background: rgba(34, 197, 94, 0.2);
  border-color: rgba(34, 197, 94, 0.3);
  color: #4ade80;
}

/* Event log styles matching Igloo Desktop */
.event-log-entry {
  background: rgba(30, 41, 59, 0.4);
  padding: 0.75rem;
  border-radius: 0.375rem;
  margin-bottom: 0.5rem;
  border-left: 3px solid transparent;
  transition: all 0.2s ease;
}

.event-log-entry:hover {
  background: rgba(30, 41, 59, 0.6);
}

.event-log-entry.error {
  border-left-color: #ef4444;
}

.event-log-entry.success {
  border-left-color: #22c55e;
}

.event-log-entry.warning {
  border-left-color: #eab308;
}

.event-log-entry.info {
  border-left-color: #3b82f6;
}

.event-timestamp {
  color: #6b7280;
  font-size: 0.75rem;
  font-family: 'Share Tech Mono', monospace;
}

.event-type {
  display: inline-block;
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  margin: 0 0.5rem;
  font-family: 'Share Tech Mono', monospace;
}

.event-type.error {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}

.event-type.success {
  background: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.event-type.warning {
  background: rgba(234, 179, 8, 0.2);
  color: #fde047;
}

.event-type.info {
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
}

.event-message {
  color: #d1d5db;
  font-size: 0.875rem;
  font-family: 'Share Tech Mono', monospace;
}

/* Badge styles like React components */
.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 0.375rem;
  padding: 0.125rem 0.625rem;
  font-size: 0.75rem;
  font-weight: 500;
  font-family: 'Share Tech Mono', monospace;
  text-transform: uppercase;
}

.badge.success {
  background: rgba(34, 197, 94, 0.2);
  color: #86efac;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.badge.error {
  background: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.badge.warning {
  background: rgba(234, 179, 8, 0.2);
  color: #fde047;
  border: 1px solid rgba(234, 179, 8, 0.3);
}

.badge.info {
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.badge.default {
  background: rgba(75, 85, 99, 0.2);
  color: #d1d5db;
  border: 1px solid rgba(75, 85, 99, 0.3);
}

/* Scrollbar styles */
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: #4b5563 rgba(55, 65, 81, 0.3);
}

.scrollbar-thin::-webkit-scrollbar {
  width: 6px;
}

.scrollbar-thin::-webkit-scrollbar-track {
  background: rgba(55, 65, 81, 0.3);
  border-radius: 3px;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  background: #4b5563;
  border-radius: 3px;
}

.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: #6b7280;
}

/* Animations */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-20px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* Responsive design */
@media (max-width: 768px) {
  .container {
    padding: 1rem;
  }
  
  h1 {
    font-size: 2rem;
  }
  
  .env-item {
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
  }
  
  .env-actions {
    justify-content: flex-end;
    margin-left: 0;
  }
  
  .modal-content {
    width: 95%;
    margin: 1rem;
  }
  
  .modal-header,
  .modal-body {
    padding: 1.5rem;
  }
  
  .form-actions {
    flex-direction: column-reverse;
  }
}

/* Tooltip styles matching Signer page */
.tooltip {
  position: relative;
  display: inline-block;
}

.tooltip:hover::after {
  content: attr(title);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.9);
  color: white;
  padding: 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  white-space: nowrap;
  z-index: 1000;
  margin-bottom: 0.25rem;
  font-family: 'Share Tech Mono', monospace;
}

.tooltip:hover::before {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-top-color: rgba(0, 0, 0, 0.9);
  z-index: 1000;
}

/* Utility classes */
.text-center { text-align: center; }
.space-y-2 > * + * { margin-top: 0.5rem; }
.space-y-3 > * + * { margin-top: 0.75rem; }
.space-y-4 > * + * { margin-top: 1rem; }
.space-y-6 > * + * { margin-top: 1.5rem; }
.space-y-8 > * + * { margin-top: 2rem; }
.flex { display: flex; }
.items-center { align-items: center; }
.justify-between { justify-content: space-between; }
.gap-2 { gap: 0.5rem; }
.gap-3 { gap: 0.75rem; }
.rounded { border-radius: 0.25rem; }
.rounded-lg { border-radius: 0.5rem; }
.transition-colors { transition: color 0.15s ease-in-out, background-color 0.15s ease-in-out, border-color 0.15s ease-in-out; }
.transition-transform { transition: transform 0.15s ease-in-out; }
.cursor-pointer { cursor: pointer; }
.select-none { user-select: none; }
.font-mono { font-family: 'Share Tech Mono', monospace; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.text-sm { font-size: 0.875rem; }
.text-xs { font-size: 0.75rem; }
.text-lg { font-size: 1.125rem; }
.text-4xl { font-size: 2.25rem; }
.mb-2 { margin-bottom: 0.5rem; }
.mb-3 { margin-bottom: 0.75rem; }
.mb-6 { margin-bottom: 1.5rem; }
.mb-8 { margin-bottom: 2rem; }
.ml-2 { margin-left: 0.5rem; }
.mt-8 { margin-top: 2rem; }
.pt-6 { padding-top: 1.5rem; }
.p-3 { padding: 0.75rem; }
.p-4 { padding: 1rem; }
.p-6 { padding: 1.5rem; }
.p-8 { padding: 2rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.py-8 { padding-top: 2rem; padding-bottom: 2rem; }
.py-12 { padding-top: 3rem; padding-bottom: 3rem; }
.w-3 { width: 0.75rem; }
.w-4 { width: 1rem; }
.w-5 { width: 1.25rem; }
.w-12 { width: 3rem; }
.h-3 { height: 0.75rem; }
.h-4 { height: 1rem; }
.h-5 { height: 1.25rem; }
.h-12 { height: 3rem; }
.h-64 { height: 16rem; }
.h-\[300px\] { height: 300px; }
.max-w-4xl { max-width: 56rem; }
.min-h-screen { min-height: 100vh; }
.overflow-hidden { overflow: hidden; }
.overflow-y-auto { overflow-y: auto; }
.border { border-width: 1px; }
.border-t { border-top-width: 1px; }
.border-l { border-left-width: 1px; }
.rounded-full { border-radius: 9999px; }
.shadow-lg { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); }
.backdrop-blur-sm { backdrop-filter: blur(4px); }
.mx-auto { margin-left: auto; margin-right: auto; }



<!-- Signer -->

import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Card, CardContent } from "@/components/ui/card"
import { Tooltip } from "@/components/ui/tooltip"
import { createConnectedNode, validateShare, validateGroup, decodeShare, decodeGroup, cleanupBifrostNode } from "@frostr/igloo-core"
import { Copy, Check, X, HelpCircle } from "lucide-react"
import type { SignatureEntry, ECDHPackage, SignSessionPackage, BifrostNode } from '@frostr/bifrost'
import { EventLog, type LogEntryData } from "./EventLog"
import { Input } from "@/components/ui/input"
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
      addLog('ready', 'Node is ready', data);
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
          const messageData = msg as { tag: unknown; [key: string]: unknown };
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
      // Ping events
      { event: '/ping/sender/req', type: 'bifrost', message: 'Ping request sent' },
      { event: '/ping/sender/res', type: 'bifrost', message: 'Ping response received' },
      { event: '/ping/handler/req', type: 'bifrost', message: 'Ping request received' },
      { event: '/ping/handler/res', type: 'bifrost', message: 'Ping response sent' },
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

      // Ping events with special signatures
      const pingSenderRetHandler = (reason: string, msg: unknown) => 
        addLog('bifrost', `Ping operation completed: ${reason}`, msg);
      const pingSenderErrHandler = (reason: string, msg: unknown) => 
        addLog('bifrost', `Ping operation failed: ${reason}`, msg);
      const pingHandlerRetHandler = (reason: string, msg: unknown) => 
        addLog('bifrost', `Ping handled: ${reason}`, msg);
      const pingHandlerErrHandler = (reason: string, msg: unknown) => 
        addLog('bifrost', `Ping handling failed: ${reason}`, msg);

      nodeAny.on('/ping/sender/ret', pingSenderRetHandler);
      nodeAny.on('/ping/sender/err', pingSenderErrHandler);
      nodeAny.on('/ping/handler/ret', pingHandlerRetHandler);
      nodeAny.on('/ping/handler/err', pingHandlerErrHandler);

      cleanupFunctions.push(() => {
        try {
          nodeAny.off('/ping/sender/ret', pingSenderRetHandler);
          nodeAny.off('/ping/sender/err', pingSenderErrHandler);
          nodeAny.off('/ping/handler/ret', pingHandlerRetHandler);
          nodeAny.off('/ping/handler/err', pingHandlerErrHandler);
        } catch (e) {
          console.warn('Error removing ping event listeners:', e);
        }
      });
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
      
      <Card className="bg-gray-900/30 border-blue-900/30 backdrop-blur-sm shadow-lg">
        <CardContent className="p-8 space-y-8">
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
              </div>
              
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
              </div>
              
              <div className="flex items-center justify-between mt-6">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${
                    isSignerRunning 
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
                  className={`px-6 py-2 ${
                    isSignerRunning
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
          
          <EventLog 
            logs={logs} 
            isSignerRunning={isSignerRunning} 
            onClearLogs={() => setLogs([])}
          />
        </CardContent>
      </Card>
    </div>
  );
});

Signer.displayName = 'Signer';

export default Signer;
export type { SignerHandle }; 


<!-- page-layout -->

import React from 'react';
import { cn } from "@/lib/utils";

interface PageLayoutProps {
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
}

export function PageLayout({ 
  children, 
  className, 
  maxWidth = "max-w-3xl" 
}: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 to-blue-950 text-blue-100 p-8 flex flex-col items-center">
      <div className={cn("w-full", maxWidth, className)}>
        {children}
      </div>
    </div>
  );
}

<!-- eventlog -->


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


<!-- logentry -->

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
    } catch {
      return 'Error: Unable to format data';
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







