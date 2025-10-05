#!/usr/bin/env node
/* Simple guardrail: if a file calls `getCapacity(` it must have a proper import line. */

import fs from 'fs';
import path from 'path';

const files = process.argv.slice(2).filter(f =>
  /\.(ts|tsx|js|jsx)$/.test(f) && fs.existsSync(f) && fs.statSync(f).isFile()
);

const importPattern =
  /import\s*\{\s*getCapacity\s*\}\s*from\s*['"][^'"]*utils\/tables['"];?/;

let failed = false;
for (const file of files) {
  const txt = fs.readFileSync(file, 'utf8');

  // Ignore the actual utils file that defines getCapacity
  if (/utils\/tables\.(t|j)sx?$/.test(file)) continue;

  const uses = /\bgetCapacity\s*\(/.test(txt);
  if (!uses) continue;

  const hasNamedImport = importPattern.test(txt);
  if (!hasNamedImport) {
    console.error(
      `\n[guard] ${file} uses getCapacity(...) but does not import it from utils/tables.\n` +
      `Add:  import { getCapacity } from '../utils/tables';  // adjust relative path as needed\n`
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
