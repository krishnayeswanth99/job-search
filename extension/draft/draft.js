/* Job Copilot draft page: review and edit a tailored resume + cover letter, then approve it. */
const $ = (id) => document.getElementById(id);
const JC = globalThis.JC;
const params = new URLSearchParams(location.search);
const tabId = Number(params.get('tab')) || null;
const general = params.has('general') || !tabId;
let draft = null;
let saveTimer = null;

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
const status = (t, err) => {
  $('status').textContent = t || '';
  $('status').className = 'status' + (err ? ' err' : '');
};
const send = (msg) => chrome.runtime.sendMessage(msg);

function modelName(cfg) {
  if (!cfg || cfg.provider === 'nano') return "Chrome's on-device AI (Gemini Nano). A bigger model writes better drafts: see AI model in options.";
  if (cfg.provider === 'claude') return `Claude (${cfg.model || 'claude-haiku-5-5'})`;
  return `${cfg.model || 'model'} at ${cfg.baseUrl || '?'}`;
}

function render() {
  $('draft').hidden = !draft;
  if (!draft) return;
  $('btn-generate').textContent = 'Write it again';
  $('summary').value = draft.summary || '';
  $('skills').value = (draft.skills || []).join(', ');
  $('letter').value = draft.coverLetter || '';
  $('warn-box').hidden = !(draft.warnings && draft.warnings.length);
  $('warnings').replaceChildren(...(draft.warnings || []).map((w) => el('li', {}, w)));
  $('experience').replaceChildren(
    ...(draft.experience || []).map((e, k) => {
      const ta = el('textarea', { rows: Math.max(3, e.bullets.length + 1) });
      ta.value = e.bullets.join('\n');
      ta.addEventListener('input', () => {
        draft.experience[k].bullets = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
        changed();
      });
      const when = [e.start, e.current ? 'present' : e.end].filter(Boolean).join(' – ');
      return el('div', { class: 'job' }, el('div', { class: 'job-head' }, `${e.title || '?'} — ${e.company || '?'}`, el('span', { class: 'muted' }, when ? `  ${when}` : '')), ta);
    })
  );
  $('approved').textContent = draft.status === 'approved' ? `Approved ${new Date(draft.approvedAt).toLocaleString()}: autofill uses this draft and attaches its PDFs.` : '';
  $('btn-approve').textContent = draft.status === 'approved' ? 'Approved ✓ (approve again after edits)' : 'Approve & use for this application';
}

function changed() {
  if (draft.status === 'approved') {
    draft.status = 'draft'; // edits need a new approval (the PDFs are made then)
    $('approved').textContent = 'Edited: approve again to use these changes.';
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => send({ type: 'jc:draft-save', draft }), 400);
}
$('summary').addEventListener('input', () => {
  draft.summary = $('summary').value;
  changed();
});
$('skills').addEventListener('input', () => {
  draft.skills = $('skills').value.split(',').map((s) => s.trim()).filter(Boolean);
  changed();
});
$('letter').addEventListener('input', () => {
  draft.coverLetter = $('letter').value;
  changed();
});

$('btn-generate').addEventListener('click', async () => {
  $('btn-generate').disabled = true;
  status('Writing the draft… (on-device or local models can take a minute)');
  const r = await send({ type: 'jc:draft-create', tabId, general });
  $('btn-generate').disabled = false;
  if (!r || !r.ok) return status((r && r.error) || 'Something went wrong.', true);
  draft = r.draft;
  status(`Draft written in ${Math.round((draft.ms || 0) / 1000)} s. Read it and edit anything, then Approve.`);
  render();
});

$('btn-approve').addEventListener('click', async () => {
  clearTimeout(saveTimer);
  const r = await send({ type: 'jc:draft-approve', draft });
  if (!r || !r.ok) return status((r && r.error) || 'Could not approve.', true);
  draft = r.draft;
  render();
  status(general ? 'Approved. Download the PDFs, or use it as your main resume.' : 'Approved. Go back to the application and click Autofill (or let it fill as you go): it uses this draft and attaches its PDFs.');
});

async function download(kind) {
  const { profile } = await chrome.storage.local.get('profile');
  const doc = JC.draft.resumeDoc(profile, draft);
  const bytes = kind === 'resume' ? JC.pdf.resume(doc) : JC.pdf.letter({ name: doc.name, contact: doc.contact.slice(0, 3), body: draft.coverLetter });
  const a = el('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), download: `${(doc.name || 'resume').replace(/\s+/g, '-')}-${kind === 'resume' ? 'Resume' : 'Cover-Letter'}.pdf` });
  document.body.append(a);
  a.click();
  a.remove();
}
$('btn-resume').addEventListener('click', () => download('resume'));
$('btn-letter').addEventListener('click', () => download('letter'));
$('btn-main').addEventListener('click', async () => {
  if (draft.status !== 'approved') return status('Approve it first.', true);
  await chrome.storage.local.set({ resume: Object.assign({}, draft.files.resume, { name: draft.files.resume.name.replace(/-Resume-?.*\.pdf$/, '-Resume.pdf') }) });
  status('Saved as your main resume: it is attached to applications that have no tailored draft.');
});

(async function init() {
  const r = await send({ type: 'jc:draft-for-tab', tabId, general });
  $('model').textContent = 'Model: ' + modelName(r && r.model);
  $('btn-main').hidden = !general;
  if (general) {
    $('title').textContent = 'Resume from your detailed work history';
    $('subtitle').textContent = 'Not for a specific job: your strongest general resume, built from the details and projects in your profile.';
  } else if (r && r.job) {
    $('subtitle').textContent = [r.job.title, r.job.company].filter(Boolean).join(' at ') || 'This job';
  }
  draft = r && r.draft;
  render();
})();
