#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const root = process.cwd();
const packageJsonPath = path.join(root, 'package.json');
const openapiYamlPath = path.join(root, 'docs/openapi/openapi.yaml');
const openapiJsonPath = path.join(root, 'docs/openapi/openapi.json');

const mode = process.argv[2];

function isSemver(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readPackageVersion() {
  const pkg = readJson(packageJsonPath);
  const version = typeof pkg.version === 'string' ? pkg.version.trim() : '';
  if (!isSemver(version)) {
    throw new Error(`package.json version is not valid semver: "${pkg.version ?? ''}"`);
  }
  return version;
}

function updatePackageVersion(version) {
  const pkg = readJson(packageJsonPath);
  if (pkg.version !== version) {
    pkg.version = version;
    writeJson(packageJsonPath, pkg);
  }
}

function readOpenapiYamlVersion(rawYaml) {
  const match = rawYaml.match(/^  version:\s*([^\n]+)\s*$/m);
  return match ? match[1].trim() : null;
}

function updateOpenapiYamlVersion(version) {
  const rawYaml = readFileSync(openapiYamlPath, 'utf8');
  if (!/^  version:\s*[^\n]+\s*$/m.test(rawYaml)) {
    throw new Error('Unable to find docs/openapi/openapi.yaml info.version field');
  }
  const nextYaml = rawYaml.replace(/^  version:\s*[^\n]+\s*$/m, `  version: ${version}`);
  if (nextYaml !== rawYaml) {
    writeFileSync(openapiYamlPath, nextYaml, 'utf8');
  }
}

function updateOpenapiJsonVersion(version) {
  const doc = readJson(openapiJsonPath);
  if (!doc.info || typeof doc.info !== 'object') {
    throw new Error('docs/openapi/openapi.json is missing info metadata');
  }
  if (doc.info.version !== version) {
    doc.info.version = version;
    writeJson(openapiJsonPath, doc);
  }
}

function checkConsistency() {
  const packageVersion = readPackageVersion();
  const yamlVersion = readOpenapiYamlVersion(readFileSync(openapiYamlPath, 'utf8'));
  const openapiJson = readJson(openapiJsonPath);
  const jsonVersion = typeof openapiJson?.info?.version === 'string'
    ? openapiJson.info.version.trim()
    : null;

  const mismatches = [];
  if (yamlVersion !== packageVersion) {
    mismatches.push(`openapi.yaml=${yamlVersion ?? 'missing'}`);
  }
  if (jsonVersion !== packageVersion) {
    mismatches.push(`openapi.json=${jsonVersion ?? 'missing'}`);
  }

  if (mismatches.length > 0) {
    throw new Error(
      `Version metadata drift detected. package.json=${packageVersion}; ${mismatches.join('; ')}`
    );
  }

  console.log(`Version metadata is consistent at ${packageVersion}`);
}

function syncVersion(version) {
  if (!isSemver(version)) {
    throw new Error(`Expected semver version, received "${version}"`);
  }
  updatePackageVersion(version);
  updateOpenapiYamlVersion(version);
  updateOpenapiJsonVersion(version);
  console.log(`Synchronized release metadata to ${version}`);
}

try {
  if (mode === '--check') {
    checkConsistency();
  } else if (mode === '--from-package') {
    syncVersion(readPackageVersion());
  } else if (typeof mode === 'string' && mode.length > 0) {
    syncVersion(mode);
  } else {
    throw new Error('Usage: bun scripts/sync-version.mjs --check | --from-package | <version>');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
