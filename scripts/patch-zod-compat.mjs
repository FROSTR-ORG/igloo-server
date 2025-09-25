import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(ROOT, '..')
const ZOD_DIR = join(PROJECT_ROOT, 'node_modules', 'zod')
const NOSTR_SCHEMA_DIR = join(PROJECT_ROOT, 'node_modules', '@cmdcode', 'nostr-connect', 'dist', 'schema')

function ensureFile(path, content) {
  const current = readFileSync(path, 'utf8')
  if (current !== content) {
    writeFileSync(path, content)
  }
}

const esmStub = `import * as z from "./v3/external.js";\nexport * from "./v3/external.js";\nexport { z };\nexport default z;\n`
const cjsStub = `"use strict";\nvar __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    var desc = Object.getOwnPropertyDescriptor(m, k);\n    if (!desc || (\"get\" in desc ? !m.__esModule : desc.writable || desc.configurable)) {\n      desc = { enumerable: true, get: function() { return m[k]; } };\n    }\n    Object.defineProperty(o, k2, desc);\n}) : (function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    o[k2] = m[k];\n}));\nvar __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {\n    Object.defineProperty(o, \"default\", { enumerable: true, value: v });\n}) : function(o, v) {\n    o[\"default\"] = v;\n});\nvar __importStar = (this && this.__importStar) || function (mod) {\n    if (mod && mod.__esModule) return mod;\n    var result = {};\n    if (mod != null) for (var k in mod) if (k !== \"default\" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);\n    __setModuleDefault(result, mod);\n    return result;\n};\nvar __exportStar = (this && this.__exportStar) || function(m, exports) {\n    for (var p in m) if (p !== \"default\" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);\n};\nObject.defineProperty(exports, \"__esModule\", { value: true });\nexports.z = void 0;\nconst z = __importStar(require(\"./v3/external.cjs\"));\nexports.z = z;\n__exportStar(require(\"./v3/external.cjs\"), exports);\nexports.default = z;\n`
const cjsDeclarationStub = `import * as z from "./v3/external.cjs";\ndeclare const exported: typeof z & { readonly z: typeof z; readonly default: typeof z };\nexport = exported;\n`

ensureFile(join(ZOD_DIR, 'index.js'), esmStub)
ensureFile(join(ZOD_DIR, 'index.d.ts'), esmStub)
ensureFile(join(ZOD_DIR, 'index.cjs'), cjsStub)
ensureFile(join(ZOD_DIR, 'index.d.cts'), cjsDeclarationStub)

try {
  const schemaFiles = readdirSync(NOSTR_SCHEMA_DIR).filter(name => name.endsWith('.js'))
  for (const file of schemaFiles) {
    const fullPath = join(NOSTR_SCHEMA_DIR, file)
    const current = readFileSync(fullPath, 'utf8')
    const target = "import { zod as z } from '@vbyte/micro-lib/schema';"
    if (current.includes("import { z } from 'zod';")) {
      const updated = current.replace("import { z } from 'zod';", target)
      writeFileSync(fullPath, updated)
    }
  }
} catch (error) {
  console.error('[patch-zod-compat] Failed to patch nostr-connect schemas:', error.message)
}
