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

  /** The value as this input wants it: <input type=date> takes YYYY-MM-DD. */
  function textValue(f, value) {
    if (f.el && f.el.type === 'date' && f.key === 'todayDate') {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return value;
  }

  /**
   * Set a text value. If the site throws it away (Workday's Month / Day / Year spin boxes only take
   * keystrokes), type it one key at a time instead. Returns whether the field kept it.
   */
  function setText(el, value) {
    setValue(el, value);
    // Kept (maybe reformatted, like a phone number): done. Only an emptied box gets typed into.
    if (fieldText(el) || !String(value) || !(el instanceof HTMLInputElement)) return true;
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    el.focus({ preventScroll: true });
    if (desc && desc.set) desc.set.call(el, '');
    let acc = '';
    for (const ch of String(value)) {
      const k = { bubbles: true, cancelable: true, key: ch, code: /\d/.test(ch) ? 'Digit' + ch : undefined };
      el.dispatchEvent(new KeyboardEvent('keydown', k));
      el.dispatchEvent(new KeyboardEvent('keypress', k));
      acc += ch;
      if (desc && desc.set) desc.set.call(el, acc);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      el.dispatchEvent(new KeyboardEvent('keyup', k));
    }
    fire(el, 'change');
    el.blur();
    fire(el, 'blur');
    return !!fieldText(el);
  }

  /** What a text box shows; spin boxes may keep it in aria-valuenow instead of value. */
  function fieldText(el) {
    if (el.value) return el.value;
    const now = el.getAttribute && el.getAttribute('aria-valuenow');
    return now && /\d/.test(now) ? now : '';
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

  // "How did you hear about us?" lists often only have categories: if the source itself (e.g.
  // LinkedIn) isn't an option, these are tried in order.
  const HEAR_FALLBACKS = ['Job Board', 'Online Job Board', 'Job Posting', 'Job Site', 'Internet', 'Online', 'Social Media', 'Website', 'Company Website', 'Other'];
  const choices = (key, value) =>
    key === 'howDidYouHear'
      ? [value].concat(HEAR_FALLBACKS)
      : key === 'timeZone'
        ? R.timeZoneCandidates(value, new Date().getTimezoneOffset())
        : [value];
  let userCountry = ''; // set per autofill run: picks between countries sharing a dialing code
  function chooseFrom(opts, desiredList, key) {
    if (key === 'phoneCountryCode') return R.choosePhoneCode(opts, desiredList[0], userCountry);
    for (const d of desiredList) {
      const i = R.chooseOption(opts, d);
      if (i >= 0) return i;
    }
    return -1;
  }

  function fillSelect(el, desired, key) {
    const opts = [...el.options].map((o) => ({ value: o.value, text: o.text }));
    const i = key === 'resumeSource' ? R.chooseResumeSource(opts) : chooseFrom(opts, choices(key, desired), key);
    if (i < 0) return false;
    if (el.selectedIndex === i) return true;
    setValue(el, el.options[i].value);
    return true;
  }

  function fillGroup(f, desired) {
    const i = f.key === 'resumeSource' ? R.chooseResumeSource(f.options) : f.key === 'phoneCountryCode' ? R.choosePhoneCode(f.options, desired, userCountry) : R.chooseOption(f.options, desired);
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
  function resolve(f, profile, overrides, resumeText) {
    if (overrides) {
      const o = overrides[f.ref] ?? overrides[f.label] ?? (f.key && overrides[f.key]);
      if (o !== undefined && o !== null && o !== '') return { value: String(o), source: 'override' };
    }
    const saved = R.matchSavedAnswer(f.label, profile.answers, JC.memory ? JC.memory.context() : null);
    if (saved) return { value: String(saved), source: 'saved-answer' };
    if (f.key) {
      const v = R.valueForKey(profile, f.key);
      if (v) return { value: v, source: 'profile' };
    }
    // Yes/no "Have you used Python or Java?": Yes when the resume or skills show it.
    const yesNo = f.type === 'listbox' || (f.options || []).some((o) => /^yes\b/i.test(String(o.text || '').trim()));
    if (!f.key && yesNo) {
      // "Have you ever worked at Applied Materials?": Yes if your resume lists it, else No.
      const was = R.formerEmployerAnswer(f.label, resumeText);
      if (was) return { value: was, source: 'resume' };
      const v = R.evidenceAnswer(f.label, resumeText, (profile.work || {}).skills);
      if (v) return { value: v, source: 'resume' };
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
  async function autofill(opts) {
    const profile = JC.normalizeProfile(opts.profile);
    userCountry = (profile.personal || {}).country || '';
    const profileWins = opts.profileWins !== false;
    const combos = [];
    const files = opts.files || {};
    const filled = [];
    const skipped = [];
    const needsInput = [];
    const corrected = [];
    const guardList = [];
    const review = []; // filled from the profile: the on-device check looks these over
    let parseWaitMs = 0;

    // 1) Upload files first: many sites (iCIMS, Lever, Workday, Ashby) parse the resume and fill the
    //    form themselves. Let them finish, then fill from the profile, so the profile has the last word.
    let fields = JC.fields.scan();
    const fileDone = new Set();
    let attached = false;
    for (const f of fields.filter((x) => x.type === 'file')) {
      fileDone.add(f.ref);
      const d = JC.fields.describe(f);
      const kind = f.key === 'coverLetter' ? 'coverLetter' : f.key === 'resume' ? 'resume' : null;
      if (!kind) needsInput.push(Object.assign(d, { reason: 'unrecognized file upload' }));
      else if (f.hasValue && !opts.overwrite) skipped.push(Object.assign(d, { reason: 'already has a file' }));
      else if (files[kind] && attachFile(f.el, files[kind])) {
        filled.push(Object.assign(d, { source: kind, value: files[kind].name }));
        if (kind === 'resume') attached = true;
      } else needsInput.push(Object.assign(d, { reason: `no ${kind} file stored in Job Copilot` }));
    }
    if (attached && opts.waitForParse !== false) {
      parseWaitMs = await waitForQuiet(9000);
      fields = JC.fields.scan();
    }

    // Work experience / education blocks are filled per entry by JC.sections (below).
    const hs = JC.sections ? JC.sections.headings() : [];
    const inSection = (f) => JC.sections && f.el && f.type !== 'file' && !!JC.sections.kindOf(f.el, hs);
    for (const f of fields) {
      if (f.type === 'file' && fileDone.has(f.ref)) continue;
      if (inSection(f)) continue;
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
        let r = null;
        // A preselected "No thanks, I'll fill it in manually" / "Use LinkedIn" doesn't count as answered.
        const sourceNotUpload =
          f.key === 'resumeSource' && f.hasValue && files.resume && (() => {
            const i = R.chooseResumeSource(f.options || (f.el && f.el.options ? [...f.el.options].map((o) => ({ text: o.text, value: o.value })) : []));
            return i >= 0 && (f.els ? !(f.els[i] && f.els[i].checked) : f.el.selectedIndex !== i);
          })();
        if (f.hasValue && !opts.overwrite && !sourceNotUpload) {
          // Profile fields: if the site (usually its resume parser) put in something that means
          // something different, the profile value replaces it. Answers to other questions are kept.
          r = profileWins && f.key && !f.combobox ? resolve(f, profile, opts.overrides, opts.resumeText) : null;
          const site = currentValue(f);
          if (!r || r.source !== 'profile' || matches(f, site, r.value)) {
            skipped.push(Object.assign(d, { reason: 'already filled' }));
            if (r && r.source === 'profile') guardList.push({ f, value: r.value });
            continue;
          }
          corrected.push({ label: f.label, site: String(site).slice(0, 80) });
        }
        r = r || resolve(f, profile, opts.overrides, opts.resumeText);
        if (f.key === 'resumeSource' && !files.resume) {
          needsInput.push(Object.assign(d, { reason: 'how to give your resume: no resume stored in Job Copilot, choose by hand' }));
          continue;
        }
        if (!r) {
          const reason = f.key ? R.emptyReason(f.key, f.period, profile) : 'custom question';
          // Pay questions always go to Claude/the user, even when optional.
          if (f.required || !f.key || f.key === 'desiredPay') needsInput.push(Object.assign(d, { reason }));
          else skipped.push(Object.assign(d, { reason }));
          continue;
        }
        let ok = false;
        if (f.combobox) {
          // Custom dropdowns (react-select, select2, iCIMS, Workday): handled after the plain fields.
          combos.push({ f, d, r });
          continue;
        } else if (f.type === 'select') ok = fillSelect(f.el, r.value, f.key);
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
          ok = setText(f.el, textValue(f, r.value));
          if (!ok) {
            needsInput.push(Object.assign(d, { reason: 'the site did not take the value', suggested: r.value }));
            continue;
          }
        }
        if (ok) {
          filled.push(Object.assign(d, { source: r.source, profileKey: f.key }));
          if (r.source === 'profile' && !CONSTANT_KEYS.has(f.key)) review.push(reviewItem(f, d));
          if (r.source === 'profile' && !f.combobox) guardList.push({ f, value: r.value });
        } else needsInput.push(Object.assign(d, { reason: 'no option matched', suggested: r.value }));
      } catch (e) {
        needsInput.push(Object.assign(d, { reason: 'error: ' + e.message }));
      }
    }
    // Custom dropdowns: open, type to filter, click the matching option.
    for (const { f, d, r } of combos) {
      let res = { ok: false, seen: [] };
      try {
        res = await fillCombobox(f.el, choices(f.key, r.value), f.key);
      } catch (e) {
        res = { ok: false, seen: [], error: e.message };
      }
      if (res.ok) filled.push(Object.assign(d, { source: r.source, profileKey: f.key, chosen: res.chosen }));
      else
        needsInput.push(
          Object.assign(d, {
            reason: `custom dropdown: ${res.partial ? `picked "${res.partial}" but no matching option in its sub-list, finish by hand` : 'no matching option found, choose by hand'}${res.seen.length ? ` (options seen: ${res.seen.slice(0, 12).join(' | ')})` : ' (no options appeared after clicking it)'}${res.error ? ` [error: ${res.error}]` : ''}`,
            suggested: r.value,
          })
        );
    }
    // Repeatable sections: Add entries and fill them from the profile's work history and schools.
    if (JC.sections && opts.sections !== false) {
      try {
        const sec = await JC.sections.fill(profile);
        const done = new Set(sec.filled.map((x) => x.selector));
        for (const x of sec.filled) filled.push({ label: `${x.section}${x.entry ? ' ' + x.entry : ''}: ${x.label}${x.added ? ' (' + x.added.join(', ') + ')' : ''}`, selector: x.selector, source: 'profile', profileKey: x.section });
        for (let k = needsInput.length - 1; k >= 0; k--) if (done.has(needsInput[k].selector)) needsInput.splice(k, 1);
        needsInput.push(...sec.needsInput);
      } catch (e) {
        needsInput.push({ label: 'Work experience / education', reason: 'error: ' + e.message });
      }
    }
    // Choosing "upload a resume" (Taleo, SuccessFactors…) reveals a follow-up choice and then the
    // file box: answer those as they appear, up to three rounds.
    for (let round = 0; round < 3 && filled.some((x) => x.profileKey === 'resumeSource' && !x._followed); round++) {
      filled.forEach((x) => x.profileKey === 'resumeSource' && (x._followed = true));
      await sleep(1200);
      for (const f of JC.fields.scan()) {
        const d = JC.fields.describe(f);
        const was = needsInput.findIndex((x) => x.ref === d.ref);
        if (f.key === 'resumeSource' && !filled.some((x) => x.ref === d.ref)) {
          if (f.els && f.els.length > 1 ? fillGroup(f, 'Upload') : f.type === 'select' ? fillSelect(f.el, 'Upload', f.key) : false) {
            filled.push(Object.assign(d, { source: 'profile', profileKey: 'resumeSource' }));
            if (was >= 0) needsInput.splice(was, 1);
          }
        } else if (f.type === 'file' && f.key === 'resume' && !f.hasValue && !fileDone.has(f.ref) && files.resume && attachFile(f.el, files.resume)) {
          fileDone.add(f.ref);
          filled.push(Object.assign(d, { source: 'resume', value: files.resume.name }));
          if (was >= 0) needsInput.splice(was, 1);
        }
      }
    }
    highlight(needsInput);
    if (profileWins && guardList.length) guard(guardList, opts.guardMs || 90000);
    return {
      frame: location.href,
      parseWaitMs: parseWaitMs || undefined,
      corrected,
      filledCount: filled.length,
      filled: filled.map((f) => ({ label: f.label, selector: f.selector, profileKey: f.profileKey, source: f.source })),
      skipped: skipped.map((f) => ({ label: f.label, selector: f.selector, reason: f.reason })),
      needsInput,
      // Fields to double-check (labels, types and option texts only, never values). Matches made
      // from attributes or learned labels come first: they are the likeliest to be wrong.
      review: review.sort((a, b) => b.weak - a.weak).slice(0, 15),
    };
  }

  // Keys whose value doesn't come from the applicant's data (nothing for a model to check).
  const CONSTANT_KEYS = new Set(['resumeSource', 'phoneType', 'timeZone', 'todayDate', 'todayMonth', 'todayDay', 'todayYear', 'howDidYouHear', 'howDidYouHearDetail']);
  function reviewItem(f, d) {
    return { ref: d.ref, selector: d.selector, label: d.label, type: d.type, options: d.options, maxLength: d.maxLength, profileKey: f.key, weak: !!(f.learned || f.via === 'attribute') };
  }

  /**
   * Apply what the on-device check found: refill a field from the profile field it named, or for
   * "none" clear it (only matches made from attributes or learned labels) and outline it for you.
   * Fields you've touched are left alone.
   */
  function applyReview(fixes, profile) {
    profile = JC.normalizeProfile(profile);
    const changed = [];
    const flagged = [];
    for (const fx of fixes || []) {
      const el = document.querySelector(`[data-jc-ref="${fx.ref}"]`);
      if (!el || touched.has(el)) continue;
      const sel = `[data-jc-ref="${fx.ref}"]`;
      if (fx.to === 'none') {
        if (fx.weak && el.tagName !== 'SELECT') {
          unguard.add(el);
          setValue(el, '');
          changed.push({ label: fx.label, from: fx.from, to: 'empty' });
        } else flagged.push({ label: fx.label, from: fx.from });
        highlight([{ selector: sel, type: el.type, reason: 'on-device AI: this may not be the right answer, please check' }]);
        continue;
      }
      const value = R.valueForKey(profile, fx.to);
      if (!value) continue;
      const ok = el.tagName === 'SELECT' ? fillSelect(el, value, fx.to) : setText(el, value);
      if (ok) {
        regard.set(el, value);
        changed.push({ label: fx.label, from: fx.from, to: fx.to });
      }
    }
    for (const c of changed) if (JC.recorder && JC.recorder.note) JC.recorder.note({ step: 'on-device AI corrected a field', field: c.label, from: c.from, to: c.to });
    for (const c of flagged) if (JC.recorder && JC.recorder.note) JC.recorder.note({ step: 'on-device AI flagged a field for you to check', field: c.label, from: c.from });
    return { changed, flagged };
  }

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  /** What the field shows now, as text (selected option text for choices). */
  function currentValue(f) {
    if (f.els && f.els.length > 1) {
      const c = f.els.find((e) => e.checked);
      return c ? JC.fields.labelFor(c) || c.value : '';
    }
    if (f.type === 'select') return f.el.selectedIndex > 0 || f.el.value ? (f.el.options[f.el.selectedIndex] || {}).text || '' : '';
    if (f.type === 'checkbox') return f.el.checked ? 'yes' : 'no';
    if (f.type === 'listbox') return f.listboxEmpty ? '' : f.listboxText || '';
    return fieldText(f.el);
  }

  /** Does what the field shows already mean our value? */
  function matches(f, site, ours) {
    if (f.type === 'select') {
      const opts = [...f.el.options].map((o) => ({ value: o.value, text: o.text }));
      const i = chooseFrom(opts, choices(f.key, ours), f.key);
      return i < 0 || i === f.el.selectedIndex; // no matching option: nothing better to put there
    }
    if (f.els && f.els.length > 1) {
      const i = R.chooseOption(f.options, ours);
      return i < 0 || !!(f.els[i] && f.els[i].checked);
    }
    if (f.type === 'checkbox') return true;
    if (/^today(Month|Day)$/.test(f.key || '')) return String(site).replace(/^0+/, '') === String(ours).replace(/^0+/, '');
    return R.sameValue(f.key, site, ours);
  }

  /** Wait until the form stops changing (a site's resume parser filling fields), up to maxMs. */
  async function waitForQuiet(maxMs) {
    const t0 = Date.now();
    const snap = () => [...document.querySelectorAll('input, select, textarea')].map((e) => (e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.value)).join('\u0001');
    let last = snap();
    let stableSince = Date.now();
    await sleep(800); // parsing usually starts after an upload request
    while (Date.now() - t0 < maxMs) {
      await sleep(300);
      const now = snap();
      if (now !== last) {
        last = now;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= 1500) break;
    }
    return Date.now() - t0;
  }

  // Fields the user has typed in, picked or pasted into: never touched again by the guard.
  const touched = new WeakSet();
  if (typeof document !== 'undefined') {
    for (const type of ['keydown', 'paste', 'mousedown', 'input', 'change']) {
      document.addEventListener(
        type,
        (e) => {
          if (e.isTrusted && e.target && e.target.nodeType === 1) touched.add(e.target.closest('input, select, textarea') || e.target);
        },
        true
      );
    }
  }

  /**
   * After filling: for a while, if the SITE changes a field we filled from the profile (a late
   * resume parser, a re-render), put the profile value back. Stops for a field as soon as the user
   * edits it. Corrections are logged in the debug log.
   */
  let guardTimer = null;
  const unguard = new WeakSet(); // cleared on the on-device check's advice: don't put it back
  const regard = new WeakMap(); // refilled on its advice: keep this value instead
  function guard(list, ms) {
    clearInterval(guardTimer);
    const end = Date.now() + ms;
    const items = list.map(({ f, value }) => ({ el: f.el, f, key: f.key, label: f.label, value }));
    guardTimer = setInterval(() => {
      if (Date.now() > end) return clearInterval(guardTimer);
      let fresh = null;
      for (const it of items) {
        if (touched.has(it.el) || unguard.has(it.el)) continue;
        if (regard.has(it.el)) it.value = regard.get(it.el);
        if (!it.el.isConnected) {
          // The site re-rendered the section: find the same question again.
          fresh = fresh || JC.fields.scan();
          const again = fresh.find((x) => x.key === it.key && x.label === it.label);
          if (!again) continue;
          it.el = again.el;
          it.f = again;
        }
        if (it.gaveUp) continue;
        const site = currentValue(it.f);
        if (matches(it.f, site, it.value)) continue;
        // The site keeps clearing it (it doesn't accept the value, or shows it somewhere else):
        // stop after two tries instead of fighting it every 0.7 s.
        if ((it.tries = (it.tries || 0) + 1) > 2) {
          it.gaveUp = true;
          if (JC.recorder && JC.recorder.note) JC.recorder.note({ step: 'stopped restoring: the site keeps changing this field, check it by hand', field: it.label, site: String(site).slice(0, 60) });
          continue;
        }
        if (it.f.type === 'select') fillSelect(it.el, it.value, it.key);
        else if (it.f.els && it.f.els.length > 1) fillGroup(it.f, it.value);
        else setText(it.el, textValue(it.f, it.value));
        if (JC.recorder && JC.recorder.note) JC.recorder.note({ step: 'restored profile value the site had changed', field: it.label, site: String(site).slice(0, 60) });
      }
    }, 700);
  }
  const fireMouse = (el) => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const Ev = type.startsWith('pointer') && typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, view: window }));
    }
  };

  /** Type into a search box without blurring it (blur closes most dropdown menus). */
  function typeInto(el, value) {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    el.focus({ preventScroll: true });
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) || 'a' }));
    // Workday prompt pickers only search when you press Enter (and search every level at once).
    if (value && el.closest('[data-automation-id="multiselectInputContainer"], [data-uxi-widget-type="selectinput"], [data-automation-id="searchBox"]')) {
      for (const type of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
    }
  }

  const OPTION_SEL = '[role="option"], .select2-results__option, li[class*="option" i], div[class*="option" i]:not(:has(div[class*="option" i])), .dropdown-menu li, ul[role="listbox"] li, [class*="listbox" i] li, [data-automation-id="promptOption"]';

  function visibleOptions() {
    return [...document.querySelectorAll(OPTION_SEL)].filter((o) => JC.dom.isVisible(o) && JC.dom.clean(o.innerText).length && !o.closest('select')).slice(0, 300);
  }

  /**
   * Fill a custom dropdown: click its control, type the value to filter when it has a search box,
   * then click the option that best matches (same matching as native selects). Escape on no match.
   */
  // Anything that could be an option in an opened menu (iCIMS, select2, MUI, Ant, react-select…).
  const MENU_ITEM_SEL = OPTION_SEL + ', li, [role="menuitem"], [role="treeitem"], [class*="result" i], [class*="item" i] a, a[class*="option" i]';
  function visibleMenuItems() {
    return [...document.querySelectorAll(MENU_ITEM_SEL)]
      .filter((o) => !o.closest('select') && JC.dom.isVisible(o))
      .filter((o) => {
        const t = JC.dom.clean(o.innerText);
        return t && t.length <= 100;
      })
      .slice(0, 1500);
  }

  async function fillCombobox(el, desiredList, key) {
    desiredList = [].concat(desiredList).filter(Boolean);
    const control =
      el.closest('[role="combobox"], .select2-container, .select2, [class*="select__control"], [class*="Select-control"], [class*="dropdown" i], [class*="Dropdown"]') ||
      (el.id && document.querySelector(`[aria-controls="${CSS.escape(el.id)}"], [aria-owns="${CSS.escape(el.id)}"]`)) ||
      el;
    const before = new Set(visibleMenuItems());
    fireMouse(control);
    if (control !== el) fireMouse(el);
    await sleep(350);
    // Options = what newly appeared after the click (works whatever the menu's markup), plus known option markup.
    const collect = () => {
      const fresh = visibleMenuItems().filter((o) => !before.has(o));
      const known = visibleOptions();
      const all = [...new Set(known.concat(fresh))];
      // Prefer the innermost element for each text (li > a > span all carry the same text).
      return all.filter((o) => !all.some((x) => x !== o && o.contains(x) && JC.dom.clean(x.innerText) === JC.dom.clean(o.innerText)));
    };
    let opts = collect();
    const search = (el.tagName === 'INPUT' && !el.readOnly && el.type !== 'hidden' ? el : null) || document.querySelector('.select2-search__field, input[role="searchbox"], input[aria-autocomplete="list"]:focus, [class*="dropdown" i] input[type="text"]:not([readonly])');
    const texts = () => opts.map((o) => ({ text: JC.dom.clean(o.innerText), value: o.getAttribute('data-value') || o.getAttribute('id') || '' }));
    const canSearch = () => search && JC.dom.isVisible(search);
    // 1) The exact value (e.g. "LinkedIn"), on screen or found by typing it. Typing searches every
    //    level of Workday's nested pickers. 2) Only then the fallbacks ("Job Board", "Other"…).
    let i = chooseFrom(texts(), desiredList.slice(0, 1), key);
    if (i < 0 && canSearch()) {
      // Phone codes: search by country name ("+1" matches several countries, or nothing).
      typeInto(search, String(key === 'phoneCountryCode' && userCountry ? userCountry : desiredList[0]).slice(0, 40));
      await sleep(700);
      opts = collect();
      i = chooseFrom(texts(), desiredList.slice(0, 1), key);
      if (i < 0) {
        typeInto(search, '');
        await sleep(400);
        opts = collect();
      }
    }
    if (i < 0) i = chooseFrom(texts(), desiredList, key);
    if (i < 0 && canSearch()) {
      for (const d of desiredList.slice(1, 3)) {
        typeInto(search, String(d).slice(0, 40));
        await sleep(600);
        opts = collect();
        i = chooseFrom(texts(), desiredList, key);
        if (i >= 0) break;
      }
      if (i < 0) {
        typeInto(search, '');
        await sleep(400);
        opts = collect();
        i = chooseFrom(texts(), desiredList, key);
      }
    }
    const seen = texts().map((t) => t.text).filter(Boolean);
    const escape = () => {
      // Inside a modal, Escape or a click outside closes the modal itself ("Are you sure you want
      // to exit?"): click a neutral spot inside it (its heading) instead.
      const dlg = el.closest('[role="dialog"], dialog');
      if (dlg) {
        fireMouse(dlg.querySelector('h1, h2, h3, [id*="title" i]') || dlg);
        return;
      }
      document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      fireMouse(document.body);
    };
    if (i < 0) {
      escape();
      return { ok: false, seen };
    }
    // Multi-level menus (Workday "How did you hear": category -> source). Picking a category shows
    // a new list instead of closing. Look for the exact value in each category first; only if no
    // category has it, settle for a fallback ("Other"…) in the first one tried.
    const tried = [];
    const descend = async (idx, strict) => {
      const path = [];
      for (let level = 0; level < 3; level++) {
        const prev = new Set(texts().map((t) => t.text));
        path.push(JC.dom.clean(opts[idx].innerText));
        fireMouse(opts[idx]);
        await sleep(level ? 350 : 450);
        opts = collect();
        const now = texts();
        const added = now.filter((t) => t.text && !prev.has(t.text));
        if (!now.length || added.length < Math.max(1, now.length / 2)) {
          if (level && now.length) escape(); // nested pickers stay open after the pick: close them
          return { done: true, path }; // closed, or a leaf
        }
        idx = chooseFrom(now, strict ? desiredList.slice(0, 1) : desiredList.concat(["Other"]), key);
        if (idx < 0) return { done: false, path, seen: now.map((t) => t.text).filter(Boolean) };
      }
      return { done: true, path };
    };
    const reopen = async () => {
      escape();
      await sleep(200);
      fireMouse(control);
      if (control !== el) fireMouse(el);
      await sleep(400);
      opts = collect();
    };
    let res = await descend(i, desiredList.length > 1);
    if (res.done) return { ok: true, chosen: res.path.join(' > '), seen };
    const first = res.path[0];
    tried.push(first);
    for (let n = 0; n < 5 && desiredList.length > 1; n++) {
      await reopen();
      const left = texts().map((t, k) => (tried.includes(t.text) ? null : Object.assign({ k }, t)));
      const j = chooseFrom(left.map((t) => t || { text: '', value: '' }), desiredList.slice(1), key);
      if (j < 0) break;
      tried.push(texts()[j].text);
      res = await descend(j, true);
      if (res.done) return { ok: true, chosen: res.path.join(' > '), seen };
    }
    if (desiredList.length > 1) {
      // No category has the exact value: back to the first one, take its "Other" or closest fallback.
      await reopen();
      const k = texts().findIndex((t) => t.text === first);
      if (k >= 0) {
        res = await descend(k, false);
        if (res.done) return { ok: true, chosen: res.path.join(' > '), seen };
      }
    }
    escape();
    return { ok: false, partial: res.path.join(' > '), seen: res.seen || seen };
  }

  /**
   * Outline the questions autofill couldn't answer, so the user (or Claude in the side panel) sees
   * what's left. Outlines don't change layout; each one goes away once the field has a value.
   */
  function highlight(items) {
    for (const it of items) {
      const el = it.selector && document.querySelector(it.selector);
      if (!el || it.type === 'hidden') continue;
      const target = it.type === 'radio' || it.type === 'checkbox' ? el.closest('fieldset, [role="radiogroup"], .field, .application-question') || el : el;
      target.style.outline = '2px solid #7c3aed';
      target.style.outlineOffset = '2px';
      target.setAttribute('data-jc-needs-input', it.reason || 'needs your answer');
      if (!target.title) target.title = 'Job Copilot: needs your answer';
      const clear = () => {
        target.style.outline = '';
        target.style.outlineOffset = '';
        target.removeAttribute('data-jc-needs-input');
      };
      el.addEventListener('change', clear, { once: true });
      el.addEventListener('input', clear, { once: true });
    }
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

  JC.autofill = { autofill, fillOne, attachFile, setValue, setText, fillSelect, fillCombobox, applyReview };
})(typeof globalThis !== 'undefined' ? globalThis : self);
