import { useState, useEffect } from 'react'
import { useClientCtx } from '@/demo/context/client.js'
import { useStore } from '@/demo/context/store.js'
import type { PermissionRequest, PermissionPolicy } from '@/types/index.js'
import type { PermRequest } from '@/demo/components/requests/cards/types.js'

// Transform PermissionRequest to PermRequest for UI
function transformRequest(req: PermissionRequest): PermRequest {
  const request_type = req.method === 'sign_event' ? 'note_signature' : 'base'
  
  // Extract content from params
  let content: unknown = undefined
  if (req.params && req.params.length > 0) {
    if (req.method === 'sign_event') {
      try {
        content = JSON.parse(req.params[0])
      } catch {
        content = req.params[0]
      }
    } else {
      content = { params: req.params }
    }
  }

  // Extract session origin from session profile
  const session_origin = {
    name: req.session.profile?.name,
    image: req.session.profile?.image,
    pubkey: req.session.pubkey,
    url: req.session.profile?.url
  }

  return {
    id: req.id,
    method: req.method,
    source: req.session.profile?.name || 'Unknown App',
    content,
    timestamp: req.stamp,
    session_origin,
    request_type,
    status: 'pending'
  }
}

// Format notification content based on request type
function formatNotificationContent(request: PermRequest) {
  const appName = request.source || 'Unknown App'
  
  let title = `Permission Request from ${appName}`
  let body = `Requesting to ${request.method}`
  
  if (request.request_type === 'note_signature') {
    title = `Sign Event Request from ${appName}`
    body = 'Requesting to sign a Nostr event'
  } else if (request.method === 'get_public_key') {
    body = 'Requesting access to your public key'
  } else if (request.method === 'encrypt') {
    body = 'Requesting to encrypt a message'
  } else if (request.method === 'decrypt') {
    body = 'Requesting to decrypt a message'
  }
  
  return { title, body }
}

export interface UseRequestsResult {
  // State
  pendingRequests: PermRequest[]
  expanded: Set<string>
  isLoading: boolean
  notificationEnabled: boolean
  
  // Methods
  toggleExpanded: (requestId: string) => void
  handleApprove: (requestId: string) => void
  handleDeny: (requestId: string) => void
  handleApproveAll: () => void
  handleDenyAll: () => void
  handleApproveAllKinds: (kind: number) => void
  handleDenyAllKinds: (kind: number) => void
}

export function useRequests(): UseRequestsResult {
  const ctx = useClientCtx()
  const store = useStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [pendingRequests, setPendingRequests] = useState<PermRequest[]>([])
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default')

  // Check notification permission
  const checkNotificationPermission = () => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission)
    }
  }

  // Show notification for new request
  const showNotificationForRequest = (request: PermRequest) => {
    // Check both app setting and browser permission
    if (!store.data.notificationsEnabled || notificationPermission !== 'granted' || !('Notification' in window)) {
      return
    }

    const { title, body } = formatNotificationContent(request)
    const clientTimeout = ctx.client?.request?.timeout || 30000 // Default 30 seconds
    const notificationTimeout = Math.max(clientTimeout, 30000) // At least 30 seconds for notifications

    try {
      const notification = new Notification(title, {
        body: `${body}\n\nClick to open app and respond to this request.`,
        tag: request.id,
        requireInteraction: true, // Make it more persistent
        silent: false,
        icon: '/icon.svg'
      })

      // Handle notification click (open app and focus on requests)
      notification.onclick = () => {
        window.focus()
        notification.close()
        
        // Try to navigate to requests section if possible
        if (window.location.hash !== '#requests') {
          window.location.hash = '#requests'
        }
      }

      // Auto-dismiss after timeout
      const timeoutId = setTimeout(() => {
        notification.close()
      }, notificationTimeout)

      // Clear timeout if notification is closed early
      notification.onclose = () => {
        clearTimeout(timeoutId)
      }

    } catch (error) {
      console.error('Failed to show notification:', error)
    }
  }

  // Update requests when they change
  useEffect(() => {
    const updateRequests = () => {
      if (!ctx.client || !ctx.client.request) {
        setPendingRequests([])
        return
      }
      
      const rawRequests = ctx.client.request.queue || []
      const newRequests = rawRequests.map(transformRequest)
      
      // Check for new requests to show notifications
      // Use a ref to track previous request IDs to avoid dependency issues
      setPendingRequests(prevRequests => {
        const previousIds = new Set(prevRequests.map(r => r.id))
        const newRequestsToNotify = newRequests.filter(r => !previousIds.has(r.id))
        
        // Show notifications for new requests
        newRequestsToNotify.forEach(request => {
          showNotificationForRequest(request)
        })
        
        return newRequests
      })
    }

    // Initial update
    updateRequests()

    // Listen for request changes only if client and request exist
    if (ctx.client && ctx.client.request) {
      ctx.client.request.on('prompt',  updateRequests)
      ctx.client.request.on('approve', updateRequests)
      ctx.client.request.on('deny',    updateRequests)

      return () => {
        // Add null check in cleanup too
        if (ctx.client && ctx.client.request) {
          ctx.client.request.off('prompt',  updateRequests)
          ctx.client.request.off('approve', updateRequests)
          ctx.client.request.off('deny',    updateRequests)
        }
      }
    }
  }, [ctx.client, notificationPermission, store.data.notificationsEnabled])

  // Check notification permission on mount and when it changes
  useEffect(() => {
    checkNotificationPermission()
    
    // Listen for permission changes
    const handleVisibilityChange = () => {
      checkNotificationPermission()
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Handler functions
  const toggleExpanded = (requestId: string) => {
    const newExpanded = new Set(expanded)
    if (newExpanded.has(requestId)) {
      newExpanded.delete(requestId)
    } else {
      newExpanded.add(requestId)
    }
    setExpanded(newExpanded)
  }

  const handleApprove = (requestId: string) => {
    if (!ctx.client || !ctx.client.request) return
    const request = ctx.client.request.queue.find((req: PermissionRequest) => req.id === requestId)
    if (request) {
      ctx.client.request.approve(request)
    }
  }

  const handleDeny = (requestId: string) => {
    if (!ctx.client || !ctx.client.request) return
    const request = ctx.client.request.queue.find((req: PermissionRequest) => req.id === requestId)
    if (request) {
      ctx.client.request.deny(request, 'denied by user')
    }
  }

  const handleApproveAll = () => {
    if (!ctx.client || !ctx.client.request) return
    ctx.client.request.queue.forEach((request: PermissionRequest) => {
      ctx.client.request.approve(request)
    })
  }

  const handleDenyAll = () => {
    if (!ctx.client || !ctx.client.request) return
    ctx.client.request.queue.forEach((request: PermissionRequest) => {
      ctx.client.request.deny(request, 'denied by user')
    })
  }

  const handleApproveAllKinds = (kind: number) => {
    if (!ctx.client || !ctx.client.request) return
    ctx.client.request.queue
      .filter((req: PermissionRequest) => {
        if (req.method === 'sign_event' && req.params?.[0]) {
          try {
            const event = JSON.parse(req.params[0])
            return event.kind === kind
          } catch {
            return false
          }
        }
        return false
      })
      .forEach((request: PermissionRequest) => {
        const policyChanges: Partial<PermissionPolicy> = {
          kinds: { [kind]: true }
        }
        ctx.client.request.approve(request, policyChanges)
      })
  }

  const handleDenyAllKinds = (kind: number) => {
    if (!ctx.client || !ctx.client.request) return
    ctx.client.request.queue
      .filter((req: PermissionRequest) => {
        if (req.method === 'sign_event' && req.params?.[0]) {
          try {
            const event = JSON.parse(req.params[0])
            return event.kind === kind
          } catch {
            return false
          }
        }
        return false
      })
      .forEach((request: PermissionRequest) => {
        const policyChanges: Partial<PermissionPolicy> = {
          kinds: { [kind]: false }
        }
        ctx.client.request.deny(request, 'denied by user', policyChanges)
      })
  }

  return {
    // State
    pendingRequests,
    expanded,
    isLoading: !ctx.client && ctx.status !== 'locked',
    
    // Methods
    toggleExpanded,
    handleApprove,
    handleDeny,
    handleApproveAll,
    handleDenyAll,
    handleApproveAllKinds,
    handleDenyAllKinds,
    
    // Notification state (both app setting and browser permission required)
    notificationEnabled: store.data.notificationsEnabled && notificationPermission === 'granted'
  }
} 