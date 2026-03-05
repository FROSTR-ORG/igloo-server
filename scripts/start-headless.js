#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

function runScript(name) {
  const result = spawnSync('bun', ['run', name], { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status);
  }
}

if (process.env.HEADLESS !== 'true') {
  console.log('HEADLESS is not true. Skipping headless start flow.');
  process.exit(0);
}

try {
  runScript('build');
  runScript('start');
} catch (error) {
  console.error('Failed to run headless startup flow:', error);
  process.exit(1);
}
