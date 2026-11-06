/*
 * Job Copilot options: read the uploaded resume and suggest profile values.
 * Everything runs locally in this page; the resume is never uploaded anywhere.
 * Suggestions are shown for review/editing and only saved when the user clicks Save.
 */
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.mjs');

const JC = globalThis.JC;
const $ = (id) => document.getElementById(id);

// --------------------------------------------------------------- text extraction
async function pdfText(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
  const pages = [];
  for (let n = 1; n <= Math.min(doc.numPages, 6); n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    let out = '';
    let lastY = null;
    let lastEnd = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      const h = Math.abs(it.transform[3]) || 10;
      if (lastY !== null && Math.abs(y - lastY) > h * 0.5) out += '\n';
      else if (lastEnd !== null && x - lastEnd > h * 1.5)
        out += '  '; // wide gap = separate column ("Title    2021 – Present")
      else if (lastEnd !== null && x - lastEnd > h * 0.15 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' ';
      out += it.str;
      if (it.hasEOL) {
        out += '\n';
        lastY = null;
        lastEnd = null;
      } else {
        lastY = y;
        lastEnd = x + (it.width || 0);
      }
    }
    pages.push(out);
  }
  return pages.join('\n');
}

async function extractText(name, type, buf) {
  const lower = (name || '').toLowerCase();
  if (lower.endsWith('.pdf') || type === 'application/pdf') return pdfText(buf);
  if (lower.endsWith('.docx') || /officedocument\.wordprocessingml/.test(type || '')) return JC.docx.extractText(buf);
  if (lower.endsWith('.doc')) throw new Error('Old .doc files cannot be read. Save it as .docx or PDF and upload again.');
  return new TextDecoder().decode(buf);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

// --------------------------------------------------------------------- review UI
function labelFor(path) {
  if (path === 'summary') return 'Professional summary';
  const [sec, key] = path.split('.');
  const s = JC.PROFILE_SECTIONS.find((x) => x.id === sec);
  const f = s && s.fields.find(([k]) => k === key);
  return f ? f[1] : path;
}

function getPath(profile, path) {
  const parts = path.split('.');
  return parts.length === 1 ? profile[parts[0]] || '' : (profile[parts[0]] || {})[parts[1]] || '';
}

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v;
    else if (k === 'checked') n.checked = !!v;
    else if (k === 'value') n.value = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

function renderReview(result, fileName) {
  const box = $('resume-review');
  const profile = window.JCOptions.getProfile();
  const order = JC.PROFILE_SECTIONS.flatMap((s) => s.fields.map(([k]) => `${s.id}.${k}`)).concat(['summary']);
  const paths = Object.keys(result.fields).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const rows = [];

  const body = el('div', { class: 'review-rows' });
  for (const path of paths) {
    const sug = result.fields[path];
    const current = String(getPath(profile, path) || '');
    const same = current.trim() === sug.value.trim();
    const input = path === 'summary' ? el('textarea', { rows: 3, value: sug.value }) : el('input', { value: sug.value });
    const check = el('input', { type: 'checkbox', checked: !current || same, 'aria-label': `Use ${labelFor(path)}` });
    input.addEventListener('input', () => (check.checked = true));
    rows.push({ path, input, check });
    body.append(
      el(
        'div',
        { class: 'review-row' },
        check,
        el(
          'div',
          { class: 'review-field' },
          el(
            'div',
            { class: 'review-label' },
            labelFor(path),
            ' ',
            el('span', { class: `conf conf-${sug.confidence}` }, sug.confidence === 'high' ? 'sure' : sug.confidence === 'medium' ? 'check' : 'guess'),
          ),
          input,
          current && !same ? el('div', { class: 'muted small' }, 'Currently in your profile: ', current) : null,
          sug.note ? el('div', { class: 'muted small' }, sug.note) : null,
        ),
      ),
    );
  }

  const status = el('span', { class: 'muted' });
  const save = el(
    'button',
    {
      class: 'primary',
      onclick: async () => {
        const updates = {};
        for (const r of rows) if (r.check.checked && r.input.value.trim()) updates[r.path] = r.input.value.trim();
        await window.JCOptions.applyUpdates(updates);
        box.replaceChildren(
          el(
            'p',
            { class: 'ok' },
            `Saved ${Object.keys(updates).length} field${Object.keys(updates).length === 1 ? '' : 's'} to your profile. You can edit everything below.`,
          ),
        );
        document.getElementById('profile').scrollIntoView({ behavior: 'smooth' });
      },
    },
    'Save selected to profile',
  );
  const discard = el('button', { onclick: () => box.replaceChildren() }, 'Discard');
  const toggle = el(
    'button',
    {
      class: 'small',
      onclick: () => {
        const all = rows.every((r) => r.check.checked);
        rows.forEach((r) => (r.check.checked = !all));
      },
    },
    'Select all / none',
  );

  box.replaceChildren(
    ...[
      el('h3', {}, `Found in ${fileName}`),
      el(
        'p',
        { class: 'muted' },
        'Check each value and edit anything that is wrong. Ticked fields are saved to your profile. Fields you already filled stay unticked so nothing is overwritten by accident.',
      ),
      result.warnings.length
        ? el(
            'ul',
            { class: 'warn-list' },
            result.warnings.map((w) => el('li', {}, w)),
          )
        : null,
      paths.length ? toggle : null,
      paths.length ? body : el('p', {}, 'Nothing could be read automatically. Fill in the profile below by hand.'),
      el('div', { class: 'buttons' }, paths.length ? save : null, discard, status),
    ].filter(Boolean), // replaceChildren() would print "null" for empty slots
  );
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function readAndReview(file) {
  const box = $('resume-review');
  box.hidden = false;
  box.replaceChildren(el('p', { class: 'muted' }, `Reading ${file.name}…`));
  try {
    const text = await extractText(file.name, file.type, file.buffer);
    const result = JC.resume.parse(text);
    window.JCOptions.lastResumeText = text;
    renderReview(result, file.name);
  } catch (e) {
    box.replaceChildren(el('p', { class: 'warn-text' }, `Could not read ${file.name}: ${e.message}`));
  }
}

// After options.js stores a new resume file it dispatches this event.
document.addEventListener('jc:resume-saved', (e) => readAndReview(e.detail));

$('resume-reparse').addEventListener('click', async () => {
  const { resume } = await chrome.storage.local.get('resume');
  if (!resume) return alert('Upload a resume first.');
  readAndReview({ name: resume.name, type: resume.type, buffer: b64ToBuf(resume.dataBase64) });
});

// Exposed for tests and for the Claude bridge-free flow.
window.JCResumeImport = { extractText, readAndReview };
