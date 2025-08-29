import { LOG_LIMIT } from '@/demo/const.js'

import {
  createContext,
  useContext,
  useState,
  useRef,
  ReactNode
} from 'react'

import type { LogEntry } from '@/demo/types/index.js'

interface LogsAPI {
  entries   : LogEntry[]
  addLog    : (entry: LogEntry) => void
  addLogs   : (entries: LogEntry[]) => void
  clearLogs : () => void
}

interface LogsProviderProps {
  children: ReactNode
}

const LogsContext = createContext<LogsAPI | null>(null)

export function LogsProvider({ children }: LogsProviderProps): JSX.Element {
  const [ logs, setLogs ] = useState<LogEntry[]>([])
  
  const batchRef   = useRef<LogEntry[]>([])
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const flushBatch = () => {
    if (batchRef.current.length > 0) {
      setLogs(currentLogs => {
        let newLogs = [...currentLogs, ...batchRef.current]
        
        // Apply log limit
        if (newLogs.length > LOG_LIMIT) {
          const diff = newLogs.length - LOG_LIMIT
          newLogs = newLogs.slice(diff)
        }

        return newLogs
      })
      batchRef.current = []
    }
  }

  const addLog = (entry: LogEntry) => {
    batchRef.current.push(entry)
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    
    timeoutRef.current = setTimeout(flushBatch, 100) // 100ms batching
  }

  const addLogs = (entries: LogEntry[]) => {
    batchRef.current.push(...entries)
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    
    timeoutRef.current = setTimeout(flushBatch, 100)
  }

  const clearLogs = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    batchRef.current = []
    setLogs([])
  }

  return (
    <LogsContext.Provider value={{ entries: logs, addLog, addLogs, clearLogs }}>
      {children}
    </LogsContext.Provider>
  )
}

export function useLogs(): LogsAPI {
  const context = useContext(LogsContext)
  if (context === null) {
    throw new Error('useLogs must be used within a LogsProvider')
  }
  return context
} 