/*
 Sweep all GET paths declared in docs/openapi.yaml with API key.
 - Useful to see which endpoints are accessible vs. blocked with API key auth
 - Summary by status code at the end (does not fail the process)
 */

import { readFile } from 'node:fs/promises';
import YAML from 'yaml';

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:8002';
const API_KEY = process.env.API_KEY?.trim();

function u(p: string) { return p.startsWith('http') ? p : `${BASE_URL}${p}`; }
function auth(): HeadersInit { return API_KEY ? { 'X-API-Key': API_KEY, Accept: 'application/json' } : { Accept: 'application/json' }; }

async function loadGetPaths(): Promise<string[]> {
  const raw = await readFile('docs/openapi.yaml', 'utf8').catch(() => null);
  if (!raw) return [];
  const doc = YAML.parse(raw);
  const paths = doc?.paths || {};
  const gets: string[] = [];
  for (const [p, ops] of Object.entries<any>(paths)) if (ops?.get) gets.push(p);
  return gets.sort();
}

async function probe(path: string): Promise<{ path: string; status: number }> {
  try {
    const r = await fetch(u(path), { method: 'GET', headers: auth() });
    return { path, status: r.status };
  } catch { return { path, status: -1 }; }
}

async function main() {
  console.log('\n== OpenAPI GET sweep ==');
  console.log(`Base URL: ${BASE_URL}`);
  if (!API_KEY) console.log('Warning: API_KEY not set; probing without key');
  const paths = await loadGetPaths();
  if (paths.length === 0) {
    console.log('No GET endpoints found in docs/openapi.yaml');
    return;
  }
  const results = await Promise.all(paths.map(probe));
  const groups = new Map<number, string[]>();
  for (const r of results) {
    const arr = groups.get(r.status) || [];
    arr.push(r.path);
    groups.set(r.status, arr);
  }
  for (const [status, list] of Array.from(groups.entries()).sort((a,b)=>a[0]-b[0])) {
    const label = status === -1 ? 'ERR' : String(status);
    console.log(`\n[${label}] ${list.length} endpoints`);
    for (const p of list) console.log(` - ${p}`);
  }
}

main();

