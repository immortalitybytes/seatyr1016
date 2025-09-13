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
  loc: 529,
  bytes: 21687,
  sha: 'ca29aff4bcf70f6883043862349bed27fa5ce146a633743cd3de9680de1210f7'
};

if (loc !== EXPECT.loc || bytes !== EXPECT.bytes || sha !== EXPECT.sha) {
  console.error(`[INTEGRITY FAIL]
Expected LOC=${EXPECT.loc}, BYTES=${EXPECT.bytes}, SHA=${EXPECT.sha}
Actual   LOC=${loc},       BYTES=${bytes}, SHA=${sha}`);
  process.exit(1);
} else {
  console.log('[INTEGRITY OK] GuestManager.tsx matches SSOT invariants.');
}
