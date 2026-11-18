import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJC } from './load.mjs';

const JC = loadJC(['shared/config.js', 'shared/profile-schema.js', 'shared/field-rules.js', 'shared/nano-check.js']);
const N = JC.nanoCheck;
const profile = JC.normalizeProfile({
  personal: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  work: { currentTitle: 'Engineer', desiredSalary: '$175,000' },
  eeo: { gender: 'Female' },
});

test('bio has the applicant data, never pay or EEO answers', () => {
  const keys = N.bio(profile).map((b) => b.key);
  assert.ok(keys.includes('firstName') && keys.includes('currentTitle') && keys.includes('fullName'));
  assert.ok(!keys.includes('desiredSalary'));
  assert.ok(!keys.includes('gender'));
  assert.ok(!N.buildPrompt({ review: [], profile }).prompt.includes('Female'));
});

test('the model can only name profile fields or none, and only disagreements come back', () => {
  const review = [
    { ref: 'a', label: 'Middle Name', type: 'text', profileKey: 'fullName', weak: true },
    { ref: 'b', label: 'Given Name(s)', type: 'text', profileKey: 'firstName' },
    { ref: 'c', label: 'Title', type: 'text', profileKey: 'currentTitle', weak: true },
  ];
  const { prompt, fields, keys } = N.buildPrompt({ review, profile });
  assert.match(prompt, /f1: "Middle Name" \(text\) filled with fullName/);
  const sch = N.schema(fields, keys);
  assert.ok(sch.properties.checks.properties.f1.enum.includes('none'));
  assert.ok(!sch.properties.checks.properties.f1.enum.includes('gender'));
  const fixes = N.parse('{"checks": {"f1": "none", "f2": "firstName", "f3": "madeUpKey"}}', fields, keys);
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].ref, 'a');
  assert.equal(fixes[0].to, 'none');
  assert.equal(fixes[0].weak, true);
});

test('answer check: the model only says ok / wrong / unsure; doubtful ones come back', () => {
  const items = [
    { selector: '#a', label: 'Have you built production software in Python or Java?', type: 'radio', options: ['Yes', 'No'], value: 'Yes', source: 'resume' },
    { selector: '#b', label: 'Are you willing to relocate?', type: 'select', options: ['Yes', 'No'], value: 'Yes', source: 'saved-answer' },
  ];
  const { prompt, fields } = N.buildVerifyPrompt({ items, profile });
  assert.match(prompt, /a1: "Have you built production software in Python or Java\?" \(options: Yes \| No\) -> "Yes"/);
  assert.ok(!prompt.includes('Female'));
  assert.deepEqual([...N.verifySchema(fields).properties.verdicts.properties.a2.enum], ['ok', 'wrong', 'unsure']);
  const flags = N.parseVerify('{"verdicts": {"a1": "ok", "a2": "unsure"}}', fields);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].selector, '#b');
  assert.equal(flags[0].verdict, 'unsure');
});

test('answer check sees the job and earlier answers to similar questions', () => {
  const J2 = loadJC(['shared/config.js', 'shared/profile-schema.js', 'shared/field-rules.js', 'shared/ask-prompt.js', 'shared/nano-check.js']);
  const p = J2.normalizeProfile({ answers: [{ question: 'Are you willing to relocate to New York?', answer: 'Yes' }, { question: 'Favourite colour?', answer: 'Blue' }] });
  const { prompt } = J2.nanoCheck.buildVerifyPrompt({ items: [{ selector: '#r', label: 'Are you willing to relocate?', type: 'select', options: ['Yes', 'No'], value: 'Yes', source: 'saved-answer' }], profile: p, job: { title: 'ML Engineer', company: 'Acme', description: 'Requirements: Python. Relocation to New York required.' } });
  assert.match(prompt, /willing to relocate to New York\? -> Yes/);
  assert.ok(!/Favourite colour/.test(prompt));
  assert.match(prompt, /THE JOB \(ML Engineer at Acme\)/);
});
