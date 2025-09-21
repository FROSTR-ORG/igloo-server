import React, { useEffect, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'

// Ensure the QR scanner can locate its web worker at runtime.
QrScanner.WORKER_PATH = '/static/qr-scanner-worker.min.js'

interface QRScannerProps {
  onResult: (result: string) => void
  onError?: (error: Error) => void
}

export function QRScanner({ onResult, onError }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<QrScanner | null>(null)
  const scanningRef = useRef<boolean>(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)

  useEffect(() => {
    let scanner: QrScanner | null = null

    const initializeScanner = async () => {
      if (!videoRef.current) {
        setError('Video element not found')
        return
      }

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access is not supported in this browser')
        }

        scanner = new QrScanner(
          videoRef.current,
          (result: QrScanner.ScanResult) => {
            if (scanningRef.current) return
            if (result.data && result.data.startsWith('nostrconnect://')) {
              scanningRef.current = true
              onResult(result.data)
              scannerRef.current?.destroy()
              scannerRef.current = null
              timeoutRef.current = setTimeout(() => {
                scanningRef.current = false
              }, 1000)
            }
          },
          { returnDetailedScanResult: true, highlightScanRegion: true, highlightCodeOutline: true }
        )

        await scanner.start()
        setError(null)
        setHasPermission(true)
        scannerRef.current = scanner
      } catch (err) {
        const e = err instanceof Error ? err : new Error('Failed to initialize scanner')
        setError(e.message)
        setHasPermission(false)
        if (onError) {
            onError(e)
        } else {
            console.error('Failed to start QR scanner:', e)
        }
        scannerRef.current?.destroy()
        scannerRef.current = null
      }
    }

    initializeScanner()
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      scannerRef.current?.stop()
      scannerRef.current?.destroy()
      scannerRef.current = null
    }
  }, [onResult, onError])

  return (
    <div className="scanner-container">
      <video ref={videoRef} className="scanner-video" style={{ width: '100%', height: 'auto', maxWidth: '500px', borderRadius: '8px' }} playsInline autoPlay muted />
      {error && (
        <div className="scanner-error">
          <p className="text-red-400 text-sm mt-2">{error}</p>
          {hasPermission === false && (
            <p className="text-gray-400 text-xs mt-1">Please grant camera permissions to use the QR scanner</p>
          )}
        </div>
      )}
      <p className="text-gray-400 text-xs mt-2 text-center">Scan a nostrconnect:// QR code to connect</p>
    </div>
  )
}
