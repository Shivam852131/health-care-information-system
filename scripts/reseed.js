/*
 * npm run reseed — restore data/his.db to the pristine demo dataset.
 *
 * Wipes every table (with AUTOINCREMENT reset so ids match a fresh install),
 * re-runs the built-in seed, and clears stale upload files. Safe to run while
 * `npm run dev` is up: the whole reset happens inside one WAL transaction on a
 * dedicated connection, so the running server sees either the old or the new
 * dataset — never a half-wiped state.
 *
 * Demo password for every seeded account: demo123
 *   admin@demo.local · priya@demo.local · aarav@demo.local
 *   lab@demo.local · reception@demo.local
 */
import { reseed, DB_PATH } from '../lib/db.js';

const before = Date.now();
let counts;
try {
  counts = reseed();
} catch (err) {
  console.error('Reseed failed:', err?.message || err);
  process.exit(1);
}

const tables = Object.entries(counts)
  .map(([t, n]) => `${t}=${n}`)
  .join('  ');
console.log(`Reseeded ${DB_PATH} in ${Date.now() - before}ms`);
console.log(`  ${tables}`);
console.log('Demo login: admin@demo.local / demo123 (all accounts use demo123)');
