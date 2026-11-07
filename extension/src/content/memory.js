/*
 * Job Copilot: answer memory.
 *
 * On an application form, when the user (or Claude) answers a question autofill
 * did not know and then clicks Submit / Next / Continue, the question and answer
 * are saved to the profile's `answers` (marked source: 'remembered'). Next time a
 * similar question appears, autofill reuses the answer.
 *
 * Never remembered: profile fields (name, email, ...), consent boxes, files,
 * passwords, EEO/demographic answers, pay, and values that look like personal
 * identifiers. Company-specific answers ("Why do you want to work at X?") are only
 * reused for the same employer. Everything stays in chrome.storage.local and can be
 * edited or deleted under "Saved answers" in the options page.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});
  if (JC.memory) return;
  const R = JC.rules;

  /** Stable employer key for the current page (shared ATS hosts are split by company). */
  function context() {
    const host = location.hostname.replace(/^www\./, '');
    const seg = (location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
    let company = host;
    if (/(^|\.)greenhouse\.io$|(^|\.)lever\.co$|(^|\.)ashbyhq\.com$|(^|\.)workable\.com$|(^|\.)recruitee\.com$|(^|\.)smartrecruiters\.com$/.test(host) && seg && !/^(embed|jobs|j)$/.test(seg)) company = seg;
    else if (/greenhouse\.io$/.test(host)) company = new URLSearchParams(location.search).get('for') || host;
    else if (/myworkdayjobs\.com$|myworkdaysite\.com$|bamboohr\.com$|icims\.com$|jobvite\.com$/.test(host)) company = host.split('.')[0];
    return { host, company: company.replace(/[^a-z0-9.-]/gi, '').toLowerCase() };
  }

  /** The answer currently entered in a scanned field, as text (option text for choices). */
  function valueOf(f) {
    if (f.els && f.els.length > 1) {
      const picked = f.els.filter((e) => e.checked).map((e) => JC.fields.labelFor(e) || e.value);
      return picked.join(', ');
    }
    const el = f.el;
    if (f.type === 'select') return el.selectedIndex > 0 || (el.selectedIndex === 0 && el.value) ? (el.options[el.selectedIndex] || {}).text || '' : '';
    if (f.type === 'checkbox') return ''; // single checkboxes are acknowledgements, not answers
    if (f.type === 'radio') return el.checked ? JC.fields.labelFor(el) || el.value : '';
    return el.value || '';
  }

  function capture() {
    const fields = JC.fields.scan();
    if (!JC.fields.looksLikeApplication(fields) && !fields.some((f) => !f.key)) return [];
    const items = [];
    for (const f of fields) {
      if (['file', 'password', 'hidden', 'email', 'tel'].includes(f.type)) continue;
      // Only questions the profile can't answer: custom questions, plus per-skill "years with X".
      if (f.key && !(f.key === 'yearsExperience' && /\bwith\b|\busing\b|\bin\b/i.test(f.label || ''))) continue;
      if (f.key && R.NEVER_REMEMBER.has(f.key)) continue;
      const question = (f.label || '').trim();
      if (!question || question.length < 6 || /^(type your response|select\.*|choose\.*|answer)$/i.test(question)) continue;
      if (/captcha|password|social security|ssn|date of birth|birth ?date|passport|driver'?s licen[cs]e|bank|routing|credit card/i.test(question)) continue;
      const answer = valueOf(f).trim();
      if (answer) items.push({ question, answer, type: f.type });
    }
    return items;
  }

  let lastSent = '';
  async function remember(trigger) {
    try {
      const { settings } = await chrome.storage.local.get('settings');
      if (settings && settings.rememberAnswers === false) return;
      const items = capture();
      if (!items.length) return;
      const key = JSON.stringify(items);
      if (key === lastSent) return;
      lastSent = key;
      await chrome.runtime.sendMessage({ type: 'jc:remember', items, ctx: context(), trigger });
    } catch (_) {
      /* extension reloaded or page closing: ignore */
    }
  }

  // Submit / next-step clicks and form submits. Capture phase, so it runs before the page navigates.
  const STEP_RE = /^(submit|submit application|apply|send( application)?|next|continue|save (and|&) continue|review|review application|finish|done)\b/i;
  document.addEventListener(
    'click',
    (e) => {
      const b = e.target && e.target.closest && e.target.closest('button, input[type="submit"], [role="button"], a');
      if (!b) return;
      const t = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim();
      if (t && t.length < 40 && STEP_RE.test(t)) remember('click:' + t);
    },
    true
  );
  document.addEventListener('submit', () => remember('submit'), true);

  JC.memory = { context, capture, remember };
})(typeof globalThis !== 'undefined' ? globalThis : self);
