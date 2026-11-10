import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension/src');
const sandbox = { console, URL, URLSearchParams, location: { hostname: 'jobright.ai', href: 'https://jobright.ai/jobs/recommend' } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['shared/config.js', 'content/apply-links.js']) vm.runInContext(readFileSync(path.join(src, f), 'utf8'), sandbox);
const findIn = (t) => {
  const r = sandbox.JC.applyLinks.findIn(t);
  return r && { url: r.url, via: r.via };
};

test('employer URL in embedded page data (escaped JSON)', () => {
  const html = '<script id="__NEXT_DATA__" type="application/json">{"job":{"logo":"https://jobright.ai/x.png","originalUrl":"https:\\u002F\\u002Fboards.greenhouse.io\\u002Facme\\u002Fjobs\\u002F55"}}</script>';
  assert.deepEqual(findIn(html), { url: 'https://boards.greenhouse.io/acme/jobs/55', via: 'page-data' });
});

test('redirect link on the page is unwrapped to the ATS', () => {
  assert.deepEqual(findIn('<a href="https://jobright.ai/redirect?url=https%3A%2F%2Fjobs.lever.co%2Facme%2Fabc&amp;src=x">Apply</a>'), { url: 'https://jobs.lever.co/acme/abc', via: 'page-link' });
});

test('company careers page from an apply field; own-site links ignored', () => {
  assert.deepEqual(findIn('{"applyLink":"https://careers.acme.com/jobs/77"}'), { url: 'https://careers.acme.com/jobs/77', via: 'page-data' });
  assert.equal(findIn('<a href="https://jobright.ai/jobs/info/1">x</a> {"jobUrl":"https://jobright.ai/jobs/info/1"}'), null);
});

test('prefers an ATS link over a generic external field', () => {
  const t = '{"sourceUrl":"https://www.linkedin.com/jobs/view/1"} <a href="https://acme.wd5.myworkdayjobs.com/en-US/careers/job/X_1">';
  assert.equal(findIn(t).url, 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/X_1');
});
