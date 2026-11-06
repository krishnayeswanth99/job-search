import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJC } from './load.mjs';

const JC = loadJC(['shared/config.js', 'shared/profile-schema.js', 'shared/resume-parser.js']);
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/resumes');
const NOW = new Date('2026-11-06T00:00:00Z');
const values = (file) => {
  const r = JC.resume.parse(readFileSync(path.join(dir, file), 'utf8'), { now: NOW });
  return Object.fromEntries(Object.entries(r.fields).map(([k, v]) => [k, v.value]));
};

test('classic US resume', () => {
  const v = values('classic-us.txt');
  const want = {
    'personal.firstName': 'Jane', 'personal.lastName': 'Doe', 'personal.email': 'jane.doe@gmail.com', 'personal.phone': '(415) 555-0134',
    'personal.city': 'San Francisco', 'personal.state': 'CA', 'personal.country': 'United States', 'personal.postalCode': '94105',
    'links.linkedin': 'https://www.linkedin.com/in/janedoe', 'links.github': 'https://github.com/janedoe', 'links.website': 'https://janedoe.dev',
    'work.currentTitle': 'Senior Software Engineer', 'work.currentCompany': 'Stripe', 'work.yearsExperience': '9',
    'education.school': 'University of California', 'education.degree': 'B.S.', 'education.fieldOfStudy': 'Computer Science',
    'education.graduationYear': '2017', 'education.gpa': '3.8/4.0',
  };
  for (const [k, w] of Object.entries(want)) assert.equal(v[k], w, k);
  assert.match(v.summary, /^Backend engineer with 7 years/);
  assert.match(v['work.skills'], /^Go, Python, SQL, TypeScript, Kubernetes/);
});

test('India-format resume with numeric dates and stacked headers', () => {
  const v = values('india-format.txt');
  const want = {
    'personal.firstName': 'Ravi', 'personal.lastName': 'Kumar', 'personal.email': 'ravi.kumar@outlook.com', 'personal.phone': '+91 98765 43210',
    'personal.phoneCountryCode': '+91', 'personal.city': 'Bengaluru', 'personal.state': 'Karnataka', 'personal.country': 'India',
    'links.linkedin': 'https://www.linkedin.com/in/ravi-kumar-123', 'work.currentTitle': 'Data Engineer', 'work.currentCompany': 'Flipkart',
    'work.yearsExperience': '8', 'education.degree': 'B.Tech', 'education.fieldOfStudy': 'Electronics and Communication Engineering',
    'education.graduationYear': '2018', 'education.gpa': '8.4/10',
  };
  for (const [k, w] of Object.entries(want)) assert.equal(v[k], w, k);
  assert.match(v['education.school'], /National Institute of Technology Karnataka/);
  assert.equal(v['work.skills'], 'Spark, Airflow, BigQuery, Python, Scala');
});

test('company-above-title layout and UK details', () => {
  const v = values('two-line-headers.txt');
  assert.equal(v['personal.firstName'], 'Alex');
  assert.equal(v['personal.phone'], '+44 7700 900123');
  assert.equal(v['personal.country'], 'United Kingdom');
  assert.equal(v['links.website'], 'https://alexmartin.design');
  assert.equal(v['work.currentTitle'], 'Product Designer');
  assert.equal(v['work.currentCompany'], 'Acme Ltd');
  assert.equal(v['education.degree'], 'Master of Arts');
  assert.equal(v['education.fieldOfStudy'], 'Interaction Design');
  assert.equal(v['education.school'], 'Royal College of Art');
  assert.equal(v['education.graduationYear'], '2019');
});

test('never invents fields that are not in the text', () => {
  const r = JC.resume.parse('Just some words\nwithout any details', { now: NOW });
  assert.deepEqual(Object.keys(r.fields), []);
  assert.ok(r.warnings.length >= 2);
});

test('docx text extraction feeds the same parser', async () => {
  const J = loadJC(['shared/config.js', 'shared/profile-schema.js', 'shared/resume-parser.js', 'shared/docx-text.js']);
  const buf = readFileSync(path.join(dir, 'classic-us.docx'));
  const text = await J.docx.extractText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.match(text, /^JANE DOE\n/);
  const v = Object.fromEntries(Object.entries(J.resume.parse(text, { now: NOW }).fields).map(([k, x]) => [k, x.value]));
  assert.equal(v['personal.email'], 'jane.doe@gmail.com');
  assert.equal(v['work.currentTitle'], 'Senior Software Engineer');
  assert.equal(v['work.currentCompany'], 'Stripe');
  assert.equal(v['education.degree'], 'B.S.');
});
