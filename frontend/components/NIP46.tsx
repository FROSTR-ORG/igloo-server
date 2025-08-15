import React, { useState, useEffect } from 'react'
import { NIP46Controller } from './nip46/controller'
import { Sessions } from './nip46/Sessions'
import { Requests } from './nip46/Requests'
import { NIP46Config } from './nip46/types'
import { shareToPrivateKey } from './nip46/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { Button } from './ui/button'
import { Alert } from './ui/alert'
import { Badge } from './ui/badge'
import { StatusIndicator } from './ui/status-indicator'
import { cn } from '../lib/utils'
import { Shield, Users, Bell, Copy, QrCode } from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'

interface NIP46Props {
  privateKey?: string // This will come from the FROSTR share
  authHeaders?: Record<string, string>
}

export function NIP46({ privateKey, authHeaders }: NIP46Props) {
  const [controller, setController] = useState<NIP46Controller | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('sessions')
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [showQR, setShowQR] = useState(false)
  const [copied, setCopied] = useState(false)
  const [requestCount, setRequestCount] = useState(0)
  const [sessionCount, setSessionCount] = useState(0)

  // Default configuration for NIP46
  const defaultConfig: NIP46Config = {
    relays: [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.nostr.band',
      'wss://bucket.coracle.social'
    ],
    policy: {
      methods: {
        'sign_event': true,
        'get_public_key': true,
        'nip44_encrypt': true,
        'nip44_decrypt': true,
        'nip04_encrypt': true,
        'nip04_decrypt': true
      },
      kinds: {
        '1': true,  // Regular notes
        '4': true,  // DMs
        '7': true   // Reactions
      }
    },
    profile: {
      name: 'Igloo Server',
      url: window.location.origin,
      image: '/assets/frostr-logo-transparent.png'
    },
    timeout: 30
  }

  useEffect(() => {
    if (privateKey) {
      console.log('[NIP46] Private key available, initializing controller...')
      initializeController(privateKey)
    } else {
      console.log('[NIP46] No private key available')
    }

    return () => {
      if (controller) {
        console.log('[NIP46] Cleaning up controller')
        controller.disconnect()
      }
    }
  }, [privateKey])

  const initializeController = async (key: string) => {
    try {
      setError(null)
      // Convert FROSTR share to a hex private key
      const hexPrivateKey = shareToPrivateKey(key)
      const nip46Controller = new NIP46Controller(defaultConfig)
      
      // Set up event listeners before initialization
      nip46Controller.on('connected', () => {
        setIsConnected(true)
        // Generate invite URL once connected
        const invite = nip46Controller.createInvite()
        setInviteUrl(invite)
      })

      nip46Controller.on('disconnected', () => {
        setIsConnected(false)
        setInviteUrl(null)
      })

      nip46Controller.on('error', (err: Error) => {
        console.error('NIP46 Controller error:', err)
        setError(err.message)
      })

      // Update counts
      nip46Controller.on('request:new', () => {
        setRequestCount(prev => prev + 1)
      })

      nip46Controller.on('request:approved', () => {
        setRequestCount(prev => Math.max(0, prev - 1))
      })

      nip46Controller.on('request:denied', () => {
        setRequestCount(prev => Math.max(0, prev - 1))
      })

      nip46Controller.on('session:new', () => {
        setSessionCount(prev => prev + 1)
      })

      nip46Controller.on('session:revoked', () => {
        setSessionCount(prev => Math.max(0, prev - 1))
      })

      await nip46Controller.initialize(hexPrivateKey)
      setController(nip46Controller)
    } catch (err) {
      console.error('Failed to initialize NIP46:', err)
      setError(err instanceof Error ? err.message : 'Failed to initialize NIP46')
    }
  }

  const copyInviteUrl = () => {
    if (inviteUrl) {
      navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!privateKey) {
    return (
      <div className="space-y-6">
        <Alert variant="warning">
          <Shield className="h-4 w-4" />
          <span>NIP-46 remote signing requires an active signer with loaded credentials.</span>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Status Bar */}
      <div className="bg-gray-800/50 border border-blue-900/30 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <StatusIndicator
              status={isConnected ? 'success' : 'idle'}
              label={isConnected ? 'Connected' : 'Disconnected'}
            />
            <div className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-1">
                <Users className="h-4 w-4 text-blue-400" />
                <span className="text-gray-400">{sessionCount} sessions</span>
              </div>
              <div className="flex items-center gap-1">
                <Bell className="h-4 w-4 text-blue-400" />
                <span className="text-gray-400">{requestCount} requests</span>
              </div>
              {controller && controller.getPublicKey() && (
                <div className="flex items-center gap-1">
                  <Shield className="h-4 w-4 text-blue-400" />
                  <span className="text-gray-400 font-mono text-xs">
                    {controller.getPublicKey()?.slice(0, 8)}...
                  </span>
                </div>
              )}
            </div>
          </div>
          
          {isConnected && inviteUrl && (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setShowQR(!showQR)}
                variant="ghost"
                size="sm"
                className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/30"
              >
                <QrCode className="h-4 w-4 mr-1" />
                {showQR ? 'Hide' : 'Show'} QR
              </Button>
              <Button
                onClick={copyInviteUrl}
                variant="ghost"
                size="sm"
                className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/30"
              >
                <Copy className="h-4 w-4 mr-1" />
                {copied ? 'Copied!' : 'Copy Bunker URL'}
              </Button>
            </div>
          )}
        </div>

        {/* Bunker URL Display */}
        {isConnected && inviteUrl && showQR && (
          <div className="mt-4 pt-4 border-t border-blue-900/20">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Bunker Connection URL:</span>
                <Badge variant="info">NIP-46</Badge>
              </div>
              <div className="bg-gray-900/50 rounded-lg p-3">
                <code className="text-xs text-blue-300 break-all font-mono">
                  {inviteUrl}
                </code>
              </div>
              <div className="flex justify-center p-4 bg-white rounded-lg">
                <QRCodeCanvas value={inviteUrl} size={200} />
              </div>
              <p className="text-xs text-gray-500 text-center">
                Scan this QR code or copy the URL to connect a Nostr client
              </p>
            </div>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="error">
          {error}
        </Alert>
      )}

      {/* Main Content Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="w-full"
      >
        <TabsList className="grid grid-cols-2 mb-4 bg-gray-800/50 w-full">
          <TabsTrigger
            value="sessions"
            className="text-sm py-2 text-blue-400 data-[state=active]:bg-blue-900/60 data-[state=active]:text-blue-200"
          >
            <Users className="h-4 w-4 mr-2" />
            Sessions
            {sessionCount > 0 && (
              <Badge variant="info" className="ml-2">
                {sessionCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="requests"
            className="text-sm py-2 text-blue-400 data-[state=active]:bg-blue-900/60 data-[state=active]:text-blue-200"
          >
            <Bell className="h-4 w-4 mr-2" />
            Requests
            {requestCount > 0 && (
              <Badge variant="warning" className="ml-2">
                {requestCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="border border-blue-900/30 rounded-lg p-4">
          <Sessions controller={controller} />
        </TabsContent>

        <TabsContent value="requests" className="border border-blue-900/30 rounded-lg p-4">
          <Requests controller={controller} />
        </TabsContent>
      </Tabs>
    </div>
  )
}