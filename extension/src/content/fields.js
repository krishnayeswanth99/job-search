/*
 * Job Copilot: form field discovery.
 * Finds fillable controls in the current frame, works out a human label for
 * each, classifies it against the profile, and tags it with a stable
 * `data-jc-ref` attribute so Claude can target it with a CSS selector.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});
  const { isVisible, clean } = JC.dom;

  const FRAME_TOKEN = Math.random().toString(36).slice(2, 6);
  let refCounter = 0;

  function ref(el) {
    let r = el.getAttribute('data-jc-ref');
    if (!r) {
      r = `jc-${FRAME_TOKEN}-${++refCounter}`;
      el.setAttribute('data-jc-ref', r);
    }
    return r;
  }

  function textOf(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, script, style, option, [aria-hidden="true"]').forEach((n) => n.remove());
    return clean(clone.textContent);
  }

  function byIds(ids) {
    return clean(
      String(ids || '')
        .split(/\s+/)
        .map((id) => textOf(document.getElementById(id)))
        .join(' ')
    );
  }

  /** Best-effort human label for a control. */
  const PROMPT_SEL = '[data-automation-id="multiselectInputContainer"], [data-uxi-widget-type="selectinput"]';

  function labelFor(el) {
    const tries = [];
    if (el.getAttribute('aria-labelledby')) tries.push(byIds(el.getAttribute('aria-labelledby')));
    if (el.id) {
      try {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l) tries.push(textOf(l));
      } catch (_) {
        /* invalid id */
      }
    }
    const wrap = el.closest('label');
    if (wrap) tries.push(textOf(wrap.querySelector('.application-label, .text, span, div') || wrap));
    if (el.getAttribute('aria-label')) tries.push(clean(el.getAttribute('aria-label')));

    // Common ATS question containers, most specific first (the nearest ancestor is often just an
    // input wrapper such as Lever's .application-field, which holds no label).
    for (const sel of ['.application-question', '.field', '[data-automation-id^="formField"]', '[class*="fieldEntry"]', '[class*="FormField"]', '.form-group', '.form-field', '.question', 'fieldset', 'li']) {
      const container = el.closest(sel);
      if (!container) continue;
      const lab = container.querySelector('label, legend, .application-label, [class*="label" i], h3, h4, p');
      if (lab && !lab.contains(el) && textOf(lab)) {
        tries.push(textOf(lab));
        break;
      }
    }
    // Previous sibling text (unlabelled inputs that follow a <p> or <div>).
    let prev = el.previousElementSibling;
    for (let i = 0; i < 2 && prev; i++, prev = prev.previousElementSibling) {
      const t = textOf(prev);
      if (t) {
        tries.push(t);
        break;
      }
    }
    // Labels that are just text above the field, not linked to it (Gem, many custom forms):
    // the nearest short text before the field's wrapper.
    if (!tries.length) {
      const t = precedingText(el);
      if (t) tries.push(t);
    }
    if (el.placeholder) tries.push(clean(el.placeholder));
    const best = tries
      .map((t) => t.replace(/\s+(select one|select|choose one)(\s+required)?\s*$/i, '').replace(/\s*\*\s*$/, '').trim())
      .find((t) => t && t.length <= 300);
    return best || '';
  }

  /**
   * The nearest short text that comes before `node`: a previous sibling of the node or of one of its
   * wrappers (up to five levels up) that holds no form controls itself.
   */
  function precedingText(node) {
    let a = node;
    for (let up = 0; up < 6 && a && a !== document.body; up++, a = a.parentElement) {
      let prev = a.previousElementSibling;
      for (let i = 0; i < 3 && prev; i++, prev = prev.previousElementSibling) {
        if (prev.matches('input, select, textarea, button') || prev.querySelector('input:not([type="hidden"]), select, textarea')) break;
        const t = textOf(prev);
        if (t && t.length >= 2 && t.length <= 200) return t;
      }
    }
    return '';
  }

  function isRequired(el, label) {
    return !!(el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$|\*\s|required/i.test(label || ''));
  }

  /**
   * Returns an array of field descriptors:
   * { ref, el, els?, tag, type, label, name, required, options?, key?, hasValue }
   */
  function scan() {
    const out = [];
    const groups = new Map(); // radio/checkbox groups keyed by name

    // An open modal with form fields (ZipRecruiter 1-Click Apply, LinkedIn Easy Apply, Indeed…):
    // only its fields count, never the page behind it.
    // Cookie / privacy windows don't count: they only hold checkboxes and toggles.
    const modal = [...document.querySelectorAll('[role="dialog"][aria-modal="true"], dialog[open], [role="dialog"]')].find(
      (d) => isVisible(d) && d.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea, select, button[aria-haspopup="listbox"]') && !/\b(cookies?|privacy (preferences|settings|choices)|consent preferences)\b/i.test((d.innerText || '').slice(0, 400))
    );
    const controls = (modal || document).querySelectorAll('input, textarea, select');
    for (const el of controls) {
      // The site's own search / header boxes are never part of an application.
      if (el.closest('header, nav, [role="search"], [role="banner"], [role="navigation"]') && !el.closest('form[action*="apply" i], [role="dialog"]')) continue;
      const type = (el.type || el.tagName).toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'search'].includes(type)) continue;
      if (el.disabled) continue;
      // Read-only inputs are skipped, except custom dropdowns (you click them to pick an option).
      if (el.readOnly && !(el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') || el.closest('[role="combobox"]'))) continue;
      if (el.closest('[aria-hidden="true"]') && type !== 'file') continue;
      if (type !== 'file' && !isVisible(el)) {
        // react-select & custom checkboxes hide the real input; keep them if their wrapper is visible.
        const vis = el.closest('label, [class*="select" i], [role="combobox"]');
        if (!vis || !isVisible(vis)) continue;
      }

      // Radios without a name (Gem and other custom forms): grouped by the wrapper they share.
      if (type === 'radio' && !el.name) {
        let c = el.parentElement;
        for (let up = 0; up < 6 && c && c.querySelectorAll('input[type="radio"]').length < 2; up++) c = c.parentElement;
        if (c && c.querySelectorAll('input[type="radio"]').length >= 2) {
          const k = 'box|' + ref(c) + '|radio';
          const g = groups.get(k);
          if (g) {
            g.els.push(el);
            continue;
          }
          const entry = { type, tag: 'input', name: '', els: [el], el, box: c };
          groups.set(k, entry);
          out.push(entry);
          continue;
        }
      }
      if ((type === 'radio' || type === 'checkbox') && el.name) {
        const g = groups.get(el.name + '|' + type);
        if (g) {
          g.els.push(el);
          continue;
        }
        const entry = { type, tag: 'input', name: el.name, els: [el], el };
        groups.set(el.name + '|' + type, entry);
        out.push(entry);
        continue;
      }

      out.push({
        el,
        tag: el.tagName.toLowerCase(),
        type: el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : type,
        name: el.name || '',
        combobox: el.getAttribute('role') === 'combobox' || !!el.closest('[role="combobox"], [class*="select__control"], [class*="Select-control"]') || !!el.closest(PROMPT_SEL),
        // Workday prompt pickers clear their search box after a pick and show the choice as a pill.
        picked: !!(el.closest(PROMPT_SEL) && el.closest(PROMPT_SEL).parentElement.querySelector('[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"] li')),
      });
    }

    // Dropdowns built from buttons/divs (Workday "Select One" buttons, ARIA comboboxes without an input).
    const PLACEHOLDER_TEXT = /^(select( one)?|choose( one)?|please select|--|—|make a selection|none selected)\b/i;
    for (const el of (modal || document).querySelectorAll('button[aria-haspopup="listbox"], [role="combobox"]:not(input):not(:has(input))')) {
      if (el.closest('header, nav, [role="search"], [role="banner"], [role="navigation"]') && !el.closest('[role="dialog"]')) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true' || !isVisible(el) || el.closest('[aria-hidden="true"]')) continue;
      const text = clean(el.innerText || el.textContent);
      out.push({ el, tag: el.tagName.toLowerCase(), type: 'listbox', name: el.getAttribute('name') || '', combobox: true, listboxText: text, listboxEmpty: !text || PLACEHOLDER_TEXT.test(text) });
    }

    const profileHints = [];
    for (const f of out) {
      const el = f.el;
      if (f.els && f.els.length > 1) {
        // Group label: fieldset legend or nearest question container.
        const fs = el.closest('fieldset');
        const container = el.closest('.field, .application-question, [data-automation-id^="formField"], [class*="fieldEntry"], .form-group, .question, [role="radiogroup"], [role="group"]');
        f.label =
          (fs && textOf(fs.querySelector('legend'))) ||
          (f.box && !fs && precedingText(f.box)) ||
          (container && textOf(container.querySelector('label:not(:has(input)), legend, .application-label, [class*="label" i], p'))) ||
          (el.closest('[role="radiogroup"], [role="group"]') && clean(el.closest('[role="radiogroup"], [role="group"]').getAttribute('aria-label'))) ||
          labelFor(el);
        f.options = f.els.map((o) => ({ value: o.value, text: labelFor(o) || o.value }));
        f.required = f.els.some((o) => o.required) || isRequired(el, f.label);
        f.hasValue = f.els.some((o) => o.checked);
      } else {
        f.label = labelFor(el);
        f.required = isRequired(el, f.label);
        if (f.type === 'select') f.options = [...el.options].map((o) => ({ value: o.value, text: clean(o.text) }));
        if (f.type === 'checkbox' || f.type === 'radio') f.hasValue = el.checked;
        else if (f.type === 'file') f.hasValue = !!(el.files && el.files.length);
        else if (f.type === 'listbox') f.hasValue = !f.listboxEmpty;
        else f.hasValue = !!f.picked || !!String(el.value || '').trim() && !(f.type === 'select' && el.selectedIndex <= 0 && !el.value);
      }
      f.ref = ref(el);
      if (f.els) f.els.forEach(ref);
      const c = JC.rules.classifyField({
        label: f.label,
        name: f.name,
        id: el.id,
        placeholder: el.placeholder,
        ariaLabel: el.getAttribute('aria-label'),
        autocomplete: el.getAttribute('autocomplete'),
        automationId: el.getAttribute('data-automation-id') || (el.closest('[data-automation-id]') || { getAttribute: () => '' }).getAttribute('data-automation-id'),
        type: f.type,
        tag: f.tag,
        optionsText: (f.options || []).slice(0, 12).map((o) => o.text).join(' | '),
      });
      // A label learned from another autofill (e.g. "Contact No." -> phone) when no rule knows it.
      if (!c && JC.learn) {
        const lk = JC.learn.keyForLabel(f.label);
        if (lk) {
          f.key = lk;
          f.learned = true;
          profileHints.push(lk);
        }
      }
      if (c) {
        f.key = c.key;
        f.via = c.via;
        if (c.period) f.period = c.period;
        profileHints.push(c.key);
      }
    }
    return contextKeys(out);
  }

  /** Labels that only make sense next to the field before them: "Type" after a phone number. */
  function contextKeys(fields) {
    // An upload box with no readable label that takes PDF / Word files, on a form with no other
    // resume upload: the resume (a second unlabelled one is left alone, it may be a cover letter).
    if (!fields.some((f) => f.key === 'resume')) {
      const docs = fields.filter((f) => f.type === 'file' && !f.key && /pdf|msword|wordprocessingml|\.docx?/i.test((f.el && f.el.accept) || ''));
      if (docs.length && !/cover|letter|transcript|portfolio|writing sample/i.test(docs[0].label || '')) docs[0].key = 'resume';
    }
    for (let i = 1; i < fields.length; i++) {
      const f = fields[i];
      const prev = fields[i - 1];
      if (!f.key && /^(type|number type|phone type)$/i.test((f.label || '').trim()) && prev && (prev.key === 'phone' || prev.key === 'phoneCountryCode')) f.key = 'phoneType';
      // "Please specify" right after "Source / How did you hear about us?": the specific site (e.g. LinkedIn).
      if (!f.key && /^(please specify|specify|if other,? please specify|which (one|site|job board)\??|other source|source details?)$/i.test((f.label || '').trim().replace(/[*:]+$/, '').trim()) && prev && prev.key === 'howDidYouHear') f.key = 'howDidYouHearDetail';
    }
    return fields;
  }

  /** Heuristic: does this frame contain a job application form? */
  function looksLikeApplication(fields) {
    fields = fields || scan();
    const keys = new Set(fields.map((f) => f.key).filter(Boolean));
    const strong = ['resume', 'firstName', 'lastName', 'fullName', 'email', 'phone', 'linkedin'].filter((k) => keys.has(k)).length;
    return keys.has('resume') ? strong >= 2 : strong >= 3;
  }

  /** Serializable view of a field (no element references, never any profile values). */
  function describe(f) {
    const d = { ref: f.ref, selector: `[data-jc-ref="${f.ref}"]`, label: f.label, type: f.type, required: !!f.required, hasValue: !!f.hasValue };
    if (f.key) d.profileKey = f.key;
    if (f.period) d.payPeriod = f.period;
    if (f.combobox) d.combobox = true;
    if (f.el && f.el.maxLength > 0 && f.el.maxLength < 100000) d.maxLength = f.el.maxLength;
    if (f.options) d.options = f.options.slice(0, 50).map((o) => o.text).filter(Boolean);
    if (f.els && f.els.length > 1) d.optionSelectors = f.els.map((o) => `[data-jc-ref="${o.getAttribute('data-jc-ref')}"]`);
    return d;
  }

  JC.fields = { scan, describe, labelFor, looksLikeApplication, FRAME_TOKEN };
})(typeof globalThis !== 'undefined' ? globalThis : self);
