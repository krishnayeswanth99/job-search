/* Job Copilot popup. All page data is rendered with textContent (never innerHTML). */
const $ = (id) => document.getElementById(id);
let tabId = null;
let lastPayload = null;
let lastJobs = [];
let detected = null; // last detect() result for this tab
const isAggregator = () => !!(detected && detected.portal && ((globalThis.JC.PORTALS.find((p) => p.id === detected.portal) || {}).aggregator));

function send(cmd, payload) {
  return chrome.runtime.sendMessage({ type: 'jc:popup', tabId, cmd, payload: payload || {} });
}

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}

function showResult(title, body, payload, jobs) {
  $('result').hidden = false;
  $('result-title').textContent = title;
  $('result-body').replaceChildren(body);
  lastPayload = payload;
  lastJobs = jobs || [];
  $('btn-save-all').hidden = !lastJobs.length;
  $('btn-more').hidden = !(payload && payload.jobs);
  $('btn-links').hidden = !(payload && payload.jobs && payload.jobs.length);
}

async function savedJobs() {
  const { savedJobs } = await chrome.storage.local.get('savedJobs');
  return savedJobs || [];
}

async function saveJobs(jobs) {
  const list = await savedJobs();
  const keys = new Set(list.map((j) => j.url || j.title + j.company));
  let added = 0;
  for (const j of jobs) {
    const k = j.url || j.title + j.company;
    if (keys.has(k)) continue;
    keys.add(k);
    const copy = Object.assign({}, j, { savedAt: new Date().toISOString(), status: 'saved' });
    delete copy.description;
    list.push(copy);
    added++;
  }
  await chrome.storage.local.set({ savedJobs: list });
  await refreshSavedCount();
  return added;
}

async function refreshSavedCount() {
  const n = (await savedJobs()).length;
  $('saved-count').textContent = n ? `${n} saved job${n === 1 ? '' : 's'}` : '';
}

function jobRow(j) {
  const sub = [j.company, j.location, j.salary, j.postedAt].filter(Boolean).join(' · ');
  const saveBtn = el('button', { class: 'small', onclick: async (e) => {
    const n = await saveJobs([j]);
    e.target.textContent = n ? 'Saved' : 'Already saved';
    e.target.disabled = true;
  } }, 'Save');
  return el('div', { class: 'job' },
    el('div', { class: 'meta' },
      j.url ? el('a', { class: 'title', href: j.url, target: '_blank', rel: 'noopener' }, j.title) : el('span', { class: 'title' }, j.title),
      el('span', { class: 'sub' }, sub, j.appliedAt || j.status === 'applied' ? el('span', { class: 'pill applied' }, `✓ Applied${j.appliedAt ? ' ' + new Date(j.appliedAt).toLocaleDateString() : ''}`) : null, j.easyApply ? el('span', { class: 'pill' }, 'Easy Apply') : null, j.remote ? el('span', { class: 'pill' }, 'Remote') : null),
      j.applyUrl ? el('a', { class: 'sub apply-link', href: j.applyUrl, target: '_blank', rel: 'noopener' }, `Apply on ${j.applyHost || 'employer site'} ↗`) : j.applyError ? el('span', { class: 'sub muted' }, 'No employer link found') : null
    ),
    saveBtn
  );
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab && tab.id;
  document.querySelectorAll('#open-options, [data-open-options]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  }));

  const { profile } = await chrome.storage.local.get('profile');
  $('profile-banner').hidden = !!profile;
  refreshSavedCount();

  if (!tab || !/^https?:/.test(tab.url || '')) {
    $('portal').textContent = 'Not a web page';
    $('page-type').textContent = '—';
    document.querySelectorAll('.actions button').forEach((b) => (b.disabled = true));
    return;
  }

  const d = await send('detect');
  detected = d;
  if (!d || d.ok === false) {
    $('portal').textContent = new URL(tab.url).hostname;
    $('page-type').textContent = (d && d.error) || 'Reload the tab to activate Job Copilot';
    return;
  }
  $('portal').textContent = d.portalName || new URL(d.url).hostname;
  const labels = { listings: `Job listings (${d.jobCount || 0})`, job: 'Job posting', application: 'Application form', unknown: d.jobCount ? `Page with ${d.jobCount} job links` : 'No jobs detected' };
  $('page-type').textContent = labels[d.pageType] || d.pageType;
  if (d.login && d.login.required) {
    $('login-banner').hidden = false;
    $('login-banner').textContent = `This page needs you to ${d.login.kind === 'signup' ? 'create an account' : 'sign in'}${d.login.providers.length ? ` (options: ${d.login.providers.join(', ')})` : ''}. Do that in the tab, then reopen this popup.`;
  }
  if (d.pageType !== 'application') $('btn-autofill').classList.remove('primary');
  // Job boards / aggregators: offer to jump to the employer's application.
  const ext = d.apply && d.apply.kind === 'external';
  if (d.redirect || d.interstitial || ext) {
    $('btn-follow').hidden = false;
    $('btn-follow').classList.add('primary');
    $('btn-follow').textContent = d.interstitial ? `Continue: ${d.interstitial.button}` : ext && d.apply.target ? `Go to application (${new URL(d.apply.target).hostname})` : 'Go to application';
  }
  if (d.application) {
    refreshAsk();
    $('btn-next').hidden = false;
  }
  if (isAggregator()) {
    $('btn-queue').hidden = false;
    refreshQueue();
  }
  if (d.apply && d.apply.kind === 'easy-apply') $('page-type').textContent += ` · ${d.apply.text} (on-site)`;
  if (d.pageType === 'listings' || d.jobCount) $('btn-jobs').classList.add('primary');
}

$('btn-follow').addEventListener('click', async () => {
  $('btn-follow').disabled = true;
  $('btn-follow').textContent = 'Opening the application… (waiting for the site)';
  // On job boards/aggregators open the employer's site in a new tab and keep the feed.
  const r = await send('followApply', isAggregator() ? { newTab: true } : {});
  $('btn-follow').disabled = false;
  $('btn-follow').textContent = 'Go to application';
  if (r && r.ok) return window.close();
  showResult('Open the application', el('p', {}, (r && r.reason) || 'Click the Apply button on the page.'), r);
});

$('btn-next').addEventListener('click', async () => {
  const r = await send('nextStep');
  if (r && r.ok) return showResult('Next step', el('p', {}, `Clicked "${r.clicked}". The next page will be autofilled when it loads (or click Autofill).`), r);
  showResult(r && r.submit ? 'Last step' : 'No Next button', el('p', {}, (r && r.reason) || 'No Next button found.'), r);
});

$('btn-autofill').addEventListener('click', async () => {
  $('btn-autofill').disabled = true;
  const r = await send('autofill');
  $('btn-autofill').disabled = false;
  if (!r || r.ok === false) return showResult('Autofill failed', el('p', {}, (r && r.error) || 'Unknown error'), r);
  const body = el('div', {},
    el('p', { class: 'ok' }, `Filled ${r.filledCount} field${r.filledCount === 1 ? '' : 's'}.`),
    r.corrected && r.corrected.length ? el('p', {}, `Corrected what the site's resume reader filled in: ${r.corrected.map((c) => c.label).join(', ')}. These stay as in your profile while you review (unless you edit them).`) : null,
    r.needsInput.length ? el('div', {}, el('strong', {}, `Needs your input (${r.needsInput.length}):`), el('ul', { class: 'plain' }, r.needsInput.map((f) => el('li', {}, f.label || '(unlabelled)', f.required ? ' *' : '', el('span', { class: 'muted' }, ` — ${f.reason}`))))) : null,
    el('p', { class: 'muted' }, 'Review everything before you submit. Ask Claude to answer the custom questions.')
  );
  showResult('Autofill', body, r);
});

$('btn-jobs').addEventListener('click', async () => {
  const r = await send('extractJobs');
  if (!r || r.ok === false) return showResult('No jobs found', el('p', {}, (r && r.error) || ''), r);
  if (!r.jobs.length) return showResult('No jobs found', el('p', {}, 'Scroll to load results, or open a search results page.'), r);
  showResult(`${r.jobs.length} jobs on this tab`, el('div', {}, r.jobs.map(jobRow)), r, r.jobs);
});

$('btn-job').addEventListener('click', async () => {
  const r = await send('extractJob');
  if (!r || r.ok === false) return showResult('No job posting', el('p', {}, (r && r.error) || ''), r);
  const j = r.job;
  const body = el('div', {}, jobRow(j), j.apply ? el('p', {}, 'Apply button: ', el('strong', {}, j.apply.text)) : null, el('pre', {}, (j.description || '').slice(0, 1500)));
  showResult('Job posting', body, r, [j]);
});

$('btn-copy').addEventListener('click', async () => {
  if (!lastPayload) return;
  await navigator.clipboard.writeText(JSON.stringify(lastPayload, null, 2));
  $('btn-copy').textContent = 'Copied';
  setTimeout(() => ($('btn-copy').textContent = 'Copy for Claude'), 1200);
});

$('btn-more').addEventListener('click', async () => {
  $('btn-more').disabled = true;
  $('btn-more').textContent = 'Scrolling…';
  const r = await send('loadMoreJobs', { rounds: 8 });
  $('btn-more').disabled = false;
  $('btn-more').textContent = 'Scroll for more';
  if (!r || r.ok === false) return showResult('Could not load more', el('p', {}, (r && r.error) || ''), r);
  showResult(`${r.jobs.length} jobs on this tab (+${r.added} new)`, el('div', {}, r.jobs.map(jobRow)), r, r.jobs);
});

$('btn-links').addEventListener('click', async () => {
  $('btn-links').disabled = true;
  const agg = isAggregator();
  $('btn-links').textContent = agg ? 'Going through jobs… (progress on the icon)' : 'Opening jobs… (about 2 s each)';
  $('btn-stop').hidden = !agg;
  if (agg) $('result-title').textContent = 'Clicking Apply on each job and saving the employer links. Links are saved as they are found, so you can close this popup.';
  // Jobright and similar only reveal the employer link after clicking Apply: go through every job.
  const r = await send('resolveApplyLinks', agg ? { limit: 50, viaApply: true } : { limit: 15 });
  $('btn-links').disabled = false;
  $('btn-links').textContent = 'Find apply links';
  $('btn-stop').hidden = true;
  if (!r || r.ok === false) return showResult('Could not find apply links', el('p', {}, (r && r.error) || ''), r);
  const head = r.blocked
    ? `${r.resolved} found, then the site showed a security check. Open a job by hand to continue.`
    : `Found ${r.resolved} apply link${r.resolved === 1 ? '' : 's'}${r.failed ? `, ${r.failed} not found` : ''}${r.stopped ? ' (stopped)' : ''}${r.remaining ? ` · ${r.remaining} left: click again` : ''}`;
  const body = el('div', {}, r.jobs.map(jobRow));
  if (r.failed && r.log) body.prepend(el('details', {}, el('summary', {}, 'What happened (for troubleshooting)'), el('pre', {}, JSON.stringify(r.log.filter((x) => x.result === 'not found').slice(0, 5), null, 1))));
  showResult(head, body, r, r.jobs);
});

$('btn-stop').addEventListener('click', async () => {
  await send('stopResolve');
  $('btn-stop').textContent = 'Stopping…';
});

$('btn-save-all').addEventListener('click', async () => {
  const n = await saveJobs(lastJobs);
  $('btn-save-all').textContent = `Saved ${n}`;
});

// ------------------------------------------------- ask Claude / ChatGPT (no API)
async function currentQuestions() {
  const scan = await send('scanForm');
  return globalThis.JC.ask.questionsFrom((scan && scan.fields) || []);
}
async function refreshAsk() {
  const qs = await currentQuestions();
  $('ask').hidden = false;
  $('ask-count').textContent = qs.length ? `${qs.length} unanswered` : 'none left';
  // Chrome's built-in on-device model (Gemini Nano, Prompt API): free, runs locally, no account.
  const avail = typeof LanguageModel !== 'undefined' ? await LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }).catch(() => 'unavailable') : 'unavailable';
  $('btn-ask-local').hidden = avail === 'unavailable' || !qs.length;
  $('ask-local-note').textContent =
    avail === 'unavailable'
      ? "On-device AI isn't available in this Chrome/computer (it needs Chrome's built-in Gemini Nano)."
      : avail === 'available'
        ? ''
        : 'First use downloads Chrome\'s on-device model once (a few GB).';
}

$('btn-ask-local').addEventListener('click', async () => {
  const JCa = globalThis.JC.ask;
  const qs = await currentQuestions();
  if (!qs.length) return;
  $('btn-ask-local').disabled = true;
  const status = (t) => ($('ask-status').textContent = t);
  let session;
  const lang = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
  const monitor = (m) => m.addEventListener('downloadprogress', (e) => status(`Downloading Chrome's on-device model: ${Math.round((e.loaded || 0) * 100)}% (one time)…`));
  try {
    status('Starting the on-device model… keep this popup open.');
    // Some Chrome builds reject the language options: fall back to a plain session.
    try {
      session = await LanguageModel.create(Object.assign({ monitor }, lang));
    } catch (_) {
      session = await LanguageModel.create({ monitor });
    }
    const job = await send('extractJob').catch(() => null);
    const { profile, resumeText } = await chrome.storage.local.get(['profile', 'resumeText']);
    const overrides = {};
    const askMe = [];
    const problems = [];
    const groups = JCa.batches(qs, 3);
    for (let i = 0; i < groups.length; i++) {
      status(`Answering questions ${i * 3 + 1}-${Math.min(qs.length, (i + 1) * 3)} of ${qs.length} on your device…`);
      const prompt = JCa.buildCompactPrompt({ questions: groups[i], job: job && job.job, profile, resumeText });
      let reply = null;
      // 1) with the JSON schema (keeps choices to real options), 2) without it, 3) shorter prompt, fresh session.
      const tries = [
        () => session.prompt(prompt, { responseConstraint: JCa.schemaFor(groups[i]) }),
        () => session.prompt(prompt + '\n\nReply with only the JSON object {"answers": {"<id>": "<answer>"}}.'),
        async () => {
          session.destroy();
          session = await LanguageModel.create({ monitor });
          return session.prompt(JCa.buildCompactPrompt({ questions: groups[i], job: job && job.job ? { title: job.job.title, company: job.job.company } : null, profile, resumeText: '' }) + '\n\nReply with only the JSON object {"answers": {"<id>": "<answer>"}}.');
        },
      ];
      for (let t = 0; t < tries.length && reply === null; t++) {
        try {
          reply = await tries[t]();
        } catch (e) {
          problems.push(`questions ${i * 3 + 1}+, attempt ${t + 1}: ${e.message || e}`);
        }
      }
      if (reply === null) continue;
      try {
        const parsed = JCa.parseReply(reply, groups[i]);
        // Without the schema a choice answer may not be an option: keep only real options.
        for (const q of groups[i]) {
          const v = parsed.overrides[q.id];
          if (v && q.options && q.options.length && !q.options.includes(v)) delete parsed.overrides[q.id];
        }
        Object.assign(overrides, parsed.overrides);
        askMe.push(...parsed.askMe);
      } catch (e) {
        problems.push(`questions ${i * 3 + 1}+: reply was not JSON`);
      }
    }
    const n = Object.keys(overrides).length;
    const r = n ? await send('autofill', { overrides }) : { filledCount: 0 };
    status(
      n
        ? `On-device AI drafted ${n} answer(s) (filled ${r.filledCount || 0}). Please read them before submitting: a small model can be wrong.${askMe.length ? ` Needs your own answer: ${askMe.join('; ')}.` : ''}${problems.length ? ` (Some questions failed: ${problems.slice(0, 2).join(' | ')})` : ''}`
        : `On-device AI couldn't answer (${problems.slice(0, 3).join(' | ') || 'no usable answers'}). Use "Copy prompt" with Claude or ChatGPT instead.`
    );
  } catch (e) {
    status('On-device AI failed to start: ' + (e.message || e) + '. Use "Copy prompt" with Claude or ChatGPT instead.');
  } finally {
    if (session) session.destroy();
    $('btn-ask-local').disabled = false;
    refreshAsk();
  }
});
$('btn-ask-copy').addEventListener('click', async () => {
  const qs = await currentQuestions();
  if (!qs.length) return ($('ask-status').textContent = 'No unanswered questions on this form. Run Autofill first if you haven\'t.');
  const job = await send('extractJob').catch(() => null);
  const { profile, resumeText } = await chrome.storage.local.get(['profile', 'resumeText']);
  const prompt = globalThis.JC.ask.buildPrompt({ questions: qs, job: job && job.job, profile, resumeText });
  await navigator.clipboard.writeText(prompt);
  $('ask-status').textContent = `Prompt copied (${qs.length} question${qs.length === 1 ? '' : 's'}, ${Math.round(prompt.length / 1000)}k characters). Paste it into Claude or ChatGPT, then paste the reply here.`;
});
$('btn-ask-claude').addEventListener('click', () => chrome.tabs.create({ url: 'https://claude.ai/new' }));
$('btn-ask-gpt').addEventListener('click', () => chrome.tabs.create({ url: 'https://chatgpt.com/' }));
$('btn-ask-fill').addEventListener('click', async () => {
  let parsed;
  try {
    parsed = globalThis.JC.ask.parseReply($('ask-reply').value, await currentQuestions());
  } catch (e) {
    $('ask-status').textContent = e.message;
    return;
  }
  const n = Object.keys(parsed.overrides).length;
  if (!n && !parsed.askMe.length) return ($('ask-status').textContent = 'The reply had no answers for the questions on this form (was it for another page?).');
  const r = await send('autofill', { overrides: parsed.overrides });
  const manual = ((r && r.needsInput) || []).filter((f) => parsed.overrides[(f.selector || '').replace(/^\[data-jc-ref="|"\]$/g, '')]);
  const parts = [`Filled ${r && r.filledCount != null ? r.filledCount : n} field(s).`];
  if (parsed.askMe.length) parts.push(`Needs your own answer: ${parsed.askMe.join('; ')}.`);
  if (manual.length) parts.push(`Pick by hand (custom dropdowns): ${manual.map((f) => `${f.label} → ${f.suggested || ''}`).join('; ')}.`);
  parts.push('Review, then Submit yourself. Answers you submit are remembered for next time.');
  $('ask-status').textContent = parts.join(' ');
  refreshAsk();
});

// ------------------------------------------------------- apply one by one
async function refreshQueue() {
  const q = await chrome.runtime.sendMessage({ type: 'jc:queue-state', tabId });
  const on = !!(q && q.active);
  $('btn-queue').hidden = on || !isAggregator();
  $('queue-box').hidden = !on && !(q && q.finishedReason);
  if (!q) return;
  const counts = `Applied ${q.applied || 0} · skipped ${q.skipped || 0}${q.failed ? ` · couldn't open ${q.failed}` : ''}`;
  $('queue-status').textContent = on
    ? `${q.current ? `Now: ${q.current.title || 'job'} (fill in anything missing, then Submit; closing its tab skips it).` : 'Opening the next job…'} ${counts}`
    : `Finished: ${q.finishedReason || ''}. ${counts}${q.lastError ? ` · last problem: ${q.lastError}` : ''}`;
  $('btn-q-skip').hidden = $('btn-q-stop').hidden = !on;
  if (on) setTimeout(refreshQueue, 1500);
}
$('btn-queue').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'jc:queue-start', tabId });
  $('btn-queue').hidden = true;
  refreshQueue();
});
$('btn-q-skip').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'jc:queue-skip', tabId }).then(refreshQueue));
$('btn-q-stop').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'jc:queue-stop', tabId }).then(refreshQueue));

// ------------------------------------------------------------- debug log (always on)
$('btn-debug').addEventListener('click', async () => {
  const r = await chrome.runtime.sendMessage({ type: 'jc:debug-get' });
  const text = JSON.stringify({ kind: 'job-copilot-debug-log', version: r.version, userAgent: r.userAgent, copiedAt: new Date().toISOString(), events: r.log }, null, 1);
  try {
    await navigator.clipboard.writeText(text);
    $('debug-status').textContent = `Copied ${r.log.length} recent steps. Paste them to Claude.`;
  } catch (_) {
    $('debug-status').textContent = 'Copy failed.';
  }
});

// ---------------------------------------------------------------- recorder
async function refreshRec() {
  if (!tabId) return;
  const r = await chrome.runtime.sendMessage({ type: 'jc:rec-query', tabId });
  $('btn-rec').textContent = r && r.on ? 'Stop & copy report' : 'Record what I do';
  $('btn-rec').classList.toggle('primary', !!(r && r.on));
  $('rec-status').textContent = r && r.on ? `Recording this tab (${r.events} events). Do the steps on the page, then reopen this popup and stop.` : '';
}
$('btn-rec').addEventListener('click', async () => {
  const q = await chrome.runtime.sendMessage({ type: 'jc:rec-query', tabId });
  if (q && q.on) {
    const r = await chrome.runtime.sendMessage({ type: 'jc:rec-stop', tabId });
    if (!r || !r.ok) return ($('rec-status').textContent = (r && r.error) || 'Could not stop.');
    const text = JSON.stringify(r.report, null, 1);
    // Offer a file too: big reports are easier to attach than to paste, and the clipboard can fail.
    const save = $('rec-save');
    save.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    save.download = `job-copilot-recording-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    save.hidden = false;
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (_) {
      /* clipboard blocked: use the file link */
    }
    $('rec-status').textContent = copied
      ? `Copied the report (${r.report.events.length} events, ${Math.round(text.length / 1024)} KB). Paste it to Claude, or save it as a file:`
      : `Report ready (${r.report.events.length} events). Copying failed, so save it as a file and attach it:`;
    $('btn-rec').textContent = 'Record what I do';
    $('btn-rec').classList.remove('primary');
    return;
  }
  await chrome.runtime.sendMessage({ type: 'jc:rec-start', tabId });
  await refreshRec();
});

init();
refreshRec();
