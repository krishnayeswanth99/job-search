/* Job Copilot: DOM helpers shared by the content scripts. */
(function (root) {
  const JC = (root.JC = root.JC || {});

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function isVisible(el) {
    if (!el || !el.getClientRects) return false;
    if (!el.getClientRects().length) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && parseFloat(st.opacity || '1') > 0;
  }

  function text(el) {
    return el ? clean(el.innerText || el.textContent) : '';
  }

  /** First non-empty text among the selectors, searched inside `scope`. */
  function pick(scope, selectors) {
    for (const sel of [].concat(selectors)) {
      let el;
      try {
        el = scope.querySelector(sel);
      } catch (_) {
        continue;
      }
      const t = text(el);
      if (t) return t;
    }
    return '';
  }

  function pickAttr(scope, selectors, attr) {
    for (const sel of [].concat(selectors)) {
      let el;
      try {
        el = scope.querySelector(sel);
      } catch (_) {
        continue;
      }
      const v = el && el.getAttribute(attr);
      if (v) return v;
    }
    return '';
  }

  function absUrl(href, base) {
    if (!href) return '';
    try {
      return new URL(href, base || location.href).href;
    } catch (_) {
      return '';
    }
  }

  /** Text of an element with block structure preserved, capped at `max` chars. */
  function blockText(el, max) {
    if (!el) return '';
    const raw = String(el.innerText || el.textContent || '')
      .replace(/ /g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();
    return max && raw.length > max ? raw.slice(0, max) + '\n…[truncated]' : raw;
  }

  function uniqBy(arr, keyFn) {
    const seen = new Set();
    return arr.filter((x) => {
      const k = keyFn(x);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Find a clickable element whose visible text matches `re`. */
  function findButton(re, scope) {
    const els = (scope || document).querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"]');
    for (const el of els) {
      const t = clean(el.innerText || el.value || el.getAttribute('aria-label'));
      if (t && t.length < 60 && re.test(t) && isVisible(el)) return el;
    }
    return null;
  }

  JC.dom = { clean, isVisible, text, pick, pickAttr, absUrl, blockText, uniqBy, findButton };
})(typeof globalThis !== 'undefined' ? globalThis : self);
