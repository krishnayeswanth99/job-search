// End-to-end test: loads the unpacked extension into Chromium and exercises it
// against fixture pages served at real portal hostnames (via request routing).
//   node tests/e2e/run.mjs            (headless)
//   HEADED=1 node tests/e2e/run.mjs   (watch it)
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// createRequire also honours NODE_PATH / globally installed playwright.
const { chromium } = createRequire(import.meta.url)('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(here, '../../extension');
const fx = (f) => readFileSync(path.join(here, 'fixtures', f), 'utf8');

const ROUTES = {
  'https://job-boards.greenhouse.io/acme/jobs/123': fx('greenhouse-job.html'),
  'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=123': fx('greenhouse-job.html'),
  'https://jobs.lever.co/acme': fx('lever-list.html'),
  'https://www.linkedin.com/jobs/search/?keywords=engineer': fx('linkedin-search.html'),
  'https://acme.wd5.myworkdayjobs.com/en-US/careers/login': fx('workday-login.html'),
  'https://evil.example.com/apply': fx('untrusted-form.html'),
  'https://www.acme-robotics.com/careers': fx('company-embed.html'),
  'https://job-boards.greenhouse.io/globex/jobs/77': fx('greenhouse-job.html'),
  'https://job-boards.greenhouse.io/acme/jobs/124': fx('greenhouse-job.html'),
  'https://www.linkedin.com/jobs/view/4000000009/': fx('linkedin-external.html'),
  'https://job-boards.greenhouse.io/acme/jobs/123?gh_src=linkedin': fx('greenhouse-job.html'),
  'https://www.indeed.com/applystart?jk=abc&url=https%3A%2F%2Fjob-boards.greenhouse.io%2Facme%2Fjobs%2F123': fx('indeed-applystart.html'),
  'https://jobright.ai/jobs/info/abc123': fx('jobright-job.html'),
  'https://jobs.lever.co/acme/11111111-1111-1111-1111-111111111111/apply': '<html><body><form id="application-form"><label>Full name<input name="name"></label><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label><label>Resume/CV<input type="file" name="resume"></label></form></body></html>',
};

const PROFILE = {
  personal: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '+1 555 0100', city: 'London', country: 'United Kingdom' },
  links: { linkedin: 'https://www.linkedin.com/in/ada' },
  authorization: { authorizedToWork: 'Yes', requiresSponsorship: 'No' },
  work: { desiredSalary: '$175,000', desiredHourlyRate: '85' },
  answers: [{ question: 'Why do you want to work at Acme?', answer: 'I love robots.' }],
};

// Tiny local file server for attachFile({ url }).
const server = createServer((req, res) => {
  if (req.url === '/tailored-resume.pdf') {
    res.writeHead(200, { 'content-type': 'application/pdf' });
    return res.end('%PDF-1.4 tailored');
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const filePort = server.address().port;

const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'jc-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: !process.env.HEADED,
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').join('\n       ')}`);
  }
}

try {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (!/^https?:/.test(url) || url.startsWith('http://127.0.0.1')) return route.continue();
    const body = ROUTES[url];
    if (body) return route.fulfill({ status: 200, contentType: 'text/html', body });
    return route.fulfill({ status: 404, body: '' });
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;

  // Seed profile + a stored resume through an extension page.
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extId}/options/options.html`);
  await ext.evaluate(async (profile) => {
    await chrome.storage.local.set({
      profile: globalThis.JC.normalizeProfile(profile),
      resume: { name: 'ada-resume.pdf', type: 'application/pdf', dataBase64: btoa('%PDF-1.4 base') },
    });
  }, PROFILE);

  // Runs a command the way the popup does (origin = popup).
  const popupCmd = async (page, cmd, payload) => {
    const tabId = await ext.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0)?.id, page.url());
    return ext.evaluate(({ tabId, cmd, payload }) => chrome.runtime.sendMessage({ type: 'jc:popup', tabId, cmd, payload }), { tabId, cmd, payload });
  };
  const bridge = (page, expr) => page.evaluate(expr);
  const open = async (url) => {
    const p = await context.newPage();
    await p.goto(url);
    await p.waitForFunction(() => window.jobCopilot && window.jobCopilot.installed, null, { timeout: 10000 });
    return p;
  };

  console.log('Job Copilot e2e');

  const gh = await open('https://job-boards.greenhouse.io/acme/jobs/123');
  await check('bridge: detect greenhouse application', async () => {
    const d = await bridge(gh, () => window.jobCopilot.detect());
    assert.equal(d.portal, 'greenhouse');
    assert.equal(d.pageType, 'application');
    assert.equal(d.login.required, false);
  });
  await check('bridge: extractJob merges DOM + JSON-LD', async () => {
    const r = await bridge(gh, () => window.jobCopilot.extractJob());
    assert.equal(r.job.title, 'Senior Software Engineer');
    assert.equal(r.job.company, 'Acme Robotics');
    assert.match(r.job.salary, /180000/);
    assert.match(r.job.description, /Kubernetes/);
    assert.equal(r.job.apply.text, 'Submit Application');
  });
  await check('bridge: scanForm lists fields with selectors, no profile values', async () => {
    const r = await bridge(gh, () => window.jobCopilot.scanForm());
    assert.ok(r.application);
    const byLabel = Object.fromEntries(r.fields.map((f) => [f.label, f]));
    assert.equal(byLabel['First Name'].profileKey, 'firstName');
    assert.equal(byLabel['Resume/CV'].type, 'file');
    assert.ok(byLabel['Veteran Status'].options.length === 3);
    assert.ok(!JSON.stringify(r).includes('ada@example.com'));
  });
  await check('bridge: autofill fills profile fields, saved answers, resume; leaves custom + consent', async () => {
    const r = await bridge(gh, () => window.jobCopilot.autofill());
    assert.equal(r.ok, true, r.error);
    const vals = await gh.evaluate(() => ({
      fn: first_name.value, ln: last_name.value, em: email.value, li: q1.value, auth: q2.selectedOptions[0].text, spon: q3.selectedOptions[0].text,
      why: q4.value, robot: q5.value, gender: gender.selectedOptions[0].text, vet: document.querySelector('input[name=veteran]:checked')?.value,
      consent: consent.checked, resume: resume.files[0]?.name, events: window.__events, submitted: !!window.__submitted,
    }));
    assert.deepEqual(
      { fn: vals.fn, ln: vals.ln, em: vals.em, li: vals.li, auth: vals.auth, spon: vals.spon, why: vals.why, gender: vals.gender, vet: vals.vet, resume: vals.resume },
      { fn: 'Ada', ln: 'Lovelace', em: 'ada@example.com', li: 'https://www.linkedin.com/in/ada', auth: 'Yes', spon: 'No', why: 'I love robots.', gender: 'Decline To Self Identify', vet: '3', resume: 'ada-resume.pdf' }
    );
    assert.equal(vals.robot, '');
    assert.equal(vals.consent, false);
    assert.equal(vals.submitted, false);
    assert.ok(vals.events > 5, 'input events dispatched');
    const needs = r.needsInput.map((f) => f.label);
    assert.ok(needs.includes('What is your favorite robot?'), JSON.stringify(needs));
    assert.ok(needs.some((l) => /privacy policy/.test(l)));
  });
  await check('autofill: annual vs hourly pay, ranges, ambiguous pay left for the user', async () => {
    const v = await gh.evaluate(() => ({ sal: sal.value, rate: rate.value, band: payband.selectedOptions[0].text, pay: pay.value, cur: cur.value }));
    assert.deepEqual(v, { sal: '175000', rate: '85', band: '$150,001 - $200,000', pay: '', cur: '' });
    const r = await bridge(gh, () => window.jobCopilot.last);
    const amb = r.needsInput.find((f) => f.label === 'What is your desired pay?');
    assert.ok(amb, 'ambiguous pay reported');
    assert.equal(amb.payPeriod, 'unknown');
    assert.match(amb.reason, /hourly or annual/);
  });
  await check('bridge: fillField answers a custom question', async () => {
    const r = await bridge(gh, () => window.jobCopilot.fillField({ label: 'What is your favorite robot?', value: 'Curiosity rover' }));
    assert.equal(r.ok, true, r.error);
    assert.equal(await gh.evaluate(() => q5.value), 'Curiosity rover');
  });
  await check('answer memory: new answers remembered on Submit, reused next time (company-specific only for that company)', async () => {
    await gh.fill('#q6', 'Your robots are the best.');
    await gh.click('#submit');
    await gh.waitForTimeout(800);
    const answers = await ext.evaluate(async () => (await chrome.storage.local.get('profile')).profile.answers);
    const robot = answers.find((a) => a.question === 'What is your favorite robot?');
    const excite = answers.find((a) => a.question === 'What excites you about joining us?');
    assert.deepEqual([robot && robot.answer, robot && robot.scope, robot && robot.source], ['Curiosity rover', 'any', 'remembered']);
    assert.deepEqual([excite && excite.scope, excite && excite.company], ['company', 'acme']);
    assert.ok(!answers.some((a) => /email|phone|first name|salary|gender|veteran/i.test(a.question)), JSON.stringify(answers.map((a) => a.question)));
    assert.equal(answers.filter((a) => a.question === 'Why do you want to work at Acme?').length, 1, 'manual answer not duplicated');

    const other = await open('https://job-boards.greenhouse.io/globex/jobs/77');
    await bridge(other, () => window.jobCopilot.autofill());
    assert.deepEqual(await other.evaluate(() => [q5.value, q6.value]), ['Curiosity rover', '']);
    const again = await open('https://job-boards.greenhouse.io/acme/jobs/124');
    await bridge(again, () => window.jobCopilot.autofill());
    assert.deepEqual(await again.evaluate(() => [q5.value, q6.value]), ['Curiosity rover', 'Your robots are the best.']);
  });
  await check('bridge: attachFile from localhost replaces resume', async () => {
    const r = await gh.evaluate((port) => window.jobCopilot.attachFile({ kind: 'resume', url: `http://127.0.0.1:${port}/tailored-resume.pdf` }), filePort);
    assert.equal(r.ok, true, r.error);
    assert.equal(await gh.evaluate(() => resume.files[0].name), 'tailored-resume.pdf');
  });
  await check('bridge: attachFile refuses non-local URLs', async () => {
    const r = await bridge(gh, () => window.jobCopilot.attachFile({ kind: 'resume', url: 'https://attacker.example/x.pdf' }));
    assert.equal(r.ok, false);
  });
  await check('bridge: last result mirrored for non-awaiting tools', async () => {
    await bridge(gh, () => {
      window.jobCopilot.ping();
    });
    await gh.waitForFunction(() => window.jobCopilot.last && window.jobCopilot.last.version);
  });

  const lever = await open('https://jobs.lever.co/acme');
  await check('lever: extract listings', async () => {
    const r = await bridge(lever, () => window.jobCopilot.extractJobs());
    assert.equal(r.count, 3);
    assert.deepEqual(r.jobs.map((j) => j.title), ['Backend Engineer', 'Data Scientist', 'Product Designer']);
    assert.equal(r.jobs[0].location, 'Remote - US');
    assert.equal(r.jobs[0].remote, true);
  });

  const li = await open('https://www.linkedin.com/jobs/search/?keywords=engineer');
  await check('linkedin: extract cards + open job panel', async () => {
    const r = await bridge(li, () => window.jobCopilot.extractJobs());
    assert.equal(r.count, 2);
    assert.equal(r.jobs[0].title, 'Machine Learning Engineer');
    assert.equal(r.jobs[0].company, 'Globex');
    assert.equal(r.jobs[0].easyApply, true);
    assert.equal(r.jobs[0].url, 'https://www.linkedin.com/jobs/view/4000000001/');
    const j = await bridge(li, () => window.jobCopilot.extractJob());
    assert.equal(j.job.title, 'Machine Learning Engineer');
    assert.equal(j.job.easyApply, true);
  });

  const wd = await open('https://acme.wd5.myworkdayjobs.com/en-US/careers/login');
  await check('workday: login wall detected', async () => {
    const d = await bridge(wd, () => window.jobCopilot.detect());
    assert.equal(d.login.required, true);
    assert.equal(d.login.kind, 'signin');
    assert.ok(d.login.providers.includes('google'));
  });

  const evil = await open('https://evil.example.com/apply');
  await check('untrusted site: bridge autofill refused', async () => {
    const r = await bridge(evil, () => window.jobCopilot.autofill());
    assert.equal(r.ok, false);
    assert.match(r.error, /not a trusted job site/);
    assert.equal(await evil.evaluate(() => fn.value), '');
  });
  await check('untrusted site: forged _origin in payload is ignored', async () => {
    const r = await bridge(evil, () => window.jobCopilot.autofill({ _origin: 'popup' }));
    assert.equal(r.ok, false);
  });
  await check('untrusted site: popup autofill (user click) works', async () => {
    const r = await popupCmd(evil, 'autofill');
    assert.equal(r.ok, true, r.error);
    assert.equal(await evil.evaluate(() => fn.value + ' ' + em.value), 'Ada ada@example.com');
  });

  const embed = await open('https://www.acme-robotics.com/careers');
  await check('iframe embed: detect + autofill reach the Greenhouse frame', async () => {
    await embed.waitForTimeout(500);
    const d = await bridge(embed, () => window.jobCopilot.detect());
    assert.equal(d.pageType, 'application');
    assert.match(d.applicationFrame, /greenhouse/);
    const r = await bridge(embed, () => window.jobCopilot.autofill());
    assert.equal(r.ok, true, r.error);
    assert.ok(r.filledCount >= 8, `filled ${r.filledCount}`);
    const frame = embed.frames().find((f) => f.url().includes('greenhouse'));
    assert.equal(await frame.evaluate(() => first_name.value), 'Ada');
  });

  // ---- resume upload -> parse -> review -> edit -> save (options page)
  const resumeTxt = readFileSync(path.join(here, '../fixtures/resumes/classic-us.txt'), 'utf8');
  const resumeHtml = '<html><body style="font:12px Arial;width:7in">' + resumeTxt.split('\n').map((l) => {
    const [a, b] = l.split(/\s{4,}/);
    const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return b ? `<div style="display:flex;justify-content:space-between"><span>${esc(a)}</span><span>${esc(b)}</span></div>` : `<div>${esc(l) || '&nbsp;'}</div>`;
  }).join('') + '</body></html>';
  const pdfBrowser = await chromium.launch();
  const pdfPage = await pdfBrowser.newPage();
  await pdfPage.setContent(resumeHtml);
  const resumePdf = await pdfPage.pdf({ format: 'Letter' });
  await pdfBrowser.close();

  const readReview = (page) => page.$$eval('.review-row', (rows) => Object.fromEntries(rows.map((r) => [r.querySelector('.review-label').firstChild.textContent.trim(), { value: r.querySelector('input:not([type=checkbox]), textarea').value, checked: r.querySelector('input[type=checkbox]').checked }])));

  await check('options: uploading a PDF resume suggests profile fields for review', async () => {
    const errors = [];
    const opt = await context.newPage();
    opt.on('pageerror', (e) => errors.push(e.message));
    opt.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await opt.goto(`chrome-extension://${extId}/options/options.html`);
    await opt.evaluate(async () => {
      const p = globalThis.JC.emptyProfile();
      p.personal.firstName = 'Janet'; // user-entered value must not be overwritten by default
      await chrome.storage.local.set({ profile: p });
    });
    await opt.reload();
    await opt.setInputFiles('#resume-file', { name: 'jane-doe.pdf', mimeType: 'application/pdf', buffer: resumePdf });
    await opt.waitForSelector('.review-row', { timeout: 15000 });
    const rv = await readReview(opt);
    assert.ok(!/\bnull\b/.test(await opt.textContent('#resume-review')), 'no stray "null" text');
    assert.deepEqual(rv['Email'], { value: 'jane.doe@gmail.com', checked: true });
    assert.deepEqual(rv['First name'], { value: 'Jane', checked: false });
    assert.equal(rv['Current / most recent title'].value, 'Senior Software Engineer');
    assert.equal(rv['Current / most recent company'].value, 'Stripe');
    assert.equal(rv['LinkedIn URL'].value, 'https://www.linkedin.com/in/janedoe');
    assert.equal(rv['Degree (e.g. Bachelor of Science)'].value, 'B.S.');
    assert.match(rv['Key skills (comma-separated)'].value, /Kubernetes/);

    // Edit a suggestion, then save.
    const titleRow = opt.locator('.review-row', { hasText: 'Current / most recent title' });
    await titleRow.locator('input:not([type=checkbox])').fill('Staff Software Engineer');
    await opt.getByRole('button', { name: 'Save selected to profile' }).click();
    await opt.waitForSelector('.review .ok');
    const saved = await opt.evaluate(async () => (await chrome.storage.local.get(['profile', 'resume'])));
    assert.equal(saved.profile.work.currentTitle, 'Staff Software Engineer');
    assert.equal(saved.profile.personal.email, 'jane.doe@gmail.com');
    assert.equal(saved.profile.personal.firstName, 'Janet');
    assert.equal(saved.resume.name, 'jane-doe.pdf');
    // The editable profile form shows the saved values.
    assert.equal(await opt.inputValue('input[data-section="work"][data-key="currentTitle"]'), 'Staff Software Engineer');
    assert.deepEqual(errors, []);
  });

  await check('options: DOCX resume is read too', async () => {
    const opt = await context.newPage();
    await opt.goto(`chrome-extension://${extId}/options/options.html`);
    await opt.setInputFiles('#resume-file', path.join(here, '../fixtures/resumes/classic-us.docx'));
    await opt.waitForSelector('.review-row', { timeout: 15000 });
    const rv = await readReview(opt);
    assert.equal(rv['Email'].value, 'jane.doe@gmail.com');
    assert.equal(rv['Current / most recent company'].value, 'Stripe');
  });

  // ---- "Read with Claude": the Claude API is mocked; we check what is sent and how replies/errors are handled.
  const claudeCalls = [];
  let claudeReply = null;
  await context.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    claudeCalls.push({ url: req.url(), headers: await req.allHeaders(), body: req.postDataJSON() });
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill(Object.assign({ contentType: 'application/json', headers: Object.assign({ 'request-id': 'req_test' }, cors) }, claudeReply));
  });
  const claudeJson = {
    personal: { firstName: 'Jane', lastName: 'Doe', email: 'jane.doe@gmail.com', phone: '(415) 555-0134', phoneCountryCode: '', address1: '', city: 'San Francisco', state: 'CA', postalCode: '94105', country: 'United States' },
    links: { linkedin: 'https://www.linkedin.com/in/janedoe', github: 'https://github.com/janedoe', portfolio: '', website: 'https://janedoe.dev', twitter: '' },
    work: { currentTitle: 'Senior Software Engineer', currentCompany: 'Stripe', yearsExperience: '7', skills: 'Go, Python, Kubernetes' },
    education: { school: 'University of California, Berkeley', degree: 'B.S.', fieldOfStudy: 'Computer Science', graduationYear: '2017', gpa: '3.8/4.0' },
    summary: 'Backend engineer with 7 years building distributed systems.',
    notes: ['Years of experience exclude the 2016 internship.'],
  };
  const okReply = (json) => ({ status: 200, body: JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: JSON.stringify(json) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 300 } }) });
  const setClaude = (v) => ext.evaluate((v) => chrome.storage.local.set({ claudeApi: v }), v);

  await check('Claude: reads the PDF via the API and shows results for review', async () => {
    await setClaude({ apiKey: 'sk-ant-test-0000', model: 'claude-haiku-5-5', autoRead: false });
    claudeReply = okReply(claudeJson);
    claudeCalls.length = 0;
    const opt = await context.newPage();
    const errors = [];
    opt.on('pageerror', (e) => errors.push(e.message));
    await opt.goto(`chrome-extension://${extId}/options/options.html`);
    await opt.setInputFiles('#resume-file', { name: 'jane-doe.pdf', mimeType: 'application/pdf', buffer: resumePdf });
    await opt.waitForSelector('.review-row');
    assert.equal(claudeCalls.length, 0, 'autoRead off: nothing sent on upload');
    await opt.click('#resume-claude');
    await opt.waitForSelector('.review h3:has-text("read by Claude Haiku 5.5")', { timeout: 15000 });
    const call = claudeCalls.find((c) => c.body);
    assert.ok(call, 'request sent');
    assert.match(call.url, /\/v1\/messages$/);
    // SDK 1.x (API version 2026-10-21) sends the key as a bearer token; older versions used x-api-key.
    assert.ok(call.headers['authorization'] === 'Bearer sk-ant-test-0000' || call.headers['x-api-key'] === 'sk-ant-test-0000', 'API key sent');
    assert.equal(call.headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.equal(call.body.model, 'claude-haiku-5-5');
    assert.equal(call.body.output_config.format.type, 'json_schema');
    assert.equal(call.body.output_config.effort, 'low');
    assert.equal(call.body.messages[0].content[0].type, 'document');
    assert.equal(call.body.messages[0].content[0].source.media_type, 'application/pdf');
    assert.ok(!('fallbacks' in call.body), 'Haiku: no fallbacks param');
    const rv = await readReview(opt);
    assert.equal(rv['Years of experience'].value, '7');
    assert.equal(rv['School / university'].value, 'University of California, Berkeley');
    assert.match(await opt.textContent('#resume-review'), /exclude the 2016 internship/);
    assert.match(await opt.textContent('#resume-review'), /from Claude/);
    assert.deepEqual(errors, []);
  });

  await check('Claude: auto-read on upload, Sonnet sends server-side fallback', async () => {
    await setClaude({ apiKey: 'sk-ant-test-0000', model: 'claude-sonnet-5-5', autoRead: true });
    claudeReply = okReply(claudeJson);
    claudeCalls.length = 0;
    const opt = await context.newPage();
    await opt.goto(`chrome-extension://${extId}/options/options.html`);
    await opt.setInputFiles('#resume-file', path.join(here, '../fixtures/resumes/classic-us.docx'));
    await opt.waitForSelector('.review h3:has-text("read by Claude Sonnet 5.5")', { timeout: 15000 });
    const call = claudeCalls.find((c) => c.body);
    assert.equal(call.body.model, 'claude-sonnet-5-5');
    assert.equal(call.body.fallbacks, 'default');
    assert.match(call.headers['anthropic-beta'] || '', /server-side-fallback-2026-07-01/);
    assert.equal(call.body.messages[0].content[0].type, 'text', 'DOCX goes as extracted text');
    assert.match(call.body.messages[0].content[0].text, /<resume>\nJANE DOE/);
  });

  await check('Claude: bad key falls back to the built-in reader with a clear message', async () => {
    await setClaude({ apiKey: 'sk-ant-bad', model: 'claude-haiku-5-5', autoRead: true });
    claudeReply = { status: 401, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) };
    const opt = await context.newPage();
    await opt.goto(`chrome-extension://${extId}/options/options.html`);
    await opt.setInputFiles('#resume-file', { name: 'jane-doe.pdf', mimeType: 'application/pdf', buffer: resumePdf });
    await opt.waitForSelector('.review-row', { timeout: 20000 });
    const txt = await opt.textContent('#resume-review');
    assert.match(txt, /API key was rejected/);
    assert.match(txt, /built-in reader/);
    assert.equal((await readReview(opt))['Email'].value, 'jane.doe@gmail.com');
    await setClaude({ apiKey: '', model: 'claude-haiku-5-5', autoRead: false });
  });

  // ---- From job boards / aggregators to the real application
  await check('LinkedIn external Apply: detected, click opens new tab, reported in openedTabs', async () => {
    await ext.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: Object.assign({}, settings, { bridgeEnabled: true }) });
    });
    const p = await open('https://www.linkedin.com/jobs/view/4000000009/');
    const d = await bridge(p, () => window.jobCopilot.detect());
    assert.equal(d.apply.kind, 'external');
    assert.equal(d.apply.newTab, true);
    const f = await bridge(p, () => window.jobCopilot.followApply());
    assert.equal(f.ok, false, 'scripted button: cannot navigate same tab');
    const [child] = await Promise.all([context.waitForEvent('page'), p.click(d.apply.selector)]);
    await child.waitForLoadState('domcontentloaded');
    await p.waitForTimeout(300);
    const d2 = await bridge(p, () => window.jobCopilot.detect());
    assert.ok(d2.openedTabs && d2.openedTabs.some((t) => /greenhouse\.io\/acme\/jobs\/123/.test(t.url)), JSON.stringify(d2.openedTabs));
  });

  await check('Indeed redirect + "leaving Indeed" screen: followApply lands on the ATS form', async () => {
    const p = await open('https://www.indeed.com/applystart?jk=abc&url=https%3A%2F%2Fjob-boards.greenhouse.io%2Facme%2Fjobs%2F123');
    const d = await bridge(p, () => window.jobCopilot.detect());
    assert.equal(d.pageType, 'redirect');
    assert.equal(d.redirect.target, 'https://job-boards.greenhouse.io/acme/jobs/123');
    assert.equal(d.interstitial.button, 'Continue');
    const f = await bridge(p, () => window.jobCopilot.followApply());
    assert.equal(f.ok, true);
    await p.waitForURL('https://job-boards.greenhouse.io/acme/jobs/123');
    await p.waitForFunction(() => window.jobCopilot && window.jobCopilot.installed);
    assert.equal((await bridge(p, () => window.jobCopilot.detect())).pageType, 'application');
  });

  await check('Jobright-style aggregator: unwraps redirect link, same-tab follow, "Did you apply?" prompt', async () => {
    const p = await open('https://jobright.ai/jobs/info/abc123');
    const d = await bridge(p, () => window.jobCopilot.detect());
    assert.equal(d.portal, 'jobright');
    assert.equal(d.apply.kind, 'external');
    assert.equal(d.apply.target, 'https://jobs.lever.co/acme/11111111-1111-1111-1111-111111111111/apply');
    assert.equal(d.appliedPrompt.yes, 'Yes, I applied');
    assert.equal(d.appliedPrompt.no, 'No, not yet');
    // Dismiss the prompt the honest way (not applied yet), then follow.
    await p.click(d.appliedPrompt.noSelector);
    await p.evaluate(() => document.getElementById('did').remove());
    const f = await bridge(p, () => window.jobCopilot.followApply());
    assert.equal(f.ok, true);
    await p.waitForURL('**/jobs.lever.co/acme/**/apply');
    await p.waitForFunction(() => window.jobCopilot && window.jobCopilot.installed);
    assert.equal((await bridge(p, () => window.jobCopilot.detect())).pageType, 'application');
  });

  await check('bridge disabled: commands refused', async () => {
    await ext.evaluate(async () => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: Object.assign({}, settings, { bridgeEnabled: false }) });
    });
    const r = await bridge(lever, () => window.jobCopilot.extractJobs());
    assert.equal(r.ok, false);
    assert.match(r.error, /disabled/);
  });

  await check('popup renders without errors', async () => {
    const errors = [];
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`chrome-extension://${extId}/popup/popup.html`);
    await p.waitForTimeout(500);
    assert.deepEqual(errors, []);
  });
} finally {
  await context.close();
  server.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
