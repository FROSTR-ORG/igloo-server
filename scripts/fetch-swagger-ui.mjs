#!/usr/bin/env bun
/**
 * Fetches pinned Swagger UI assets and writes them to static/docs/ for self-hosting.
 * Assets: swagger-ui.css, swagger-ui-bundle.js, swagger-ui-standalone-preset.js
 */

import { mkdir } from 'node:fs/promises';

const VERSION = process.env.SWAGGER_UI_VERSION || '5.9.0';
const BASE = `https://unpkg.com/swagger-ui-dist@${VERSION}`;
const FILES = [
  'swagger-ui.css',
  'swagger-ui-bundle.js',
  'swagger-ui-standalone-preset.js'
];

async function fetchFile(path) {
  const url = `${BASE}/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf;
}

async function ensureDir(dir) {
  try {
    await mkdir(dir, { recursive: true, mode: 0o755 });
  } catch (e) {
    // ignore errors such as EEXIST for recursive mkdir
  }
}

async function main() {
  const outDir = 'static/docs';
  await ensureDir(outDir);

  for (const name of FILES) {
    const buf = await fetchFile(name);
    await Bun.write(`${outDir}/${name}`, buf, { createPath: true });
    console.log(`[docs:vendor] wrote ${outDir}/${name} (${buf.length} bytes)`);
  }
  console.log(`[docs:vendor] Swagger UI assets pinned at ${VERSION}.`);
}

main().catch((e) => {
  console.error('[docs:vendor] error:', e?.message || e);
  process.exit(1);
});
