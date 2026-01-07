import { afterEach, describe, expect, test } from 'bun:test';
import { pathToFileURL } from 'url';
import { runRouteScript } from './helpers/script-runner';

const PROJECT_ROOT = pathToFileURL(process.cwd() + '/').href;

afterEach(() => {
  delete process.env.NODE_ENV;
  delete process.env.HEADLESS;
  delete process.env.SKIP_RELAY_PROBE;
  delete process.env.DEFER_RELAY_PROBE;
});

describe('Relay probe optimization (3.1)', () => {
  describe('SKIP_RELAY_PROBE environment variable', () => {
    test('when true, sets constant correctly', () => {
      const script = `
        process.env.SKIP_RELAY_PROBE = 'true';
        const root = ${JSON.stringify(PROJECT_ROOT)};

        // Clear module cache to ensure fresh import with new env
        const CONST = await import(root + 'src/const.ts?skip1');

        console.log('@@RESULT@@' + JSON.stringify({
          skipRelayProbeValue: CONST.SKIP_RELAY_PROBE
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script, { SKIP_RELAY_PROBE: 'true' });
      expect(result.skipRelayProbeValue).toBe(true);
    }, { timeout: 10000 });

    test('when false or unset, does not skip probing', () => {
      const script = `
        process.env.SKIP_RELAY_PROBE = '';
        const root = ${JSON.stringify(PROJECT_ROOT)};

        const CONST = await import(root + 'src/const.ts?skip2');

        console.log('@@RESULT@@' + JSON.stringify({
          skipRelayProbeValue: CONST.SKIP_RELAY_PROBE
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script, { SKIP_RELAY_PROBE: '' });
      expect(result.skipRelayProbeValue).toBe(false);
    }, { timeout: 10000 });

    test('accepts various truthy values', () => {
      const truthyValues = ['true', 'TRUE', '1', 'yes', 'YES'];

      for (const value of truthyValues) {
        const script = `
          process.env.SKIP_RELAY_PROBE = '${value}';
          const root = ${JSON.stringify(PROJECT_ROOT)};
          const CONST = await import(root + 'src/const.ts?truthy_${value}');
          console.log('@@RESULT@@' + JSON.stringify({ value: '${value}', parsed: CONST.SKIP_RELAY_PROBE }));
          process.exit(0);
        `;
        const result = runRouteScript(script, { SKIP_RELAY_PROBE: value });
        expect(result.parsed).toBe(true);
      }
    }, { timeout: 15000 });

    test('rejects invalid values', () => {
      const invalidValues = ['false', 'FALSE', '0', 'no', 'NO', 'invalid', ''];

      for (const value of invalidValues) {
        const script = `
          process.env.SKIP_RELAY_PROBE = '${value}';
          const root = ${JSON.stringify(PROJECT_ROOT)};
          const CONST = await import(root + 'src/const.ts?invalid_${value}');
          console.log('@@RESULT@@' + JSON.stringify({ value: '${value}', parsed: CONST.SKIP_RELAY_PROBE }));
          process.exit(0);
        `;
        const result = runRouteScript(script, { SKIP_RELAY_PROBE: value });
        expect(result.parsed).toBe(false);
      }
    }, { timeout: 15000 });
  });

  describe('DEFER_RELAY_PROBE environment variable', () => {
    test('when true, defers probing to background', () => {
      const script = `
        process.env.DEFER_RELAY_PROBE = 'true';
        const root = ${JSON.stringify(PROJECT_ROOT)};

        const CONST = await import(root + 'src/const.ts?defer1');

        console.log('@@RESULT@@' + JSON.stringify({
          deferRelayProbeValue: CONST.DEFER_RELAY_PROBE
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script, { DEFER_RELAY_PROBE: 'true' });
      expect(result.deferRelayProbeValue).toBe(true);
    }, { timeout: 10000 });

    test('when false or unset, does not defer', () => {
      const script = `
        process.env.DEFER_RELAY_PROBE = 'false';
        const root = ${JSON.stringify(PROJECT_ROOT)};

        const CONST = await import(root + 'src/const.ts?defer2');

        console.log('@@RESULT@@' + JSON.stringify({
          deferRelayProbeValue: CONST.DEFER_RELAY_PROBE
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script, { DEFER_RELAY_PROBE: 'false' });
      expect(result.deferRelayProbeValue).toBe(false);
    }, { timeout: 10000 });
  });

  describe('filterRelaysForKindSupport function', () => {
    test('returns empty array for empty input', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';

        const { filterRelaysForKindSupport } = await import(root + 'src/node/manager.ts');

        const result = await filterRelaysForKindSupport([], 20004);

        console.log('@@RESULT@@' + JSON.stringify({
          result,
          isEmpty: result.length === 0
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.isEmpty).toBe(true);
    }, { timeout: 10000 });

    test('returns empty array for null/undefined input', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';

        const { filterRelaysForKindSupport } = await import(root + 'src/node/manager.ts');

        const result1 = await filterRelaysForKindSupport(null, 20004);
        const result2 = await filterRelaysForKindSupport(undefined, 20004);

        console.log('@@RESULT@@' + JSON.stringify({
          result1Length: result1.length,
          result2Length: result2.length
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.result1Length).toBe(0);
      expect(result.result2Length).toBe(0);
    }, { timeout: 10000 });

    test('handles invalid relay URLs gracefully', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';

        const { filterRelaysForKindSupport } = await import(root + 'src/node/manager.ts');

        let error = null;
        let result = [];
        try {
          result = await filterRelaysForKindSupport(['invalid://not-a-relay'], 20004);
        } catch (e) {
          error = e.message;
        }

        console.log('@@RESULT@@' + JSON.stringify({
          result,
          error,
          gracefullyHandled: error === null
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.gracefullyHandled).toBe(true);
    }, { timeout: 10000 });
  });

  describe('Background probe result accessor', () => {
    test('getLastBackgroundProbeResult returns null initially', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';

        const manager = await import(root + 'src/node/manager.ts');

        const hasFunction = typeof manager.getLastBackgroundProbeResult === 'function';
        const initialResult = hasFunction ? manager.getLastBackgroundProbeResult() : 'function_not_found';

        console.log('@@RESULT@@' + JSON.stringify({
          hasFunction,
          initialResult: initialResult === null ? 'null' : String(initialResult)
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.hasFunction).toBe(true);
      expect(result.initialResult).toBe('null');
    }, { timeout: 10000 });

    test('cancelBackgroundProbe is callable without error', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';

        const manager = await import(root + 'src/node/manager.ts');

        const hasFunction = typeof manager.cancelBackgroundProbe === 'function';
        let error = null;
        try {
          if (hasFunction) {
            manager.cancelBackgroundProbe();
          }
        } catch (e) {
          error = e.message;
        }

        console.log('@@RESULT@@' + JSON.stringify({
          hasFunction,
          error
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.hasFunction).toBe(true);
      expect(result.error).toBe(null);
    }, { timeout: 10000 });

    test('cancelBackgroundProbe can be called multiple times safely', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';

        const manager = await import(root + 'src/node/manager.ts');

        let errors = [];
        for (let i = 0; i < 3; i++) {
          try {
            manager.cancelBackgroundProbe();
          } catch (e) {
            errors.push(e.message);
          }
        }

        console.log('@@RESULT@@' + JSON.stringify({
          errorCount: errors.length,
          errors
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.errorCount).toBe(0);
    }, { timeout: 10000 });
  });

  describe('cleanupMonitoring integration', () => {
    test('cleanupMonitoring calls cancelBackgroundProbe', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';

        const manager = await import(root + 'src/node/manager.ts');

        const hasCleanup = typeof manager.cleanupMonitoring === 'function';
        let error = null;
        try {
          if (hasCleanup) {
            manager.cleanupMonitoring();
          }
        } catch (e) {
          error = e.message;
        }

        console.log('@@RESULT@@' + JSON.stringify({
          hasCleanup,
          error
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.hasCleanup).toBe(true);
      expect(result.error).toBe(null);
    }, { timeout: 10000 });
  });

  describe('Const exports', () => {
    test('SKIP_RELAY_PROBE and DEFER_RELAY_PROBE are exported', () => {
      const script = `
        const root = ${JSON.stringify(PROJECT_ROOT)};
        process.env.NODE_ENV = 'test';
        process.env.HEADLESS = 'true';

        const CONST = await import(root + 'src/const.ts?exports');

        console.log('@@RESULT@@' + JSON.stringify({
          hasSkipRelayProbe: 'SKIP_RELAY_PROBE' in CONST,
          hasDeferRelayProbe: 'DEFER_RELAY_PROBE' in CONST,
          skipType: typeof CONST.SKIP_RELAY_PROBE,
          deferType: typeof CONST.DEFER_RELAY_PROBE
        }));
        process.exit(0);
      `;

      const result = runRouteScript(script);
      expect(result.hasSkipRelayProbe).toBe(true);
      expect(result.hasDeferRelayProbe).toBe(true);
      expect(result.skipType).toBe('boolean');
      expect(result.deferType).toBe('boolean');
    }, { timeout: 10000 });
  });
});
