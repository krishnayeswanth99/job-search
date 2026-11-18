import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJC } from './load.mjs';

const JC = loadJC(['shared/config.js', 'shared/profile-schema.js', 'shared/field-rules.js', 'shared/ask-prompt.js', 'shared/draft.js', 'shared/pdf-writer.js']);
const profile = JC.normalizeProfile({
  personal: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  work: { skills: 'Python, SQL, PyTorch' },
  experience: [
    { title: 'Senior Data Scientist', company: 'Acme Robotics', start: '2022-03', current: true, description: '• Built forecasting models that cut stockouts 18%.', details: 'Owned the demand-forecasting platform in PyTorch, serving 40 warehouses.' },
    { title: 'Data Analyst', company: 'Beta Corp', start: '2019-07', end: '2022-02', description: '• Built Tableau dashboards.' },
  ],
});

test('tailor prompt carries the job, every job with its details, and the rules', () => {
  const { prompt, schema } = JC.draft.buildTailorPrompt({ profile, job: { title: 'ML Engineer', company: 'Acme', description: 'Requirements: PyTorch.' } });
  assert.match(prompt, /JOB 0: Senior Data Scientist at Acme Robotics/);
  assert.match(prompt, /40 warehouses/);
  assert.match(prompt, /Never invent/);
  assert.match(prompt, /Requirements: PyTorch/);
  assert.ok(schema.properties.experience && schema.properties.coverLetter);
});

test('draft keeps only supported facts; approved drafts fill the profile', () => {
  const reply = JSON.stringify({
    summary: 'Data scientist.',
    experience: [{ job: 0, bullets: ['Built PyTorch forecasting for 40 warehouses, cutting stockouts 18%', 'Grew revenue 300%'] }, { job: 7, bullets: ['made up job'] }],
    skills: ['PyTorch', 'Kubernetes'],
    coverLetter: 'Dear Acme Team,\n\nHello.\n\nAda Lovelace',
    notes: [],
  });
  const d = JC.draft.fromModel(reply, profile, { key: 'k', title: 'ML Engineer', company: 'Acme' }, '');
  assert.equal(JSON.stringify(d.experience[0].bullets), JSON.stringify(['Built PyTorch forecasting for 40 warehouses, cutting stockouts 18%']));
  assert.equal(d.experience[1].bullets[0], 'Built Tableau dashboards.'); // not tailored: your own bullet
  assert.equal(d.experience[0].company, 'Acme Robotics');
  assert.equal(JSON.stringify(d.skills), JSON.stringify(['PyTorch']));
  assert.ok(d.warnings.some((w) => /numbers/.test(w)));
  assert.equal(JC.draft.applyToProfile(profile, d).experience[0].description, profile.experience[0].description); // not approved yet
  const p2 = JC.draft.applyToProfile(profile, Object.assign({}, d, { status: 'approved' }));
  assert.match(p2.experience[0].description, /40 warehouses/);
  assert.equal(p2.coverLetterText.split('\n')[0], 'Dear Acme Team,');
});

test('PDF writer makes a valid PDF with the text in it', () => {
  const d = JC.draft.fromModel(JSON.stringify({ summary: 'S', experience: [], skills: [], coverLetter: '', notes: [] }), profile, null, '');
  const bytes = JC.pdf.resume(JC.draft.resumeDoc(profile, d));
  const s = String.fromCharCode(...bytes.slice(0, 2000));
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.match(s, /\(Ada Lovelace\) Tj/);
  assert.match(String.fromCharCode(...bytes.slice(-200)), /%%EOF/);
});
