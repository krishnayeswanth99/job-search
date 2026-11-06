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
};

const PROFILE = {
  personal: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '+1 555 0100', city: 'London', country: 'United Kingdom' },
  links: { linkedin: 'https://www.linkedin.com/in/ada' },
  authorization: { authorizedToWork: 'Yes', requiresSponsorship: 'No' },
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
  await check('bridge: fillField answers a custom question', async () => {
    const r = await bridge(gh, () => window.jobCopilot.fillField({ label: 'What is your favorite robot?', value: 'Curiosity rover' }));
    assert.equal(r.ok, true, r.error);
    assert.equal(await gh.evaluate(() => q5.value), 'Curiosity rover');
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
