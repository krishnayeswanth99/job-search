/* Job Copilot options page: profile editor, saved answers, files, saved jobs, bridge settings. */
const $ = (id) => document.getElementById(id);
const JC = globalThis.JC;
let profile = JC.emptyProfile();
let saveTimer = null;

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}

function flash(msg) {
  $('save-state').textContent = msg;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => ($('save-state').textContent = ''), 1800);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ profile });
    flash('Saved');
  }, 300);
}

// ---------------------------------------------------------------- profile
function renderProfile() {
  const form = $('profile-form');
  form.replaceChildren();
  for (const s of JC.PROFILE_SECTIONS) {
    form.append(el('h3', {}, s.title));
    if (s.hint) form.append(el('p', { class: 'muted' }, s.hint));
    const grid = el('div', { class: 'grid' });
    for (const [key, label, type] of s.fields) {
      const input = el('input', { type: type || 'text', value: (profile[s.id] && profile[s.id][key]) || '', 'data-section': s.id, 'data-key': key });
      input.addEventListener('input', () => {
        profile[s.id][key] = input.value;
        scheduleSave();
      });
      grid.append(el('label', {}, label, input));
    }
    form.append(grid);
  }
  $('howDidYouHear').value = profile.howDidYouHear || '';
  $('summary').value = profile.summary || '';
  renderAnswers();
}

$('howDidYouHear').addEventListener('input', (e) => {
  profile.howDidYouHear = e.target.value;
  scheduleSave();
});
$('summary').addEventListener('input', (e) => {
  profile.summary = e.target.value;
  scheduleSave();
});

function renderAnswers() {
  const list = $('answers-list');
  list.replaceChildren();
  profile.answers.forEach((a, i) => {
    const q = el('input', { placeholder: 'Question (e.g. Why do you want to work here?)', value: a.question || '' });
    const ans = el('textarea', { rows: 2, placeholder: 'Answer' });
    ans.value = a.answer || '';
    q.addEventListener('input', () => {
      a.question = q.value;
      scheduleSave();
    });
    ans.addEventListener('input', () => {
      a.answer = ans.value;
      scheduleSave();
    });
    const del = el('button', { class: 'small', onclick: () => {
      profile.answers.splice(i, 1);
      renderAnswers();
      scheduleSave();
    } }, 'Remove');
    const row = el('div', { class: 'answer' }, q, ans, del);
    if (a.source === 'remembered') {
      const scope = el('select', { class: 'small' }, el('option', { value: 'any' }, 'Use for every company'), el('option', { value: 'company' }, `Only for ${a.company || a.host || 'this company'}`));
      scope.value = a.scope === 'company' ? 'company' : 'any';
      scope.addEventListener('change', () => {
        a.scope = scope.value;
        if (a.scope === 'company' && !a.company) a.company = a.host || '';
        scheduleSave();
      });
      const meta = el('div', { class: 'answer-meta muted small' }, `Remembered${a.company ? ' at ' + a.company : a.host ? ' at ' + a.host : ''}${a.updatedAt ? ' · ' + a.updatedAt.slice(0, 10) : ''}${a.uses > 1 ? ` · used ${a.uses}×` : ''} · `, scope);
      list.append(el('div', { class: 'answer-wrap' }, row, meta));
    } else list.append(row);
  });
}

$('add-answer').addEventListener('click', () => {
  profile.answers.push({ question: '', answer: '' });
  renderAnswers();
});

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('export-profile').addEventListener('click', () => download('profile.json', JSON.stringify(profile, null, 2), 'application/json'));

$('import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    profile = JC.normalizeProfile(JSON.parse(await f.text()));
    await chrome.storage.local.set({ profile });
    renderProfile();
    flash('Profile imported');
  } catch (err) {
    alert('Could not read that file: ' + err.message);
  }
  e.target.value = '';
});

// ------------------------------------------------------------------ files
function readFileB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function bindFile(kind, inputId, nameId, clearId) {
  $(inputId).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return alert('Please use a file under 10 MB.');
    const data = { name: f.name, type: f.type || 'application/pdf', size: f.size, dataBase64: await readFileB64(f), updatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [kind]: data });
    $(nameId).textContent = `${f.name} (${Math.round(f.size / 1024)} KB)`;
    flash('File saved');
    if (kind === 'resume') {
      // resume-import.js reads it and shows the review panel.
      document.dispatchEvent(new CustomEvent('jc:resume-saved', { detail: { name: f.name, type: f.type, buffer: await f.arrayBuffer() } }));
    }
    e.target.value = '';
  });
  $(clearId).addEventListener('click', async () => {
    await chrome.storage.local.remove(kind);
    $(nameId).textContent = 'none';
  });
}
bindFile('resume', 'resume-file', 'resume-name', 'resume-clear');
bindFile('coverLetter', 'cover-file', 'cover-name', 'cover-clear');

// ------------------------------------------------------------ saved jobs
async function renderJobs() {
  const { savedJobs } = await chrome.storage.local.get('savedJobs');
  const jobs = savedJobs || [];
  const list = $('jobs-list');
  list.replaceChildren();
  if (!jobs.length) return list.append(el('p', { class: 'muted' }, 'No saved jobs. Use "Find jobs on this tab" in the popup to save some.'));
  for (const j of jobs.slice().reverse()) {
    list.append(el('div', { class: 'job' }, el('div', { class: 'meta' }, el('a', { class: 'title', href: j.url, target: '_blank', rel: 'noopener' }, j.title), el('span', { class: 'sub' }, [j.company, j.location, j.source, j.savedAt && j.savedAt.slice(0, 10)].filter(Boolean).join(' · ')))));
  }
}

function csv(rows) {
  const cols = ['title', 'company', 'location', 'salary', 'url', 'source', 'easyApply', 'postedAt', 'savedAt', 'status'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

$('export-jobs-json').addEventListener('click', async () => {
  const { savedJobs } = await chrome.storage.local.get('savedJobs');
  download('saved-jobs.json', JSON.stringify(savedJobs || [], null, 2), 'application/json');
});
$('export-jobs-csv').addEventListener('click', async () => {
  const { savedJobs } = await chrome.storage.local.get('savedJobs');
  download('saved-jobs.csv', csv(savedJobs || []), 'text/csv');
});
$('clear-jobs').addEventListener('click', async () => {
  if (!confirm('Remove all saved jobs?')) return;
  await chrome.storage.local.set({ savedJobs: [] });
  renderJobs();
});

// --------------------------------------------------------------- settings
async function renderSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = Object.assign({}, JC.DEFAULT_SETTINGS, settings || {});
  for (const k of ['bridgeEnabled', 'bridgeAutofill', 'showBadge', 'rememberAnswers']) {
    $(k).checked = !!s[k];
    $(k).onchange = async () => {
      s[k] = $(k).checked;
      await chrome.storage.local.set({ settings: s });
      flash('Saved');
    };
  }
  $('trustedDomains').value = (s.trustedDomains || []).join('\n');
  $('trustedDomains').oninput = () => {
    clearTimeout(renderSettings.t);
    renderSettings.t = setTimeout(async () => {
      s.trustedDomains = $('trustedDomains').value.split(/[\s,]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
      await chrome.storage.local.set({ settings: s });
      flash('Saved');
    }, 400);
  };
  $('default-domains').textContent = JC.DEFAULT_TRUSTED_DOMAINS.join(', ');
}

// Used by resume-import.js to read the profile and save reviewed suggestions.
let readyResolve;
const ready = new Promise((r) => (readyResolve = r));
window.JCOptions = {
  getProfile: () => profile,
  async applyUpdates(updates) {
    await ready;
    for (const [path, value] of Object.entries(updates)) {
      const [sec, key] = path.split('.');
      if (key === undefined) profile[sec] = value;
      else {
        profile[sec] = profile[sec] || {};
        profile[sec][key] = value;
      }
    }
    await chrome.storage.local.set({ profile });
    renderProfile();
    flash('Profile updated from resume');
  },
};

(async function init() {
  const data = await chrome.storage.local.get(['profile', 'resume', 'coverLetter']);
  profile = JC.normalizeProfile(data.profile);
  renderProfile();
  if (data.resume) $('resume-name').textContent = `${data.resume.name} (${Math.round((data.resume.size || 0) / 1024)} KB)`;
  if (data.coverLetter) $('cover-name').textContent = `${data.coverLetter.name} (${Math.round((data.coverLetter.size || 0) / 1024)} KB)`;
  renderJobs();
  renderSettings();
  readyResolve();
})();
