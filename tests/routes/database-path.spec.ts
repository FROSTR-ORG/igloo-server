import { describe, expect, test } from 'bun:test';
import { runRouteScript, PROJECT_ROOT } from './helpers/script-runner';

describe('database path inference', () => {
  test('treats a fresh extensionless DB_PATH as a file path', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igloo-db-path-'));
      const dbPath = path.join(tmpDir, 'main');
      process.env.DB_PATH = dbPath;
      process.env.HEADLESS = 'false';

      const database = await import(root + 'src/db/database.ts');

      try {
        database.default.exec('SELECT 1');
      } finally {
        try { await database.closeDatabase(); } catch {}
      }

      console.log('@@RESULT@@' + JSON.stringify({
        dbPath,
        fileExistsAtRequestedPath: fs.existsSync(dbPath),
        nestedDefaultExists: fs.existsSync(path.join(dbPath, 'igloo.db'))
      }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.fileExistsAtRequestedPath).toBe(true);
    expect(result.nestedDefaultExists).toBe(false);
  });
});
