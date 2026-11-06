// Copies shared/ (browser + data + safety references, tracker script) into each
// skill's references/shared/ so every skill folder is self-contained (works as a
// plugin skill and as a standalone uploaded skill).
//   node scripts/sync-shared.mjs          write copies
//   node scripts/sync-shared.mjs --check  exit 1 if any copy is stale
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shared = path.join(root, 'shared');
const skills = readdirSync(path.join(root, 'skills')).filter((d) => existsSync(path.join(root, 'skills', d, 'SKILL.md')));
const check = process.argv.includes('--check');

function walk(dir, base = '') {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p, path.join(base, f)) : [path.join(base, f)];
  });
}

const HEADER = (rel) => (rel.endsWith('.md') ? `<!-- Generated from shared/${rel} by scripts/sync-shared.mjs. Edit the source, not this copy. -->\n` : '');
let stale = 0;
for (const skill of skills) {
  for (const rel of walk(shared)) {
    const src = readFileSync(path.join(shared, rel), 'utf8');
    const body = HEADER(rel) + src;
    const dest = path.join(root, 'skills', skill, 'references', 'shared', rel);
    const cur = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
    if (cur === body) continue;
    if (check) {
      console.error(`stale: ${path.relative(root, dest)}`);
      stale++;
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, body);
    if (rel.endsWith('.py')) chmodSync(dest, 0o755);
    console.log(`wrote ${path.relative(root, dest)}`);
  }
}
if (check && stale) {
  console.error(`${stale} stale file(s). Run: npm run sync-shared`);
  process.exit(1);
}
if (check) console.log('shared references in sync');
