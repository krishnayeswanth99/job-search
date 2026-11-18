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
