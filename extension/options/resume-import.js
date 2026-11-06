/*
 * Job Copilot options: read the uploaded resume and suggest profile values.
 * By default everything runs locally in this page. If the user adds their own
 * Anthropic API key, "Read with Claude" sends the resume to the Claude API instead
 * (official SDK, bundled in vendor/anthropic-sdk). Either way, suggestions are
 * shown for review/editing and only saved when the user clicks Save.
 */
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import Anthropic from '../vendor/anthropic-sdk/anthropic-sdk.mjs';

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
            el('span', { class: `conf conf-${sug.confidence}` }, { high: 'sure', medium: 'check', low: 'guess', claude: 'from Claude' }[sug.confidence] || 'check'),
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

// ------------------------------------------------------------ Claude (optional)
async function claudeSettings() {
  const { claudeApi } = await chrome.storage.local.get('claudeApi');
  return Object.assign({ apiKey: '', model: JC.claudeResume.DEFAULT_MODEL, autoRead: false }, claudeApi || {});
}

function bufToB64(buf) {
  const u8 = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Your Anthropic API key was rejected. Check it in "Claude (optional)" below.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use that model.';
  if (e instanceof Anthropic.NotFoundError) return 'That model is not available to your API key. Pick another model below.';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the Claude API. Wait a minute and try again.';
  if (e instanceof Anthropic.BadRequestError) return `The Claude API rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check your connection.';
  if (e instanceof Anthropic.APIError) return `Claude API error ${e.status || ''}: ${e.message}`;
  return e && e.message ? e.message : String(e);
}

/** Ask Claude to extract profile fields. Returns the same shape as JC.resume.parse(). */
async function claudeExtract(file, settings) {
  const isPdf = (file.name || '').toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
  const instructions = JC.claudeResume.prompt(new Date().toISOString().slice(0, 10));
  const content = isPdf
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bufToB64(file.buffer) } },
        { type: 'text', text: instructions },
      ]
    : [{ type: 'text', text: `<resume>\n${await extractText(file.name, file.type, file.buffer)}\n</resume>\n\n${instructions}` }];

  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, timeout: 120000 });
  const params = {
    model: settings.model,
    max_tokens: 16000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: JC.claudeResume.schema() } },
    messages: [{ role: 'user', content }],
  };
  // Sonnet 5.5 / Opus 5.5: let the API retry on a fallback model if a safety classifier declines.
  const withFallback = settings.model === 'claude-sonnet-5-5' || settings.model === 'claude-opus-5-5';
  const res = withFallback
    ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : await client.messages.create(params);

  if (res.stop_reason === 'refusal') throw new Error('Claude declined to read this file.');
  if (res.stop_reason === 'max_tokens') throw new Error('Claude ran out of output space. Try again.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    throw new Error('Claude returned something that was not valid JSON.');
  }
  return JC.claudeResume.toResult(json);
}

async function readAndReview(file, opts) {
  const box = $('resume-review');
  box.hidden = false;
  const settings = await claudeSettings();
  const useClaude = opts && 'useClaude' in opts ? opts.useClaude : settings.autoRead && !!settings.apiKey;
  const model = (JC.claudeResume.MODELS.find((m) => m.id === settings.model) || { label: settings.model }).label.split(' (')[0];
  box.replaceChildren(el('p', { class: 'muted' }, useClaude ? `Sending ${file.name} to ${model}…` : `Reading ${file.name}…`));
  if (useClaude) {
    try {
      renderReview(await claudeExtract(file, settings), `${file.name} (read by ${model})`);
      return;
    } catch (e) {
      // Fall back to the built-in reader so the user still gets suggestions.
      try {
        const local = JC.resume.parse(await extractText(file.name, file.type, file.buffer));
        local.warnings.unshift(`Claude could not read it: ${friendlyError(e)} Showing the built-in reader's results instead.`);
        renderReview(local, file.name);
      } catch (e2) {
        box.replaceChildren(el('p', { class: 'warn-text' }, `Could not read ${file.name}: ${friendlyError(e)}`));
      }
      return;
    }
  }
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

async function storedResume() {
  const { resume } = await chrome.storage.local.get('resume');
  if (!resume) {
    alert('Upload a resume first.');
    return null;
  }
  return { name: resume.name, type: resume.type, buffer: b64ToBuf(resume.dataBase64) };
}

$('resume-reparse').addEventListener('click', async () => {
  const f = await storedResume();
  if (f) readAndReview(f, { useClaude: false });
});

$('resume-claude').addEventListener('click', async () => {
  const s = await claudeSettings();
  if (!s.apiKey) {
    $('claude').scrollIntoView({ behavior: 'smooth' });
    $('claude-key').focus();
    return;
  }
  const f = await storedResume();
  if (f) readAndReview(f, { useClaude: true });
});

// "Claude (optional)" settings card.
async function renderClaudeSettings() {
  const s = await claudeSettings();
  const sel = $('claude-model');
  sel.replaceChildren(...JC.claudeResume.MODELS.map((m) => el('option', { value: m.id }, m.label)));
  sel.value = s.model;
  $('claude-auto').checked = !!s.autoRead;
  $('claude-key').value = '';
  $('claude-key').placeholder = s.apiKey ? `Saved (…${s.apiKey.slice(-4)}). Paste a new key to replace it.` : 'sk-ant-…';
  $('claude-status').textContent = s.apiKey ? 'Key saved in this browser.' : 'No key saved. Claude features are off.';
  $('claude-remove').hidden = !s.apiKey;
  $('resume-claude').title = s.apiKey ? `Send the resume to ${s.model} and review what it finds` : 'Add your Anthropic API key under "Claude (optional)" first';
}

async function saveClaudeSettings(patch) {
  const s = Object.assign(await claudeSettings(), patch);
  await chrome.storage.local.set({ claudeApi: s });
  await renderClaudeSettings();
}

$('claude-save').addEventListener('click', async () => {
  const key = $('claude-key').value.trim();
  if (key && !/^sk-ant-/.test(key)) return alert('That does not look like an Anthropic API key (they start with "sk-ant-").');
  await saveClaudeSettings(key ? { apiKey: key } : {});
});
$('claude-remove').addEventListener('click', () => saveClaudeSettings({ apiKey: '', autoRead: false }));
$('claude-model').addEventListener('change', (e) => saveClaudeSettings({ model: e.target.value }));
$('claude-auto').addEventListener('change', (e) => saveClaudeSettings({ autoRead: e.target.checked }));
renderClaudeSettings();

// Exposed for tests.
window.JCResumeImport = { extractText, readAndReview, claudeExtract };
