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
      let fileExistsAtRequestedPath = false;
      let nestedDefaultExists = false;
      process.env.DB_PATH = dbPath;
      process.env.HEADLESS = 'false';

      const database = await import(root + 'src/db/database.ts');

      try {
        database.default.exec('SELECT 1');
        fileExistsAtRequestedPath = fs.existsSync(dbPath);
        nestedDefaultExists = fs.existsSync(path.join(dbPath, 'igloo.db'));
      } finally {
        try { await database.closeDatabase(); } catch {}
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }

      console.log('@@RESULT@@' + JSON.stringify({
        dbPath,
        fileExistsAtRequestedPath,
        nestedDefaultExists
      }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.fileExistsAtRequestedPath).toBe(true);
    expect(result.nestedDefaultExists).toBe(false);
  });

  test('does not chmod the working directory for a bare relative DB_PATH file', () => {
    const script = `
      const root = ${JSON.stringify(PROJECT_ROOT)};
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'igloo-db-path-relative-'));
      let modeBefore = null;
      let modeAfter = null;

      try {
        process.chdir(tmpDir);
        fs.chmodSync(tmpDir, 0o755);
        modeBefore = fs.statSync(tmpDir).mode & 0o777;
        process.env.DB_PATH = 'main.db';
        process.env.HEADLESS = 'false';

        const database = await import(root + 'src/db/database.ts?relative_db_path');
        try {
          database.default.exec('SELECT 1');
        } finally {
          try { await database.closeDatabase(); } catch {}
        }
        modeAfter = fs.statSync(tmpDir).mode & 0o777;
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }

      console.log('@@RESULT@@' + JSON.stringify({ modeBefore, modeAfter }));
      process.exit(0);
    `;

    const result = runRouteScript(script);
    expect(result.modeBefore).toBe(0o755);
    expect(result.modeAfter).toBe(0o755);
  });
});
