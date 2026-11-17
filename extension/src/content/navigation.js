/*
 * Job Copilot: getting from a job listing to the real application form.
 *
 * Job boards and aggregators (LinkedIn, Indeed, Glassdoor, Jobright, ZipRecruiter,
 * Simplify, ...) rarely host the form. Their Apply button may:
 *   - open the employer's ATS in a NEW TAB (often via a tracking redirect URL),
 *   - show an interstitial first ("You're leaving LinkedIn" / "Continue to company site"),
 *   - run an on-site flow instead (LinkedIn Easy Apply, Indeed Apply),
 *   - and, when you come back, ask "Did you apply?".
 *
 *   JC.nav.applyInfo()      -> { text, kind: 'easy-apply'|'external'|'onsite', href, target, newTab, selector }
 *   JC.nav.redirectInfo()   -> { target, via } | null    (this page is just a redirect hop)
 *   JC.nav.interstitial()   -> { text, button, selector } | null
 *   JC.nav.appliedPrompt()  -> { text, yes, no, yesSelector, noSelector } | null
 *   JC.nav.followApply()    -> navigates THIS tab to the real application when the target is known
 */
(function (root) {
  const JC = (root.JC = root.JC || {});
  const { clean, isVisible, absUrl } = JC.dom;

  const APPLY_RE = /^(easy apply|quick apply|1-click apply|apply now|apply here|apply|apply for this (job|position|role)|apply on (the )?(company|employer)('s)? (site|website)|apply on company|apply externally|continue to apply|i'?m interested|submit application|apply with [a-z]+)\b/i;
  const EASY_RE = /(easy apply|quick apply|1-click apply|easily apply|indeed apply|apply with indeed)/i;
  const EXTERNAL_RE = /(company('s)? (site|website)|employer('s)? (site|website)|externally|external site|on [a-z0-9 .&-]+ website)/i;
  const TARGET_PARAMS = ['url', 'u', 'dest', 'destination', 'target', 'targeturl', 'redirect', 'redirect_url', 'redirecturl', 'to', 'link', 'joburl', 'apply_url', 'applyurl', 'r', 'q'];
  // Known redirect hops (the page itself is only a bounce to the employer site).
  const REDIRECT_HOPS = [
    /linkedin\.com\/(redir\/redirect|safety\/go)/i,
    /indeed\.[a-z.]+\/(applystart|rc\/clk|pagead\/clk)/i,
    /glassdoor\.[a-z.]+\/partner\/joblisting/i,
    /ziprecruiter\.com\/(clk|ekr|job-redirect)/i,
    /simplify\.jobs\/(redirect|r)\//i,
    /jobright\.ai\/(redirect|apply)\b/i,
  ];

  let refN = 0;
  function ref(el) {
    let r = el.getAttribute('data-jc-ref');
    if (!r) {
      r = `jc-nav-${Date.now().toString(36)}-${++refN}`;
      el.setAttribute('data-jc-ref', r);
    }
    return `[data-jc-ref="${r}"]`;
  }

  const label = (el) => clean(el.innerText || el.value || '') || clean(el.getAttribute('aria-label') || '');

  /** If a URL carries the real destination in a query param, return it (decoded, possibly twice). */
  function resolveTarget(href) {
    if (!href) return '';
    let u;
    try {
      u = new URL(href, location.href);
    } catch (_) {
      return href;
    }
    for (const [k, v] of u.searchParams) {
      if (!TARGET_PARAMS.includes(k.toLowerCase())) continue;
      let t = v;
      for (let i = 0; i < 2 && /^https?%3A/i.test(t); i++) t = decodeURIComponent(t);
      if (/^https?:\/\//i.test(t)) return t;
    }
    return u.href;
  }

  function hostOf(u) {
    try {
      return new URL(u, location.href).hostname.replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  }

  function candidates(scope) {
    const rootEl = (scope && document.querySelector(scope)) || document;
    const els = [...rootEl.querySelectorAll('a[href], button, [role="button"], input[type="submit"], input[type="button"]')];
    return els.filter((el) => {
      const t = label(el);
      const aria = clean(el.getAttribute('aria-label') || '');
      return ((t && t.length < 70 && APPLY_RE.test(t)) || (aria && /^(easy )?apply\b/i.test(aria))) && isVisible(el) && !el.closest('[aria-hidden="true"]');
    });
  }

  function applyInfo(scope) {
    const list = candidates(scope);
    if (!list.length) {
      if (document.querySelector('#indeedApplyButton, .indeed-apply-button')) return { text: 'Apply now', kind: 'easy-apply', href: '', target: '', newTab: false, selector: ref(document.querySelector('#indeedApplyButton, .indeed-apply-button')) };
      return null;
    }
    // Prefer the most specific button (external/easy wording) over a generic "Apply" in a list card.
    const UPSELL = /(autofill|customi[sz]|tailor|optimi[sz]e|with (jobright|simplify|ai)|upgrade|premium)/i;
    const score = (el) =>
      (EASY_RE.test(label(el) + ' ' + (el.getAttribute('aria-label') || '')) ? 3 : 0) +
      (EXTERNAL_RE.test((el.getAttribute('aria-label') || '') + ' ' + label(el)) ? 3 : 0) +
      (el.closest('[class*="top-card" i], [class*="header" i], main') ? 1 : 0) -
      (UPSELL.test(label(el)) ? 4 : 0); // prefer plain "Apply" over an aggregator's own autofill/AI button
    const el = list.sort((a, b) => score(b) - score(a))[0];
    const text = label(el);
    const aria = clean(el.getAttribute('aria-label') || '');
    const href = el.tagName === 'A' ? absUrl(el.getAttribute('href')) : el.form && el.form.action ? '' : '';
    const target = href && !/^javascript:/i.test(href) ? resolveTarget(href) : '';
    let kind = 'onsite';
    if (EASY_RE.test(text + ' ' + aria) || el.id === 'indeedApplyButton') kind = 'easy-apply';
    else if (EXTERNAL_RE.test(aria + ' ' + text)) kind = 'external';
    else if (target && hostOf(target) && hostOf(target) !== location.hostname.replace(/^www\./, '')) kind = 'external';
    // On aggregators (Jobright, Simplify, ZipRecruiter...) Apply always leads to the employer's site.
    const portal = JC.portalForHost(location.hostname);
    if (kind === 'onsite' && portal && portal.aggregator) kind = 'external';
    // Scripted Apply button: the employer URL is often in the page's embedded data.
    let found = null;
    if (!target && !scope && portal && portal.aggregator && JC.applyLinks) found = JC.applyLinks.findIn(document.documentElement.innerHTML);
    if (found) return { text, kind, href, target: found.url, targetVia: found.via, newTab: true, selector: ref(el), aria: aria || undefined };
    const newTab = el.getAttribute('target') === '_blank' || (kind === 'external' && !target);
    return { text, kind, href, target, newTab, selector: ref(el), aria: aria || undefined };
  }

  function redirectInfo() {
    const href = location.href;
    const hop = REDIRECT_HOPS.find((re) => re.test(href));
    const target = resolveTarget(href);
    if (hop) return { via: location.hostname, target: target !== href ? target : '' };
    // Generic: a near-empty page whose URL carries the destination.
    if (target !== href && (document.body ? clean(document.body.innerText).length : 0) < 400) return { via: location.hostname, target };
    return null;
  }

  function dialogs() {
    return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"], .modal, .artdeco-modal, .ant-modal, .MuiDialog-root, [class*="modal" i], [class*="popup" i]')].filter(isVisible);
  }

  function buttonIn(scope, re) {
    return [...scope.querySelectorAll('a, button, [role="button"]')].find((b) => re.test(label(b)) && isVisible(b));
  }

  // Buttons/links in a pre-apply pop-up that skip the site's upsell and go straight to the employer,
  // e.g. Jobright's "Apply without customizing". Never the upsell itself (customize/tailor/upgrade/autofill).
  const SKIP_UPSELL = /^(apply without (customi[sz]|tailor|optimi[sz]|changes|editing|ai)\w*|apply (directly|anyway|as is|with (my )?(original|current|existing) resume)|continue without (customi[sz]|tailor|optimi[sz]|changes)\w*|skip( (and|&) apply| for now| customi[sz]\w*)?|no,? (thanks|apply (directly|now|anyway))|use (my )?(original|current|existing) resume|go to (the )?(company|employer|original|job) (site|website|posting|page)|apply on (the )?(company|employer) (site|website))\b/i;
  const UPSELL_BTN = /(customi[sz]e|tailor|optimi[sz]e|upgrade|premium|subscribe|with (jobright|simplify)|autofill)/i;

  function upsellGate() {
    for (const d of dialogs()) {
      // A pop-up that shows the employer's application link directly (any wording).
      const ats = JC.applyLinks && [...d.querySelectorAll('a[href]')].find((x) => isVisible(x) && JC.applyLinks.ATS.test(resolveTarget(absUrl(x.getAttribute('href')))));
      if (ats) return { kind: 'upsell', text: clean(d.innerText).slice(0, 240), button: label(ats), selector: ref(ats), href: resolveTarget(absUrl(ats.getAttribute('href'))) };
      const b = [...d.querySelectorAll('a, button, [role="button"]')].find((x) => isVisible(x) && SKIP_UPSELL.test(label(x)) && !UPSELL_BTN.test(label(x).replace(SKIP_UPSELL, '')));
      if (b) return { kind: 'upsell', text: clean(d.innerText).slice(0, 240), button: label(b), selector: ref(b), href: b.tagName === 'A' && b.getAttribute('href') ? resolveTarget(absUrl(b.getAttribute('href'))) : '' };
    }
    return null;
  }

  function interstitial() {
    const up = upsellGate();
    if (up) return up;
    const LEAVING = /(leaving|leave (linkedin|indeed|glassdoor|this site)|redirect|external (site|website)|third[- ]party|company('s)? (site|website)|employer('s)? (site|website)|continue to|you('re| are) (about to|being)|job search safety|apply on)/i;
    const GO = /^(continue|continue to (apply|site|website)|proceed|go to (site|website|company)|apply on company( site| website)?|i understand|continue applying|open|visit (site|website))\b/i;
    for (const d of dialogs()) {
      const t = clean(d.innerText);
      if (!LEAVING.test(t)) continue;
      const b = buttonIn(d, GO);
      if (b) return { kind: 'leaving', text: t.slice(0, 240), button: label(b), selector: ref(b), href: b.tagName === 'A' ? resolveTarget(absUrl(b.getAttribute('href'))) : '' };
    }
    // Full-page interstitials (e.g. "You're being redirected to ..." with a Continue link).
    if (redirectInfo()) {
      const b = buttonIn(document, GO);
      if (b) return { text: clean(document.body.innerText).slice(0, 240), button: label(b), selector: ref(b), href: b.tagName === 'A' ? resolveTarget(absUrl(b.getAttribute('href'))) : '' };
    }
    return null;
  }

  function appliedPrompt() {
    const ASK = /(did you apply|have you applied|did you finish (your )?appl|did you submit|were you able to apply|mark (this job |it )?as applied|did you complete (the|your) application)/i;
    for (const d of dialogs().concat([...document.querySelectorAll('[class*="toast" i], [class*="banner" i]')].filter(isVisible))) {
      const t = clean(d.innerText);
      if (!ASK.test(t)) continue;
      const yes = buttonIn(d, /^(yes|yes,? i (did|applied)|i applied|applied|mark as applied)\b/i);
      const no = buttonIn(d, /^(no|not yet|no,? i didn'?t|i didn'?t|skip|cancel)\b/i);
      return { text: t.slice(0, 200), yes: yes ? label(yes) : '', no: no ? label(no) : '', yesSelector: yes ? ref(yes) : '', noSelector: no ? ref(no) : '' };
    }
    return null;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ------------------------------------------------ catching window.open (Jobright)
  // Jobright's buttons open an empty window and then send it to the employer's site. When the
  // extension clicks, Chrome's pop-up blocker stops that window (it isn't a real user click), so
  // while we click through, page-api.js stands in for window.open and reports the address.
  let captured = null;
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (ev.source !== window || !m || m.channel !== JC.BRIDGE_CHANNEL || m.dir !== 'captured-open') return;
    const u = JC.unwrapUrl ? JC.unwrapUrl(String(m.url || '')) : String(m.url || '');
    if (/^https?:/i.test(u) && !captured) captured = u;
  });
  const captureOpen = (on) => window.postMessage({ channel: JC.BRIDGE_CHANNEL, dir: 'capture-open', on }, '*');

  /**
   * Click a scripted button and wait for what the site does next: a page change, a pop-up (whose
   * skip option is clicked too), or a window.open() carrying the employer's address.
   * Returns { url } | { navigated } | { ok: false }.
   */
  /**
   * Click an element. With the "real clicks" setting on (and Chrome's debugger permission granted),
   * the service worker sends a real mouse click, which sites treat like the user's own; otherwise
   * a normal script click.
   */
  async function click(el, trace) {
    let real = false;
    try {
      const { settings } = await chrome.storage.local.get('settings');
      if (settings && settings.realClicks && window === window.top) {
        el.scrollIntoView({ block: 'center' });
        await sleep(150);
        const r = el.getBoundingClientRect();
        const res = await chrome.runtime.sendMessage({ type: 'jc:real-click', x: r.left + r.width / 2, y: r.top + r.height / 2 });
        real = !!(res && res.ok);
        if (!real && trace) trace.push({ step: 'real click failed, using script click', error: res && res.error });
      }
    } catch (e) {
      if (trace) trace.push({ step: 'real click failed, using script click', error: String(e.message || e) });
    }
    if (!real) el.click();
    return real;
  }

  async function clickAndWait(selector, timeoutMs, trace) {
    trace = trace || [];
    const t0 = Date.now();
    const note = (step, extra) => trace.push(Object.assign({ ms: Date.now() - t0, step }, extra || {}));
    const el = document.querySelector(selector);
    if (!el) {
      note('apply button not found');
      return { ok: false, reason: 'Apply button disappeared.' };
    }
    const before = location.href;
    captured = null;
    captureOpen(true);
    await sleep(60);
    const clickedGates = new Set();
    try {
      const real = await click(el, trace);
      note(`clicked "${label(el)}"`, { realClick: real });
      const end = Date.now() + (timeoutMs || 10000);
      let sawGate = false;
      while (Date.now() < end) {
        await sleep(300);
        if (captured) {
          note('caught employer address', { url: captured });
          return { ok: true, url: captured, via: 'window-open' };
        }
        if (location.href !== before) {
          note('page changed', { url: location.href });
          return { ok: true, navigated: location.href };
        }
        const gate = interstitial();
        if (gate && !clickedGates.has(gate.selector)) {
          sawGate = true;
          note(`pop-up: "${gate.text.slice(0, 60)}"`, { option: gate.button, href: gate.href || undefined });
          if (gate.href) return { ok: true, url: gate.href, via: `pop-up link "${gate.button}"` };
          clickedGates.add(gate.selector);
          const b = document.querySelector(gate.selector);
          if (b) {
            const realB = await click(b, trace); // e.g. "Apply Without Customizing": opens the employer site via window.open
            note(`clicked "${gate.button}"`, { realClick: realB });
          }
        }
      }
      note(sawGate ? 'timed out after the pop-up: no address was caught' : 'timed out: no pop-up, address or page change after the click');
      return { ok: false, reason: sawGate ? 'The pop-up appeared but no employer address was caught after choosing its option.' : 'Clicked Apply, but nothing happened (the site may ignore script clicks: try the "real clicks" option).' };
    } finally {
      await sleep(200);
      captureOpen(false);
    }
  }

  /** Close the site's pop-ups without answering them (never "Yes, I applied"). */
  function closeDialogs() {
    for (const d of dialogs()) {
      const x = d.querySelector('.ant-modal-close, [aria-label="Close" i], [aria-label="close" i], button[class*="close" i], [class*="closeBtn" i], [class*="close-btn" i]');
      if (x) x.click();
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  }

  /**
   * Move towards the employer's application. Never submits anything.
   *   opts.scope     CSS selector of a job card: use the Apply button inside it (feeds)
   *   opts.navigate  false: only find the address, don't go there
   *   opts.newTab    open the address in a new tab instead of this one
   */
  async function followApply(opts) {
    opts = opts || {};
    const go = (url, why) => {
      if (opts.navigate === false) return { ok: true, action: 'found', to: url, reason: why };
      if (opts.newTab) {
        chrome.runtime.sendMessage({ type: 'jc:open-tab', url }).catch(() => {});
        return { ok: true, action: 'opened-tab', to: url, reason: why };
      }
      setTimeout(() => location.assign(url), 50);
      return { ok: true, action: 'navigate', to: url, reason: why };
    };
    const fromClick = (r, kind) => {
      if (r.url) return Object.assign(go(r.url, r.via), kind ? { kind } : {});
      if (r.navigated) return { ok: true, action: 'navigated', to: r.navigated, kind };
      return Object.assign({ kind }, r);
    };

    if (!opts.scope) {
      const hop = redirectInfo();
      if (hop && hop.target) return go(hop.target, 'skipped redirect hop');
      const gate = interstitial();
      if (gate) {
        if (gate.href) return go(gate.href, `pop-up "${gate.button}"`);
        return fromClick(await clickAndWait(gate.selector, 8000, opts.trace));
      }
    }
    const a = applyInfo(opts.scope);
    if (!a) return { ok: false, reason: 'No Apply button found' + (opts.scope ? ' in that job card.' : ' on this page.') };
    if (a.kind === 'easy-apply') return { ok: false, kind: a.kind, selector: a.selector, reason: 'On-site Easy Apply: click the button and follow the site\'s own multi-step form.' };
    if (a.target) return Object.assign(go(a.target, a.targetVia || 'apply link'), { kind: a.kind });
    // Scripted button: click it and follow through (only on job boards and aggregators,
    // where Apply leads elsewhere; on an employer's own page Claude should click it itself).
    if (a.kind === 'external') return fromClick(await clickAndWait(a.selector, 10000, opts.trace), a.kind);
    return { ok: false, kind: a.kind, selector: a.selector, reason: 'The Apply button has no link (it is scripted). Click it; it usually opens a new tab, then look at detect().openedTabs.' };
  }

  JC.nav = { applyInfo, redirectInfo, interstitial, appliedPrompt, followApply, closeDialogs, click, resolveTarget };
})(typeof globalThis !== 'undefined' ? globalThis : self);
