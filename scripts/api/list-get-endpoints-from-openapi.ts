/*
 Lists GET endpoints from docs/openapi/openapi.yaml to help operators audit coverage.
 Usage: bun scripts/api/list-get-endpoints-from-openapi.ts
 */

import { readFile } from 'node:fs/promises';
import YAML from 'yaml';

async function main() {
  const raw = await readFile('docs/openapi/openapi.yaml', 'utf8').catch(() => null);
  if (!raw) {
    console.error('docs/openapi/openapi.yaml not found.');
    process.exit(1);
  }
  const doc = YAML.parse(raw);
  const paths = doc?.paths || {};
  const gets: string[] = [];
  for (const [p, ops] of Object.entries<any>(paths)) {
    if (ops?.get) gets.push(p);
  }
  gets.sort();
  console.log('GET endpoints from OpenAPI:');
  for (const p of gets) console.log(` - ${p}`);
}

main();
