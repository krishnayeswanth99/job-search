// Builds dist/job-copilot-extension-<version>.zip (for sharing or the Chrome Web Store)
// and dist/skills/<skill>.zip (each skill folder, for uploading as a standalone skill).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const { version } = JSON.parse(readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'skills'), { recursive: true });

execFileSync('node', [path.join(root, 'scripts/sync-shared.mjs')], { stdio: 'inherit' });
const ext = path.join(dist, `job-copilot-extension-${version}.zip`);
execFileSync('zip', ['-qr', ext, '.', '-x', '*.DS_Store', 'README.md'], { cwd: path.join(root, 'extension') });
console.log('built', path.relative(root, ext));
for (const s of readdirSync(path.join(root, 'skills'))) {
  if (!existsSync(path.join(root, 'skills', s, 'SKILL.md'))) continue;
  const out = path.join(dist, 'skills', `${s}.zip`);
  execFileSync('zip', ['-qr', out, s, '-x', '*.DS_Store', '*__pycache__*'], { cwd: path.join(root, 'skills') });
  console.log('built', path.relative(root, out));
}
