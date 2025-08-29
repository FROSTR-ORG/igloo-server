import { useEffect, useState } from 'react'
import { useStore }            from '@/demo/context/store.js'

import {
  decode_secret,
  encrypt_secret
} from '@/demo/lib/crypto.js'

import {
  generateSecretKey,
  nip19
} from 'nostr-tools'

export function SecretConfig() {
  const store = useStore()

  const [ secret,   setSecret   ] = useState<string>(store.data.encrypted || '')
  const [ password, setPassword ] = useState<string>('')
  const [ changes,  setChanges  ] = useState<boolean>(false)
  const [ error,    setError    ] = useState<string | null>(null)
  const [ saved,    setSaved    ] = useState<boolean>(false)

  // Generate a new nsec key
  const generateNewSecret = () => {
    const seckey = generateSecretKey()
    const nsec   = nip19.nsecEncode(seckey)
    handleSecretChange(nsec)
  }

  // Update the nsec in the store
  const update = () => {
    if (!password) {
      setError('Password is required')
      return
    }
    const seckey = decode_secret(secret)
    if (!seckey) {
      setError('Invalid secret key')
      return
    }
    const encrypted = encrypt_secret(seckey, password)
    store.update({ encrypted })
    setChanges(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  // Discard changes by resetting local state from store
  const cancel = () => {
    setSecret(store.data.encrypted || '')
    setPassword('')
    setChanges(false)
  }

  // Validate nsec format
  const validateSecret = (value: string): boolean => {
    const seckey = decode_secret(value)
    return seckey !== null
  }

  // Handle nsec input changes
  const handleSecretChange = (value: string) => {
    setSecret(value)
    if (value && !validateSecret(value)) {
      setError('Invalid secret key')
    } else {
      setError(null)
    }
    setChanges(true)
  }

  // Handle password changes
  const handlePasswordChange = (value: string) => {
    setPassword(value)
    setChanges(true)
  }

  useEffect(() => {
    setSecret(store.data.encrypted || '')
  }, [store.data.encrypted])

  return (
    <div className="container">
      <h2 className="section-header">Nostr Secret Key</h2>
      <p className="description">Configure your Nostr secret key (nsec) for signing events. This key should be kept secure and never shared.</p>
      
      <div className="input-group nsec-row">
        <input
          type="password"
          value={secret}
          onChange={(e) => handleSecretChange(e.target.value)}
          placeholder="nsec1..."
          className="nsec-input flex-input"
        />
        <button 
          onClick={generateNewSecret}
          className="button button-secondary flex-btn"
        >
          Generate
        </button>
      </div>

      <div className="input-group password-row">
        <input
          type="password"
          value={password}
          onChange={(e) => handlePasswordChange(e.target.value)}
          placeholder="Enter password to encrypt nsec..."
          className="nsec-input flex-input"
        />
        <button 
          onClick={update}
          disabled={!changes || !!error || !password}
          className={`button button-primary action-button flex-btn ${saved ? 'saved-button' : ''}`}
        >
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
      
      <div className="action-buttons">
        {changes && (
          <button 
            onClick={cancel}
            className="button"
          >
            Cancel
          </button>
        )}
        <div className="notification-container">
          {error && <p className="error-text">{error}</p>}
        </div>
      </div>
    </div>
  )
} 