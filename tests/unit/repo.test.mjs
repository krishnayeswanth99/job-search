import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJC } from './load.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const JC = loadJC(['shared/config.js', 'shared/profile-schema.js']);

const shape = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? shape(v) : typeof v]));

test('setup profile template matches the extension profile schema', () => {
  const tpl = JSON.parse(readFileSync(path.join(root, 'skills/setup/assets/profile.template.json'), 'utf8'));
  assert.deepEqual(shape(tpl), shape(JC.emptyProfile()));
});

test('every skill has valid frontmatter and its referenced files exist', () => {
  const skills = readdirSync(path.join(root, 'skills')).filter((d) => existsSync(path.join(root, 'skills', d, 'SKILL.md')));
  assert.deepEqual(skills.sort(), ['customize-resume', 'job-apply', 'job-search', 'setup']);
  for (const s of skills) {
    const md = readFileSync(path.join(root, 'skills', s, 'SKILL.md'), 'utf8');
    const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(fm, `${s}: frontmatter`);
    assert.match(fm[1], new RegExp(`^name: ${s}$`, 'm'), `${s}: name`);
    const desc = (fm[1].match(/^description: (.+)$/m) || [])[1] || '';
    assert.ok(desc.length > 40 && desc.length <= 1024, `${s}: description length ${desc.length}`);
    // Relative references like `portals/linkedin.md`, `ats/workday.md`, `references/x.md`, `scripts/x.py`, `assets/x`.
    for (const [, ref] of md.matchAll(/`((?:portals|ats|references|scripts|assets)\/[\w./-]+\.(?:md|py|json))`/g)) {
      assert.ok(existsSync(path.join(root, 'skills', s, ref)), `${s}: missing ${ref}`);
    }
  }
});

test('shared references are in sync', () => {
  execFileSync('node', [path.join(root, 'scripts/sync-shared.mjs'), '--check'], { stdio: 'pipe' });
});

test('manifest lists existing files and versions agree', () => {
  const m = JSON.parse(readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  const files = [m.background.service_worker, m.action.default_popup, m.options_ui.page, ...m.content_scripts.flatMap((c) => c.js), ...Object.values(m.icons)];
  for (const f of files) assert.ok(existsSync(path.join(root, 'extension', f)), `missing ${f}`);
  const plugin = JSON.parse(readFileSync(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(m.version, JC.VERSION);
  assert.equal(plugin.version, m.version);
});
