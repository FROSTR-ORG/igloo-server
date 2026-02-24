/**
 * Minimal FROSTR co-signer for smoke tests.
 *
 * Usage: node cosigner.mjs <groupCred> <shareCred> <relayUrl>
 */

const [,, groupCred, shareCred, relayUrl] = process.argv;

if (!groupCred || !shareCred || !relayUrl) {
  console.error('Usage: cosigner.mjs <groupCred> <shareCred> <relayUrl>');
  process.exit(1);
}

const {
  createBifrostNode,
  connectNode,
} = await import('@frostr/igloo-core');

/**
 * Serializes a value to JSON, replacing circular refs with "[Circular]" to avoid
 * "Converting circular structure to JSON" TypeError from bubbling into outer catch.
 * @param {unknown} obj - Value to serialize
 * @returns {string} JSON string or fallback representation
 */
function safeStringify(obj) {
  const seen = new WeakSet();
  function replacer(_key, value) {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  }
  try {
    return JSON.stringify(obj, replacer);
  } catch (e) {
    return '[Non-serializable]';
  }
}

let node;
try {
  node = createBifrostNode({
    group: groupCred,
    share: shareCred,
    relays: [relayUrl],
  }, { enableLogging: false });

  node.on('ready', () => {
    console.log('[cosigner] Node ready. PubKey:', node.pubkey?.slice(0, 16));
    console.log('[cosigner] Peers:', node.peers.map(p => p.pubkey?.slice(0, 16)).join(', '));
  });
  node.on('closed', () => console.log('[cosigner] Node closed'));
  node.on('error', (e) => console.log('[cosigner] Error:', String(e).slice(0, 200)));
  node.on('bounced', (...args) => console.log('[cosigner] Bounced:', JSON.stringify(args).slice(0, 200)));
  node.on('message', (msg) => {
    console.log('[cosigner] Message tag:', msg?.tag, '| from:', msg?.env?.pubkey?.slice(0,16));
  });
  node.on('/sign/handler/req', (msg) => console.log('[cosigner] SIGN REQ received, id:', msg?.id));
  node.on('/sign/handler/res', () => console.log('[cosigner] SIGN RES sent'));
  node.on('/sign/handler/rej', (...a) => console.log('[cosigner] SIGN REJ:', JSON.stringify(a).slice(0, 200)));

  // Also spy on the raw WebSocket to confirm relay subscription
  node.on('subscribed', (...a) => console.log('[cosigner] Subscribed to relay, sub_id:', JSON.stringify(a).slice(0, 100)));

  console.log('[cosigner] Connecting to relay:', relayUrl);
  await connectNode(node);
  console.log('[cosigner] Connected. Pubkey:', node.pubkey);
  const filter = node.client?.filter;
  const privateFilter = node.client?._filter;
  if (filter !== undefined) {
    console.log('[cosigner] Filter (public):', safeStringify(filter));
  } else if (privateFilter !== undefined) {
    // TODO: Remove private fallback once @frostr/igloo-core exposes a stable public filter accessor.
    console.warn('[cosigner] Filter fallback in use: node.client._filter (private internals)');
    console.log('[cosigner] Filter (private fallback):', safeStringify(privateFilter));
  } else {
    console.warn('[cosigner] Filter unavailable on node.client (public and private fields missing)');
  }

} catch (err) {
  console.error('[cosigner] Failed to start:', err.message ?? err);
  process.exit(2);
}

const shutdown = () => {
  try { node?.close?.(); } catch {}
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

setInterval(() => {}, 60_000);
