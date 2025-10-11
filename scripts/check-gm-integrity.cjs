// scripts/check-gm-integrity.cjs
const { readFileSync, statSync } = require('fs');
const { createHash } = require('crypto');

const p = 'src/pages/GuestManager.tsx';
const buf = readFileSync(p);
const text = buf.toString('utf-8');
// LOC = total lines minus one if the last line is blank
const lines = text.split('\n');
const loc = lines.length - (lines[lines.length - 1] === '' ? 1 : 0);
const bytes = statSync(p).size;
const sha = createHash('sha256').update(buf).digest('hex');

const EXPECT = {
  loc: 951,
  bytes: 37955,
  sha: '289f32aa7d3973fe340e66cdca1a1d9db89c5e601d8066e4fe38536b15e93030'
};

if (loc !== EXPECT.loc || bytes !== EXPECT.bytes || sha !== EXPECT.sha) {
  console.error(`[INTEGRITY FAIL]
Expected LOC=${EXPECT.loc}, BYTES=${EXPECT.bytes}, SHA=${EXPECT.sha}
Actual   LOC=${loc},       BYTES=${bytes}, SHA=${sha}`);
  process.exit(1);
} else {
  console.log('[INTEGRITY OK] GuestManager.tsx matches SSOT invariants.');
}
