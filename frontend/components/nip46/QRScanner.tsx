import React, { useEffect, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'

interface QRScannerProps {
  onResult: (result: string) => void
  onError?: (error: Error) => void
}

export function QRScanner({ onResult, onError }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<QrScanner | null>(null)
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
        // Check if browser supports getUserMedia
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access is not supported in this browser')
        }

        scanner = new QrScanner(
          videoRef.current,
          (result: QrScanner.ScanResult) => {
            // Only process nostrconnect:// URLs
            if (result.data && result.data.startsWith('nostrconnect://')) {
              onResult(result.data)
              scanner?.stop()
            }
          },
          { 
            returnDetailedScanResult: true,
            highlightScanRegion: true,
            highlightCodeOutline: true,
          }
        )

        // Start scanning
        await scanner.start()
        setError(null)
        setHasPermission(true)
        scannerRef.current = scanner
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to initialize scanner')
        setError(error.message)
        setHasPermission(false)
        
        if (onError) {
          onError(error)
        } else {
          console.error('Failed to start QR scanner:', error)
        }
      }
    }

    initializeScanner()

    return () => {
      if (scanner) {
        scanner.stop()
        scanner.destroy()
      }
    }
  }, [onResult, onError])

  return (
    <div className="scanner-container">
      <video 
        ref={videoRef} 
        className="scanner-video" 
        style={{ 
          width: '100%', 
          height: 'auto',
          maxWidth: '500px',
          borderRadius: '8px'
        }}
        playsInline 
        autoPlay 
        muted
      />
      {error && (
        <div className="scanner-error">
          <p className="text-red-400 text-sm mt-2">{error}</p>
          {hasPermission === false && (
            <p className="text-gray-400 text-xs mt-1">
              Please grant camera permissions to use the QR scanner
            </p>
          )}
        </div>
      )}
      <p className="text-gray-400 text-xs mt-2 text-center">
        Scan a nostrconnect:// QR code to connect
      </p>
    </div>
  )
}