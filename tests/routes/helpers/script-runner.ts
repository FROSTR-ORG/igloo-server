import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

export const PROJECT_ROOT = pathToFileURL(process.cwd() + '/').href;

export function runRouteScript(code: string, env: Record<string, string> = {}) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'igloo-route-'));
  try {
    const runner = path.join(tmpDir, 'runner.ts');
    writeFileSync(runner, code, 'utf8');

    const result = Bun.spawnSync({
      cmd: ['bun', 'run', runner],
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 15000,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `route script failed: status=${result.exitCode} stderr="${result.stderr.toString()}" stdout="${result.stdout.toString()}"`
      );
    }

    const marker = '@@RESULT@@';
    const stdout = result.stdout.toString().trim();
    const line = stdout.split('\n').findLast(l => l.includes(marker));
    if (!line) {
      throw new Error(`route script missing result marker: ${stdout}`);
    }
    return JSON.parse(line.slice(line.indexOf(marker) + marker.length));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
