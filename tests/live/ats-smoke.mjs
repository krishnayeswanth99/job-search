// Live smoke test against real public job boards (needs network access to them).
// Never submits: it only detects, extracts, scans and autofills with a dummy profile.
//   node tests/live/ats-smoke.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const ext = new URL('../../extension', import.meta.url).pathname;
const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker'); const id = new URL(sw.url()).host;
const opt = await ctx.newPage(); await opt.goto(`chrome-extension://${id}/options/options.html`);
await opt.evaluate(async () => chrome.storage.local.set({ profile: JC.normalizeProfile({ personal: { firstName: 'Test', lastName: 'Candidate', email: 'test.candidate@example.com', phone: '5550100', city: 'Austin', state: 'TX', country: 'United States' }, links: { linkedin: 'https://www.linkedin.com/in/test-candidate' }, authorization: { authorizedToWork: 'Yes', requiresSponsorship: 'No' }, work: { currentCompany: 'Example Co', currentTitle: 'Engineer' } }), resume: { name: 'test-resume.pdf', type: 'application/pdf', dataBase64: btoa('%PDF-1.4 test') } }));
const out = {};
async function run(name, url, steps) {
  const p = await ctx.newPage(); const r = { url };
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(4000);
    const ok = await p.waitForFunction(() => window.jobCopilot && window.jobCopilot.installed, null, { timeout: 15000 }).then(() => true).catch(() => false);
    r.bridge = ok; if (!ok) { out[name] = r; return p; }
    await steps(p, r);
  } catch (e) { r.error = e.message.split('\n')[0]; }
  out[name] = r; return p;
}
const J = (p, fn, arg) => p.evaluate(fn, arg);
const summJobs = (x) => ({ ok: x.ok, count: x.count, sample: (x.jobs || []).slice(0, 3).map((j) => ({ title: j.title, company: j.company, location: j.location, url: j.url })), error: x.error });
const summJob = (x) => x.job ? { title: x.job.title, company: x.job.company, location: x.job.location, salary: x.job.salary, descChars: (x.job.description || '').length, apply: x.job.apply } : { error: x.error };
const summForm = (x) => ({ application: x.application, count: x.count, fields: (x.fields || []).slice(0, 40).map((f) => `${f.label?.slice(0, 60)} [${f.type}${f.required ? '*' : ''}${f.profileKey ? ' -> ' + f.profileKey : ''}${f.combobox ? ' combobox' : ''}${f.frame && f.frame !== 'top' ? ' iframe' : ''}]`) });
const summFill = (x) => ({ ok: x.ok, error: x.error, filledCount: x.filledCount, filled: (x.filled || []).map((f) => `${f.label?.slice(0, 50)} <- ${f.profileKey || f.source}`), needsInput: (x.needsInput || []).map((f) => `${f.label?.slice(0, 60)} (${f.reason})`).slice(0, 25) });

// Greenhouse
let ghJob;
await run('greenhouse_board', 'https://job-boards.greenhouse.io/anthropic', async (p, r) => {
  r.detect = await J(p, () => jobCopilot.detect()); r.jobs = summJobs(await J(p, () => jobCopilot.extractJobs()));
  ghJob = (r.jobs.sample[0] || {}).url;
});
if (ghJob) await run('greenhouse_job', ghJob, async (p, r) => {
  r.detect = await J(p, () => jobCopilot.detect()); r.job = summJob(await J(p, () => jobCopilot.extractJob()));
  r.form = summForm(await J(p, () => jobCopilot.scanForm())); r.autofill = summFill(await J(p, () => jobCopilot.autofill()));
  r.submitted = /confirmation|thank/i.test(p.url());
});
// Lever
let lvJob;
await run('lever_board', 'https://jobs.lever.co/palantir', async (p, r) => {
  r.detect = await J(p, () => jobCopilot.detect()); r.jobs = summJobs(await J(p, () => jobCopilot.extractJobs())); lvJob = (r.jobs.sample[0] || {}).url;
});
if (lvJob) {
  await run('lever_job', lvJob, async (p, r) => { r.detect = await J(p, () => jobCopilot.detect()); r.job = summJob(await J(p, () => jobCopilot.extractJob())); });
  await run('lever_apply', lvJob.replace(/\/$/, '') + '/apply', async (p, r) => {
    r.detect = await J(p, () => jobCopilot.detect()); r.form = summForm(await J(p, () => jobCopilot.scanForm())); r.autofill = summFill(await J(p, () => jobCopilot.autofill()));
  });
}
// Ashby
let abJob;
await run('ashby_board', 'https://jobs.ashbyhq.com/openai', async (p, r) => {
  r.detect = await J(p, () => jobCopilot.detect()); r.jobs = summJobs(await J(p, () => jobCopilot.extractJobs())); abJob = (r.jobs.sample[0] || {}).url;
});
if (abJob) {
  await run('ashby_job', abJob, async (p, r) => { r.detect = await J(p, () => jobCopilot.detect()); r.job = summJob(await J(p, () => jobCopilot.extractJob())); });
  await run('ashby_apply', abJob.replace(/\/$/, '') + '/application', async (p, r) => {
    r.detect = await J(p, () => jobCopilot.detect()); r.form = summForm(await J(p, () => jobCopilot.scanForm())); r.autofill = summFill(await J(p, () => jobCopilot.autofill()));
  });
}
// Workday
let wdJob;
await run('workday_board', 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite', async (p, r) => {
  await p.waitForTimeout(3000);
  r.detect = await J(p, () => jobCopilot.detect()); r.jobs = summJobs(await J(p, () => jobCopilot.extractJobs())); wdJob = (r.jobs.sample[0] || {}).url;
});
if (wdJob) await run('workday_job', wdJob, async (p, r) => { await p.waitForTimeout(3000); r.detect = await J(p, () => jobCopilot.detect()); r.job = summJob(await J(p, () => jobCopilot.extractJob())); });
console.log(JSON.stringify(out, null, 1));
await ctx.close();
