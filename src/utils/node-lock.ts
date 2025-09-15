import { PrivilegedRouteContext } from '../routes/types.js';

// Add a lock to prevent concurrent node updates
let nodeUpdateLock: Promise<void> = Promise.resolve();

/**
 * Helper function to execute node operations under lock without poisoning the queue.
 * This ensures that node operations are executed sequentially, preventing race conditions
 * when multiple requests try to update the node state simultaneously.
 *
 * @param operation - The async operation to execute under lock
 * @param context - The privileged route context for logging
 * @returns The result of the operation
 * @throws Re-throws any errors from the operation for caller visibility
 */
export async function executeUnderNodeLock<T>(
  operation: () => Promise<T>,
  context: PrivilegedRouteContext
): Promise<T> {
  // Create a promise for this specific operation
  const run = nodeUpdateLock.then(operation);

  // Update the queue to continue even if this operation fails
  // This preserves queue continuity while allowing caller to see errors
  nodeUpdateLock = run
    .then(() => undefined)
    .catch(() => undefined);

  // Add error handling that logs but re-throws for caller visibility
  return run.catch((error) => {
    context.addServerLog('error', 'Node operation failed', error);
    throw error; // Re-throw so callers see the failure
  });
}

/**
 * Synchronized node cleanup function that ensures proper cleanup
 * of the Bifrost node when credentials are deleted.
 *
 * @param context - The privileged route context for node management
 */
export async function cleanupNodeSynchronized(context: PrivilegedRouteContext): Promise<void> {
  return executeUnderNodeLock(async () => {
    if (context.node) {
      context.addServerLog('info', 'Credentials deleted, cleaning up Bifrost node...');
      // updateNode(null) will handle all cleanup atomically
      context.updateNode(null);
      context.addServerLog('info', 'Bifrost node cleaned up successfully');
    }
  }, context);
}