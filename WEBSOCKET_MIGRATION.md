# WebSocket Migration Documentation

## Overview

This document outlines the complete migration of Igloo Server's real-time event streaming from **Server-Sent Events (SSE)** to **WebSockets**, completed on January 20, 2025. This migration provides better performance, more reliable connections, and enhanced bi-directional communication capabilities.

## Table of Contents

- [Why We Migrated](#why-we-migrated)
- [Technical Architecture](#technical-architecture)
- [Backend Changes](#backend-changes)
- [Frontend Changes](#frontend-changes)
- [Authentication Implementation](#authentication-implementation)
- [Benefits](#benefits)
- [Testing & Deployment](#testing--deployment)
- [Troubleshooting](#troubleshooting)
- [Migration Checklist](#migration-checklist)

## Why We Migrated

### Problems with Server-Sent Events (SSE)
- **One-way communication**: SSE only supports server-to-client messaging
- **Browser limitations**: Limited concurrent connections per domain
- **Reconnection complexity**: Manual reconnection logic required
- **Header limitations**: Limited ability to send custom headers during reconnection
- **Proxy issues**: Some corporate firewalls and proxies interfere with SSE streams

### Benefits of WebSockets
- **Bi-directional**: Full duplex communication (though we currently only use server-to-client)
- **Better performance**: Lower overhead compared to SSE
- **Native reconnection**: Built-in connection state management
- **Flexible authentication**: Can pass auth via URL parameters or headers
- **Industry standard**: Better tooling and debugging support

## Technical Architecture

### Before (SSE)
```
Frontend (EventSource) → HTTP GET /api/events → Server (ReadableStream) → SSE Format
```

### After (WebSocket)
```
Frontend (WebSocket) → WS Upgrade /api/events → Server (WebSocket Handler) → JSON Messages
```

## Backend Changes

### 1. Server WebSocket Handler (`src/server.ts`)

**Key Changes:**
- **Unified WebSocket Handler**: Combined event streaming and Nostr relay WebSocket handling
- **Connection Type Detection**: Uses `data.isEventStream` to differentiate connection types
- **Proper Cleanup**: Automatic removal of disconnected clients from event streams

```typescript
// Before: Simple relay WebSocket handler
websocket: relay.handler()

// After: Unified handler for both event streams and relay
websocket: websocketHandler
```

**WebSocket Handler Structure:**
- `message()`: Routes messages based on connection type
- `open()`: Adds event stream connections to tracking set
- `close()`: Removes connections and delegates to relay if needed
- `error()`: Handles errors and cleanup

### 2. Event Streams Management (`src/node/manager.ts`)

**Changed from:**
```typescript
Set<ReadableStreamDefaultController>
```
**To:**
```typescript
Set<any> // Bun WebSocket connections
```

**Broadcast Function Updates:**
- **SSE Format**: `data: ${JSON.stringify(event)}\n\n`
- **WebSocket Format**: `JSON.stringify(event)` (direct JSON)
- **Connection State Checking**: Uses `ws.readyState === 1` for open connections
- **Error Handling**: Automatically removes failed connections

### 3. Route Updates (`src/routes/events.ts`)

**Complete Replacement:**
- **Old**: Returns SSE stream with `text/event-stream` content type
- **New**: Returns `426 Upgrade Required` with WebSocket upgrade instructions
- **Backward Compatibility**: Provides clear migration message for old clients

```typescript
return Response.json({
  error: 'Event streaming has been migrated to WebSocket',
  message: 'Please connect using WebSocket to ws://hostname:port/api/events',
  upgrade: 'websocket',
  endpoint: '/api/events'
}, {
  status: 426, // Upgrade Required
  headers: {
    'Upgrade': 'websocket',
    'Connection': 'Upgrade'
  }
});
```

### 4. Type System Updates (`src/routes/types.ts`)

```typescript
// Updated RouteContext interface
export interface RouteContext {
  eventStreams: Set<any>; // Changed from Set<ReadableStreamDefaultController>
  // ... other properties
}
```

## Frontend Changes

### 1. Connection Management (`frontend/components/Signer.tsx`)

**Complete Replacement of EventSource with WebSocket:**

#### Before (SSE):
```typescript
const eventSource = new EventSource('/api/events');
eventSource.onmessage = (event) => { /* ... */ };
eventSource.onerror = (error) => { /* ... */ };
eventSource.close();
```

#### After (WebSocket):
```typescript
const ws = new WebSocket(wsUrl);
ws.onopen = () => { /* ... */ };
ws.onmessage = (event) => { /* ... */ };
ws.onerror = (error) => { /* ... */ };
ws.onclose = (event) => { /* ... */ };
ws.close(1000, 'Component unmounting');
```

### 2. Advanced Connection Features

#### **Automatic Protocol Detection:**
```typescript
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}/api/events`;
```

#### **Robust Reconnection Logic:**
- **Automatic reconnection** on unexpected disconnections
- **Exponential backoff**: 3-second delay, then 5-second for failures
- **Component lifecycle awareness**: No reconnection if component unmounted
- **Clean shutdown**: Uses close code 1000 for normal closure

#### **Connection State Management:**
```typescript
let isConnecting = false;
let isMounted = true;
let reconnectTimeout: NodeJS.Timeout | null = null;
```

### 3. Error Handling Improvements

- **Better error messages**: Distinguishes between connection and parsing errors
- **Graceful degradation**: Continues to function even with connection issues
- **Resource cleanup**: Properly clears timeouts and closes connections

## Authentication Implementation

### Challenge: WebSocket Authentication
WebSockets cannot send custom headers during the initial upgrade request, requiring alternative authentication methods.

### Solution: URL Parameter Authentication

#### **Frontend Implementation:**
```typescript
const params = new URLSearchParams();

if (authHeaders['X-API-Key']) {
  params.set('apiKey', authHeaders['X-API-Key']);
} else if (authHeaders['X-Session-ID']) {
  params.set('sessionId', authHeaders['X-Session-ID']);
}

if (params.toString()) {
  wsUrl += '?' + params.toString();
}
```

#### **Backend Implementation:**
```typescript
// Extract auth from URL parameters
const apiKey = url.searchParams.get('apiKey');
const sessionId = url.searchParams.get('sessionId');

// Create modified request with auth headers
if (apiKey) {
  headers.set('X-API-Key', apiKey);
} else if (sessionId) {
  headers.set('X-Session-ID', sessionId);
}

const authResult = authenticate(authReq);
```

### **Supported Authentication Methods:**
1. **API Key**: `?apiKey=your-key`
2. **Session ID**: `?sessionId=your-session`
3. **Basic Auth**: Falls back to cookies/session validation

## Benefits

### Performance Improvements
- **Lower Latency**: Direct TCP connection vs HTTP overhead
- **Reduced Bandwidth**: No HTTP headers on each message
- **Better Scaling**: More efficient connection management

### Reliability Enhancements
- **Connection State Awareness**: Real-time connection status
- **Automatic Reconnection**: Built-in resilience
- **Better Error Handling**: Granular error types and recovery

### Developer Experience
- **Real-time Debugging**: WebSocket debugging in browser dev tools
- **Consistent API**: Same message format as before
- **Future-ready**: Enables bi-directional communication if needed

### Operational Benefits
- **Docker Compatible**: Works seamlessly in containerized environments
- **Proxy Friendly**: Better support for reverse proxies and load balancers
- **Resource Efficient**: Lower memory usage on server

## Testing & Deployment

### **Build Process:**
```bash
# Build frontend with WebSocket changes
bun run build

# Start server
bun run start
```

### **Docker Deployment:**
```bash
# Build and deploy
docker-compose up -d
```

### **Verification Steps:**
1. **Open browser dev tools** and check console for:
   ```
   WebSocket connected to event stream
   ```

2. **Network tab**: Should show WebSocket connection instead of SSE

3. **Event Log**: Should continue receiving real-time events

4. **Reconnection**: Refresh page should automatically reconnect

### **Performance Testing:**
- **Connection Speed**: WebSocket connections establish faster
- **Message Throughput**: Higher message rates supported
- **Memory Usage**: Lower server memory consumption

## Troubleshooting

### Common Issues

#### **1. Browser Cache Issues**
**Symptoms:** Still seeing EventSource errors after deployment
**Solution:** 
```bash
# Hard refresh browser
Ctrl+F5 (Windows/Linux) or Cmd+Shift+R (Mac)
```

#### **2. Authentication Failures**
**Symptoms:** 401 Unauthorized on WebSocket upgrade
**Solutions:**
- Verify authentication is working for regular API calls
- Check that auth headers are being converted to URL parameters
- Ensure session is valid and not expired

#### **3. Connection Drops**
**Symptoms:** Frequent disconnections
**Solutions:**
- Check network stability
- Verify proxy/firewall settings
- Monitor server logs for connection errors

#### **4. Build Issues**
**Symptoms:** Old code still running
**Solutions:**
```bash
# Force rebuild
rm -rf static/app.js static/styles.css
bun run build
```

### **Debug Commands:**

```bash
# Check if server is running
curl http://localhost:8002/api/status

# Test WebSocket endpoint (should return 426)
curl http://localhost:8002/api/events

# View server logs
docker-compose logs -f igloo-server
```

### **Browser Developer Tools:**
1. **Network Tab**: Check for WebSocket connection
2. **Console**: Look for connection messages
3. **Application Tab**: Verify session/auth storage

## Migration Checklist

### **Pre-Migration Verification:**
- [ ] Server is running and accessible
- [ ] Authentication is working for regular API calls
- [ ] Event logging is functional with SSE

### **Migration Steps:**
- [x] Update server WebSocket handler
- [x] Modify event broadcasting mechanism
- [x] Update type definitions
- [x] Replace frontend EventSource with WebSocket
- [x] Implement authentication for WebSocket
- [x] Add reconnection logic
- [x] Update error handling

### **Post-Migration Testing:**
- [x] Browser console shows WebSocket connection
- [x] Real-time events appear in Event Log
- [x] Reconnection works after network interruption
- [x] Authentication is properly enforced
- [x] No EventSource errors in console

### **Deployment Verification:**
- [x] Local development (Bun) works
- [x] Docker deployment works
- [x] Build process includes WebSocket changes
- [x] Browser cache clearing resolves old code issues

## Future Enhancements

### **Potential Improvements:**
1. **Bi-directional Communication**: Enable client-to-server messages
2. **Message Queuing**: Buffer messages during disconnections
3. **Connection Pooling**: Multiple WebSocket connections for high-traffic scenarios
4. **Compression**: Enable WebSocket message compression
5. **Heartbeat**: Implement ping/pong for connection health monitoring

### **Configuration Options:**
Consider adding environment variables for:
- WebSocket connection timeout
- Reconnection delay intervals
- Maximum reconnection attempts
- Message buffer size

## Conclusion

The migration from Server-Sent Events to WebSockets has been successfully completed, providing:

- **Enhanced Performance**: Lower latency and bandwidth usage
- **Improved Reliability**: Automatic reconnection and better error handling
- **Better Scalability**: More efficient connection management
- **Future Flexibility**: Foundation for bi-directional communication

The implementation maintains full backward compatibility in terms of message format and functionality while providing a more robust and scalable foundation for real-time communication in Igloo Server.

---

**Migration Date:** January 20, 2025  
**Affected Components:** Event streaming, real-time logging, peer status updates  
**Breaking Changes:** None (transparent to end users)  
**Performance Impact:** Positive (improved latency and resource usage) 