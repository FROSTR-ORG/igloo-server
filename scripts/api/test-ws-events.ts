/*
 WebSocket /api/events connectivity test using API key via query param.
 - Connects, waits for the initial system message, prints a summary, and exits.
 - BASE_URL default: http://localhost:8002
 - API_KEY required
 */

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:8002';
const API_KEY = process.env.API_KEY?.trim();
if (!API_KEY) {
  console.error('API_KEY env var is required. Example:');
  console.error('  API_KEY=... bun run api:test:ws');
  process.exit(2);
}

function wsUrl(): string {
  const http = BASE_URL.replace(/\/$/, '');
  const ws = http.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  return `${ws}/api/events?apiKey=${encodeURIComponent(API_KEY!)}`;
}

async function main() {
  console.log('\n== WS /api/events test ==');
  console.log(`Base URL: ${BASE_URL}`);
  const url = wsUrl();
  console.log(`Connecting: ${url}`);

  let gotMessage = false;
  let closedEarly = false;
  let closeCode = 0;
  let closeReason = '';

  const done = new Promise<void>((resolve) => {
    try {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        resolve();
      }, 5000);

      ws.onopen = () => {
        // no-op, server sends a system message automatically
      };
      ws.onmessage = (ev) => {
        if (!gotMessage) {
          gotMessage = true;
          console.log('✅ Received first message:', typeof ev.data === 'string' ? ev.data : '[binary]');
          try { ws.close(); } catch {}
        }
      };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        closeCode = ev.code;
        closeReason = ev.reason || '';
        closedEarly = !gotMessage;
        resolve();
      };
      ws.onerror = () => {
        // Bun/Node often report close via onclose too; rely on that for details
      };
    } catch (e: any) {
      console.log('❌ WebSocket error:', e?.message || String(e));
      resolve();
    }
  });

  await done;
  if (gotMessage) {
    console.log('WS result: ✅ OK');
  } else if (closedEarly) {
    console.log(`WS result: ❌ closed before message (code=${closeCode} reason=${closeReason || '—'})`);
    process.exitCode = 1;
  } else {
    console.log('WS result: ❌ no message received');
    process.exitCode = 1;
  }
}

main();

