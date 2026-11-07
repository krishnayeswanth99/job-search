/* Job Copilot popup. All page data is rendered with textContent (never innerHTML). */
const $ = (id) => document.getElementById(id);
let tabId = null;
let lastPayload = null;
let lastJobs = [];

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
      el('span', { class: 'sub' }, sub, j.easyApply ? el('span', { class: 'pill' }, 'Easy Apply') : null, j.remote ? el('span', { class: 'pill' }, 'Remote') : null)
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
  if (d.apply && d.apply.kind === 'easy-apply') $('page-type').textContent += ` · ${d.apply.text} (on-site)`;
  if (d.pageType === 'listings' || d.jobCount) $('btn-jobs').classList.add('primary');
}

$('btn-follow').addEventListener('click', async () => {
  const r = await send('followApply');
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

$('btn-save-all').addEventListener('click', async () => {
  const n = await saveJobs(lastJobs);
  $('btn-save-all').textContent = `Saved ${n}`;
});

init();
