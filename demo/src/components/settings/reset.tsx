import { useStore } from '@/demo/context/store.js'

export function ResetStore() {
  const store = useStore()

  // Update the peer policies in the store.
  const reset = () => {
    store.reset()
  }

  return (
    <div className="container">
      <h2 className="section-header">Reset Store</h2>
      <p className="description">Reset the store to the initial state.</p>

      <button 
        onClick={reset}
        className="button"
      >
        Reset Store
      </button>
    </div>
  )
}
