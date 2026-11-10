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

  function candidates() {
    const els = [...document.querySelectorAll('a[href], button, [role="button"], input[type="submit"], input[type="button"]')];
    return els.filter((el) => {
      const t = label(el);
      const aria = clean(el.getAttribute('aria-label') || '');
      return ((t && t.length < 70 && APPLY_RE.test(t)) || (aria && /^(easy )?apply\b/i.test(aria))) && isVisible(el) && !el.closest('[aria-hidden="true"]');
    });
  }

  function applyInfo() {
    const list = candidates();
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

  /** Move THIS tab towards the application. Never submits anything. */
  function followApply() {
    const hop = redirectInfo();
    if (hop && hop.target) {
      setTimeout(() => location.assign(hop.target), 50);
      return { ok: true, action: 'navigate', to: hop.target, reason: 'skipped redirect hop' };
    }
    const gate = interstitial();
    if (gate) {
      if (gate.href) {
        setTimeout(() => location.assign(gate.href), 50);
        return { ok: true, action: 'navigate', to: gate.href, reason: `interstitial "${gate.button}"` };
      }
      document.querySelector(gate.selector).click();
      return { ok: true, action: 'clicked', button: gate.button, note: 'May open a new tab: check detect().openedTabs or the tab list.' };
    }
    const a = applyInfo();
    if (!a) return { ok: false, reason: 'No Apply button found on this page.' };
    if (a.kind === 'easy-apply') return { ok: false, kind: a.kind, selector: a.selector, reason: 'On-site Easy Apply: click the button and follow the site\'s own multi-step form.' };
    if (a.target) {
      setTimeout(() => location.assign(a.target), 50);
      return { ok: true, action: 'navigate', to: a.target, kind: a.kind };
    }
    return { ok: false, kind: a.kind, selector: a.selector, reason: 'The Apply button has no link (it is scripted). Click it; it usually opens a new tab, then look at detect().openedTabs.' };
  }

  JC.nav = { applyInfo, redirectInfo, interstitial, appliedPrompt, followApply, resolveTarget };
})(typeof globalThis !== 'undefined' ? globalThis : self);
