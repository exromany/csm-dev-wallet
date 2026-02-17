/**
 * E2E orchestrator — runs all *.e2e.ts files sequentially.
 *
 * Run: node --import tsx test/e2e/run-all.ts
 * Requires: npm run build first (or use `npm run test:e2e`)
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

const dir = resolve(import.meta.dirname);
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.e2e.ts'))
  .sort();

let totalPassed = 0;
let totalFailed = 0;

for (const file of files) {
  const path = resolve(dir, file);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Running: ${file}`);
  console.log('═'.repeat(60));

  try {
    execFileSync('npx', ['tsx', path], {
      stdio: 'inherit',
      timeout: 120_000,
    });
    totalPassed++;
  } catch {
    totalFailed++;
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`Suite: ${totalPassed} suites passed, ${totalFailed} suites failed (${files.length} total)`);
console.log('═'.repeat(60));

process.exit(totalFailed > 0 ? 1 : 0);
