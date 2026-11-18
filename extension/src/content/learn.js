/*
 * Job Copilot: learn field labels from another autofill (Simplify, Jobright, the site's own
 * resume reader…).
 *
 * When something other than the user or Job Copilot fills a field (a script-dispatched input/change
 * event), and the value equals exactly one distinctive profile value, the field's LABEL is linked to
 * that profile key ("Contact No." -> phone). Values are never stored or logged, only the label and
 * the key. Learned labels are used by autofill when no built-in rule recognises a label.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});
  if (JC.learn) return;

  // Keys whose values are distinctive enough to identify a field (no Yes/No answers, no EEO).
  const LEARNABLE = {
    personal: ['firstName', 'lastName', 'preferredName', 'email', 'phone', 'address1', 'address2', 'city', 'state', 'postalCode', 'country'],
    links: ['linkedin', 'github', 'portfolio', 'website', 'twitter'],
    work: ['currentTitle', 'currentCompany'],
    education: ['school', 'degree', 'fieldOfStudy'],
  };
  const SENSITIVE = /(gender|sex|race|ethnic|hispanic|latin|veteran|military|disabilit|orientation|pronoun|birth|dob|age\b|ssn|social security|national id|passport|password|salary|compensation|pay\b|religion|citizenship|criminal|convict)/i;

  let profile = null;
  let learned = {};
  let enabled = true;
  let ourFill = 0; // > 0 while Job Copilot itself is filling (don't learn from our own events)

  const norm = (s) => JC.rules.norm(String(s || '')).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  try {
    chrome.storage.local.get(['profile', 'learnedLabels', 'settings']).then((v) => {
      profile = v.profile ? JC.normalizeProfile(v.profile) : null;
      learned = v.learnedLabels || {};
      enabled = !v.settings || v.settings.learnFromOtherAutofill !== false;
    });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch.profile) profile = ch.profile.newValue ? JC.normalizeProfile(ch.profile.newValue) : null;
      if (ch.learnedLabels) learned = ch.learnedLabels.newValue || {};
      if (ch.settings) enabled = !ch.settings.newValue || ch.settings.newValue.learnFromOtherAutofill !== false;
    });
  } catch (_) {
    /* not in an extension context */
  }

  /** The profile key whose value equals `value`, if exactly one distinctive key matches. */
  function keyForValue(value) {
    if (!profile) return null;
    const v = String(value || '').trim();
    if (v.length < 3) return null;
    const hits = [];
    for (const [sec, keys] of Object.entries(LEARNABLE)) {
      for (const k of keys) {
        const ours = (profile[sec] || {})[k];
        if (ours && String(ours).trim().length >= 3 && JC.rules.sameValue(k, v, ours)) hits.push(k);
      }
    }
    return hits.length === 1 ? hits[0] : null;
  }

  /** Learned key for a label (used by fields.js when no rule matches). */
  function keyForLabel(label) {
    const hit = learned[norm(label)];
    return hit ? hit.key : null;
  }

  function onFill(e) {
    if (e.isTrusted || ourFill > 0 || !enabled || !profile) return; // user input, or our own autofill
    const el = e.target;
    if (!el || !el.matches || !el.matches('input:not([type="password"]):not([type="hidden"]):not([type="file"]), textarea, select')) return;
    const label = (JC.fields.labelFor(el) || '').trim();
    if (!label || label.length > 120 || SENSITIVE.test(label)) return;
    // Already understood by a rule? Nothing to learn.
    const known = JC.rules.classifyField({ label, name: el.name, id: el.id, placeholder: el.placeholder, autocomplete: el.getAttribute('autocomplete'), type: el.type });
    const value = el.tagName === 'SELECT' ? (el.options[el.selectedIndex] || {}).text : el.value;
    const key = keyForValue(value);
    if (!key || (known && known.key === key)) return;
    const nl = norm(label);
    if (!nl || (learned[nl] && learned[nl].key === key)) return;
    try {
      chrome.runtime.sendMessage({ type: 'jc:learn-label', label: nl, display: label.slice(0, 120), key, host: location.hostname, replaces: known ? known.key : null }).catch(() => {});
    } catch (_) {
      /* extension reloaded */
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('input', onFill, true);
    document.addEventListener('change', onFill, true);
  }

  JC.learn = {
    keyForLabel,
    keyForValue,
    /** Wrap Job Copilot's own filling so it isn't mistaken for another autofill. */
    async ours(fn) {
      ourFill++;
      try {
        return await fn();
      } finally {
        setTimeout(() => ourFill--, 50);
      }
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
