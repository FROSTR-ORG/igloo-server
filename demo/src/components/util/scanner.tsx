import { useEffect, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'
import '@/styles/scanner.css'

interface QRScannerProps {
  onResult: (result: string) => void
  onError?: (error: Error) => void
}

export function QRScanner({ onResult, onError }: QRScannerProps) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<QrScanner | null>(null)

  const [ error,   setError ] = useState<string | null>(null)
  const [ hasPerm, setPerm  ] = useState<boolean | null>(null)

  useEffect(() => {
    let scanner: QrScanner | null = null

    const initializeScanner = async () => {
      if (!videoRef.current) {
        setError('Video element not found')
        return
      }

      try {
        scanner = new QrScanner(
          videoRef.current,
          (result : QrScanner.ScanResult) => {
            onResult(result.data)
            scanner?.stop()
          },
          { returnDetailedScanResult: true }
        )

        // Start scanning
        await scanner.start()
        setError(null)
        setPerm(true)
        scannerRef.current = scanner
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to initialize scanner')
        setError(error.message)
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
        playsInline 
        autoPlay 
        muted
      />
      {error && (
        <div className="scanner-error">
          {error}
          {hasPerm === false && (
            <div className="scanner-error-permission">
              Please grant camera permissions to use the QR scanner
            </div>
          )}
        </div>
      )}
    </div>
  )
} 