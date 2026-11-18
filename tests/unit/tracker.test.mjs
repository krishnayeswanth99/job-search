import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../shared/scripts/tracker.py');
const home = mkdtempSync(path.join(os.tmpdir(), 'jc-tracker-'));
const run = (...args) => {
  try {
    return { code: 0, out: JSON.parse(execFileSync('python3', [script, ...args], { env: { ...process.env, JOB_SEARCH_HOME: home } }).toString()) };
  } catch (e) {
    return { code: e.status, out: JSON.parse(e.stdout.toString()) };
  }
};

test('one job across board and ATS URLs', (t) => {
  t.after(() => rmSync(home, { recursive: true, force: true }));
  run('init');
  const a = run('add', '--portal', 'linkedin', '--company', 'Acme', '--title', 'Engineer', '--url', 'https://www.linkedin.com/jobs/search/?currentJobId=123&trk=x');
  assert.equal(a.out.row.url, 'https://www.linkedin.com/jobs/view/123/');
  run('update', '--id', a.out.row.id, '--apply-url', 'https://job-boards.greenhouse.io/acme/jobs/9?gh_src=linkedin');
  // Found again later on the ATS board directly: recognised as the same job.
  const again = run('add', '--portal', 'greenhouse', '--company', 'Acme', '--title', 'Engineer', '--url', 'https://job-boards.greenhouse.io/acme/jobs/9');
  assert.equal(again.out.added, false);
  assert.equal(run('exists', '--url', 'https://job-boards.greenhouse.io/acme/jobs/9').code, 0);
  assert.equal(run('exists', '--url', 'https://job-boards.greenhouse.io/acme/jobs/10').code, 1);
});
