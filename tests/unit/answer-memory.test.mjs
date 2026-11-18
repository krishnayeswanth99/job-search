import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJC } from './load.mjs';

const JC = loadJC();
const { mergeAnswers, matchSavedAnswer, isCompanySpecific, looksSensitive } = JC.rules;
const NOW = '2026-11-07T00:00:00Z';

test('remembers custom answers, scopes company-specific ones', () => {
  const r = mergeAnswers([], [
    { question: 'What is your favorite robot?*', answer: 'R2-D2' },
    { question: 'Why do you want to work at Acme?', answer: 'Robots.' },
    { question: 'What excites you about joining us?', answer: 'The mission.' },
  ], { company: 'acme', host: 'job-boards.greenhouse.io', now: NOW });
  assert.equal(r.added, 3);
  const [robot, why, excite] = r.answers;
  assert.equal(robot.question, 'What is your favorite robot?');
  assert.equal(robot.scope, 'any');
  assert.equal(robot.source, 'remembered');
  assert.equal(why.scope, 'company');
  assert.equal(why.company, 'acme');
  assert.equal(excite.scope, 'company');
});

test('never stores identifiers or overwrites the user\'s own answers', () => {
  const own = [{ question: 'What is your favorite robot?', answer: 'WALL-E' }];
  const r = mergeAnswers(own, [
    { question: 'What is your favorite robot?', answer: 'R2-D2' },
    { question: 'Emergency contact', answer: 'jane@example.com' },
    { question: 'Home phone', answer: '+1 (415) 555-0134' },
    { question: 'SSN', answer: '123-45-6789' },
  ], { company: 'acme', now: NOW });
  assert.equal(r.added, 0);
  assert.equal(r.answers[0].answer, 'WALL-E');
  // Also when the captured copy would be company-scoped.
  const own2 = [{ question: 'Why do you want to work at Acme?', answer: 'Mine.' }];
  assert.equal(mergeAnswers(own2, [{ question: 'Why do you want to work at Acme?', answer: 'Mine.' }], { company: 'acme' }).added, 0);
  assert.ok(looksSensitive('4111 1111 1111 1111'));
  assert.ok(!looksSensitive('5 years'));
});

test('updates a remembered answer and counts uses', () => {
  let { answers } = mergeAnswers([], [{ question: 'Preferred team?', answer: 'Infra' }], { company: 'a', now: NOW });
  ({ answers } = mergeAnswers(answers, [{ question: 'Preferred team?', answer: 'Platform' }], { company: 'b', now: NOW }));
  assert.equal(answers.length, 1);
  assert.equal(answers[0].answer, 'Platform');
  assert.equal(answers[0].uses, 2);
});

test('reuse: company scope respected, remembered answers need a near-identical question', () => {
  const { answers } = mergeAnswers([], [
    { question: 'Why do you want to work at Acme?', answer: 'Robots.' },
    { question: 'Are you legally authorized to work in Singapore?', answer: 'No' },
    { question: 'How many years of experience do you have with Python?', answer: '6' },
  ], { company: 'acme', now: NOW });
  assert.equal(matchSavedAnswer('Why do you want to work at Acme?', answers, { company: 'acme' }), 'Robots.');
  assert.equal(matchSavedAnswer('Why do you want to work at Acme?', answers, { company: 'globex' }), null);
  assert.equal(matchSavedAnswer('Are you legally authorized to work in Singapore? *', answers, { company: 'x' }), 'No');
  assert.equal(matchSavedAnswer('Are you legally authorized to work in the United States?', answers, { company: 'x' }), null);
  assert.equal(matchSavedAnswer('How many years of experience do you have with Java?', answers, {}), null);
  assert.equal(matchSavedAnswer('How many years of experience do you have with Python?', answers, {}), '6');
});

test('company-specific detection', () => {
  assert.ok(isCompanySpecific('Why are you interested in this role?', '', 'acme'));
  assert.ok(isCompanySpecific('Tell us about yourself', 'I have long admired Acme', 'acme'));
  assert.ok(!isCompanySpecific('What is your favorite robot?', 'R2-D2', 'acme'));
});
