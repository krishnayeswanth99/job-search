import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJC } from './load.mjs';

const JC = loadJC(['shared/config.js', 'shared/profile-schema.js', 'shared/claude-resume.js']);
const CR = JC.claudeResume;

test('schema meets structured-output rules (every object closed, every key required)', () => {
  const walk = (s, where) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, `${where}: additionalProperties`);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${where}: required`);
      for (const [k, v] of Object.entries(s.properties)) walk(v, `${where}.${k}`);
    } else if (s.type === 'array') walk(s.items, `${where}[]`);
    else assert.ok(['string', 'number', 'integer', 'boolean'].includes(s.type), `${where}: ${s.type}`);
    for (const bad of ['minLength', 'maxLength', 'minimum', 'maximum']) assert.ok(!(bad in s), `${where}: ${bad}`);
  };
  walk(CR.schema(), 'root');
});

test('schema only asks for resume facts, all of which exist in the profile', () => {
  const profileKeys = new Set(JC.PROFILE_SECTIONS.flatMap((s) => s.fields.map(([k]) => `${s.id}.${k}`)));
  for (const [sec, keys] of Object.entries(CR.FIELDS)) for (const k of keys) assert.ok(profileKeys.has(`${sec}.${k}`), `${sec}.${k}`);
  const s = JSON.stringify(CR.schema());
  for (const banned of ['authorization', 'eeo', 'desiredSalary', 'requiresSponsorship', 'gender']) assert.ok(!s.includes(banned), banned);
});

test('prompt carries the date and the no-guessing rule', () => {
  const p = CR.prompt('2026-11-06');
  assert.match(p, /2026-11-06/);
  assert.match(p, /Never guess/);
});

test('toResult maps non-empty values and notes', () => {
  const r = CR.toResult({
    personal: { firstName: 'Jane', lastName: 'Doe', email: 'jane@x.com', phone: '', phoneCountryCode: '', address1: '', city: 'SF', state: 'CA', postalCode: '', country: 'United States' },
    links: { linkedin: 'https://www.linkedin.com/in/jane', github: '', portfolio: '', website: '', twitter: '' },
    work: { currentTitle: 'Engineer', currentCompany: 'Stripe', yearsExperience: '7 years', skills: 'Go, Python' },
    education: { school: 'UC Berkeley', degree: 'B.S.', fieldOfStudy: 'CS', graduationYear: '2017', gpa: '' },
    summary: 'Backend engineer.',
    notes: ['Internship excluded from years.'],
  });
  assert.equal(r.fields['personal.firstName'].value, 'Jane');
  assert.equal(r.fields['personal.firstName'].confidence, 'claude');
  assert.equal(r.fields['work.yearsExperience'].value, '7');
  assert.equal(r.fields.summary.value, 'Backend engineer.');
  assert.ok(!('personal.phone' in r.fields));
  assert.deepEqual([...r.warnings], ['Internship excluded from years.']);
  assert.deepEqual(Object.keys(CR.toResult(null).fields), []);
});

test('model list defaults to Haiku 5.5', () => {
  assert.equal(CR.DEFAULT_MODEL, 'claude-haiku-5-5');
  assert.deepEqual([...CR.MODELS.map((m) => m.id)], ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
});
