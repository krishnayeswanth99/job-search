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

$('btn-autofill').addEventListener('click', async () => {
  $('btn-autofill').disabled = true;
  const r = await send('autofill');
  $('btn-autofill').disabled = false;
  if (!r || r.ok === false) return showResult('Autofill failed', el('p', {}, (r && r.error) || 'Unknown error'), r);
  const body = el('div', {},
    el('p', { class: 'ok' }, `Filled ${r.filledCount} field${r.filledCount === 1 ? '' : 's'}.`),
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
