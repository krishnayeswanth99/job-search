/*
 * Job Copilot: autofill engine.
 *
 * Fills what it can deterministically from the profile, never submits, never
 * ticks consent boxes, and reports everything else as `needsInput` so Claude
 * (or the user) can answer the custom questions.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});
  const R = JC.rules;

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  /**
   * Set a value so React/Vue/Angular notice it. From the extension's isolated
   * world, the native setter bypasses the page framework's value tracker, so
   * the input event is seen as a real change.
   */
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    el.focus({ preventScroll: true });
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    fire(el, 'input');
    fire(el, 'change');
    el.blur();
    fire(el, 'blur');
  }

  function setChecked(el, checked) {
    if (el.checked === checked) return;
    // A real click toggles state and fires the events frameworks listen for.
    el.click();
    if (el.checked !== checked) {
      el.checked = checked;
      fire(el, 'input');
      fire(el, 'change');
    }
  }

  function fillSelect(el, desired) {
    const opts = [...el.options].map((o) => ({ value: o.value, text: o.text }));
    const i = R.chooseOption(opts, desired);
    if (i < 0) return false;
    if (el.selectedIndex === i) return true;
    setValue(el, el.options[i].value);
    return true;
  }

  function fillGroup(f, desired) {
    const i = R.chooseOption(f.options, desired);
    if (i < 0) return false;
    const target = f.els[i];
    if (f.type === 'radio') setChecked(target, true);
    else setChecked(target, true); // checkbox group: tick the matching option only
    return true;
  }

  function fillCheckbox(f, desired) {
    const d = R.norm(desired);
    if (/^(yes|y|true)$/.test(d)) setChecked(f.el, true);
    else if (/^(no|n|false)$/.test(d)) setChecked(f.el, false);
    else return false;
    return true;
  }

  function attachFile(input, file) {
    if (!file || !file.dataBase64) return false;
    const bin = atob(file.dataBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const f = new File([bytes], file.name || 'resume.pdf', { type: file.type || 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(f);
    input.files = dt.files;
    fire(input, 'input');
    fire(input, 'change');
    return true;
  }

  /** Decide the value for a field: explicit override > saved answer > profile. */
  function resolve(f, profile, overrides) {
    if (overrides) {
      const o = overrides[f.ref] ?? overrides[f.label] ?? (f.key && overrides[f.key]);
      if (o !== undefined && o !== null && o !== '') return { value: String(o), source: 'override' };
    }
    const saved = R.matchSavedAnswer(f.label, profile.answers);
    if (saved) return { value: String(saved), source: 'saved-answer' };
    if (f.key) {
      const v = R.valueForKey(profile, f.key);
      if (v) return { value: v, source: 'profile' };
    }
    return null;
  }

  /**
   * @param {object} opts
   *   profile    normalized profile
   *   files      { resume?: {name,type,dataBase64}, coverLetter?: {...} }
   *   overrides  { [ref|label|profileKey]: value }   answers supplied by Claude
   *   overwrite  replace fields that already have a value (default false)
   */
  function autofill(opts) {
    const profile = JC.normalizeProfile(opts.profile);
    const files = opts.files || {};
    const fields = JC.fields.scan();
    const filled = [];
    const skipped = [];
    const needsInput = [];

    for (const f of fields) {
      const d = JC.fields.describe(f);
      try {
        if (f.key === 'consent') {
          if (!f.hasValue) needsInput.push(Object.assign(d, { reason: 'consent / acknowledgement: confirm with the user' }));
          continue;
        }
        if (f.type === 'file') {
          const kind = f.key === 'coverLetter' ? 'coverLetter' : f.key === 'resume' ? 'resume' : null;
          if (!kind) {
            needsInput.push(Object.assign(d, { reason: 'unrecognized file upload' }));
          } else if (f.hasValue && !opts.overwrite) {
            skipped.push(Object.assign(d, { reason: 'already has a file' }));
          } else if (files[kind] && attachFile(f.el, files[kind])) {
            filled.push(Object.assign(d, { source: kind, value: files[kind].name }));
          } else {
            needsInput.push(Object.assign(d, { reason: `no ${kind} file stored in Job Copilot` }));
          }
          continue;
        }
        if (f.hasValue && !opts.overwrite) {
          skipped.push(Object.assign(d, { reason: 'already filled' }));
          continue;
        }
        const r = resolve(f, profile, opts.overrides);
        if (!r) {
          const reason = f.key ? R.emptyReason(f.key, f.period, profile) : 'custom question';
          // Pay questions always go to Claude/the user, even when optional.
          if (f.required || !f.key || f.key === 'desiredPay') needsInput.push(Object.assign(d, { reason }));
          else skipped.push(Object.assign(d, { reason }));
          continue;
        }
        let ok = false;
        if (f.combobox) {
          // Custom dropdowns (react-select, Workday) need real clicks; leave to Claude.
          needsInput.push(Object.assign(d, { reason: 'custom dropdown: type/click to choose', suggested: r.value }));
          continue;
        } else if (f.type === 'select') ok = fillSelect(f.el, r.value);
        else if (f.els && f.els.length > 1) ok = fillGroup(f, r.value);
        else if (f.type === 'checkbox') ok = fillCheckbox(f, r.value);
        else if (f.type === 'radio') ok = false;
        else if (f.type === 'number') {
          const n = R.toNumberValue(r.value);
          if (n === null) {
            needsInput.push(Object.assign(d, { reason: 'field takes a single number', suggested: r.value }));
            continue;
          }
          setValue(f.el, n);
          ok = true;
        } else {
          setValue(f.el, r.value);
          ok = true;
        }
        if (ok) filled.push(Object.assign(d, { source: r.source, profileKey: f.key }));
        else needsInput.push(Object.assign(d, { reason: 'no option matched', suggested: r.value }));
      } catch (e) {
        needsInput.push(Object.assign(d, { reason: 'error: ' + e.message }));
      }
    }
    return {
      frame: location.href,
      filledCount: filled.length,
      filled: filled.map((f) => ({ label: f.label, selector: f.selector, profileKey: f.profileKey, source: f.source })),
      skipped: skipped.map((f) => ({ label: f.label, selector: f.selector, reason: f.reason })),
      needsInput,
    };
  }

  /** Fill one field chosen by Claude. Accepts selector, ref, or label text. */
  function fillOne({ selector, ref, label, value, check }) {
    let el = null;
    if (ref) el = document.querySelector(`[data-jc-ref="${CSS.escape(ref)}"]`);
    if (!el && selector) el = document.querySelector(selector);
    if (!el && label) {
      const f = JC.fields.scan().find((x) => R.norm(x.label) === R.norm(label)) || JC.fields.scan().find((x) => R.norm(x.label).includes(R.norm(label)));
      el = f && f.el;
      if (f && f.els && f.els.length > 1) {
        return { ok: fillGroup(f, value), selector: `[data-jc-ref="${f.ref}"]` };
      }
    }
    if (!el) return { ok: false, error: 'field not found in this frame' };
    if (el.tagName === 'SELECT') return { ok: fillSelect(el, value) };
    if (el.type === 'checkbox' || el.type === 'radio') {
      setChecked(el, check === undefined ? true : !!check);
      return { ok: true };
    }
    setValue(el, String(value ?? ''));
    return { ok: true };
  }

  JC.autofill = { autofill, fillOne, attachFile, setValue };
})(typeof globalThis !== 'undefined' ? globalThis : self);
