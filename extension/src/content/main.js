/*
 * Job Copilot: content-script entry point.
 *
 * - JC.handle(cmd, payload): per-frame command handler. The service worker
 *   calls it in every frame via chrome.scripting.executeScript (same isolated
 *   world as this script) and merges the results.
 * - Page bridge (top frame only): relays window.postMessage requests from
 *   window.jobCopilot (src/page/page-api.js) to the service worker. This is how
 *   Claude in Chrome's javascript_tool talks to the extension.
 * - Badge updates on load and on SPA navigation.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});
  if (JC.__contentLoaded) return;
  JC.__contentLoaded = true;

  const isTop = window === window.top;
  const WRITE_CMDS = new Set(['autofill', 'attachFile']);

  async function storage(keys) {
    try {
      return await chrome.storage.local.get(keys);
    } catch (_) {
      return {};
    }
  }

  async function settings() {
    const { settings } = await storage('settings');
    return Object.assign({}, JC.DEFAULT_SETTINGS, settings || {});
  }

  function quickStatus() {
    const portal = JC.extract.portal();
    const pageType = JC.extract.pageType();
    const fields = JC.fields.scan();
    const application = JC.fields.looksLikeApplication(fields);
    const login = JC.login.detectLogin();
    return {
      url: location.href,
      title: document.title,
      isTop,
      portal: portal ? portal.id : null,
      portalName: portal ? portal.name : null,
      pageType: application ? 'application' : pageType,
      application,
      fieldCount: fields.length,
      login,
    };
  }

  async function checkWrite(cmd, payload) {
    if (!WRITE_CMDS.has(cmd) || payload._origin !== 'bridge') return null;
    const s = await settings();
    if (!s.bridgeAutofill) return 'Autofill through the Claude bridge is turned off in Job Copilot settings. Ask the user to click "Autofill" in the extension popup instead.';
    if (!JC.isTrustedHost(location.hostname, s.trustedDomains)) {
      return `${location.hostname} is not a trusted job site, so Job Copilot will not autofill it via the bridge. Ask the user to click "Autofill" in the extension popup, or add the site under Trusted sites in the options page.`;
    }
    return null;
  }

  JC.handle = async function handle(cmd, payload) {
    payload = payload || {};
    if (JC.recorder && JC.recorder.note && isTop && !['ping', 'detect'].includes(cmd)) JC.recorder.note({ command: cmd, from: payload._origin });
    try {
      const denied = await checkWrite(cmd, payload);
      if (denied) return { ok: false, frame: location.href, error: denied };

      switch (cmd) {
        case 'ping':
          return { ok: true, frame: location.href, isTop, version: JC.VERSION };
        case 'detect': {
          const s = quickStatus();
          s.jobCount = s.pageType === 'listings' || isTop ? JC.extract.listings().length : 0;
          // Was an application just submitted here? (confirmation page / message)
          if (JC.applied) {
            const sub = JC.applied.check();
            if (sub.confirmed) s.submitted = { text: sub.text, url: sub.url };
          }
          if (isTop) {
            // How to get from here to the real application form.
            const redirect = JC.nav.redirectInfo();
            const interstitial = JC.nav.interstitial();
            const appliedPrompt = JC.nav.appliedPrompt();
            if (redirect) {
              s.redirect = redirect;
              if (!s.application) s.pageType = 'redirect';
            }
            if (interstitial) s.interstitial = interstitial;
            if (appliedPrompt) s.appliedPrompt = appliedPrompt;
            if (!s.application) s.apply = JC.nav.applyInfo();
          }
          return Object.assign({ ok: true }, s);
        }
        case 'followApply':
          if (!isTop) return null;
          return Object.assign({ frame: location.href }, await JC.nav.followApply(payload));
        case 'stopResolve':
          if (!isTop) return null;
          return Object.assign({ frame: location.href }, JC.applyLinks.stop());
        case 'resolveApplyLinks': {
          if (!isTop) return null;
          const r = await JC.applyLinks.resolve(payload);
          return Object.assign({ ok: true, frame: location.href, isTop, portal: (JC.extract.portal() || {}).id || 'generic' }, r);
        }
        case 'loadMoreJobs': {
          if (!isTop) return null;
          const r = await JC.extract.loadMore(payload);
          return { ok: true, frame: location.href, isTop, portal: (JC.extract.portal() || {}).id || 'generic', added: r.added, jobs: r.jobs.slice(0, payload.limit || 300) };
        }
        case 'extractJobs': {
          const jobs = JC.extract.listings();
          return { ok: true, frame: location.href, isTop, portal: (JC.extract.portal() || {}).id || 'generic', jobs: jobs.slice(0, payload.limit || 100) };
        }
        case 'extractJob':
          return { ok: true, frame: location.href, isTop, job: JC.extract.job() };
        case 'scanForm': {
          const fields = JC.fields.scan();
          return { ok: true, frame: location.href, isTop, application: JC.fields.looksLikeApplication(fields), fields: fields.map(JC.fields.describe) };
        }
        case 'autofill': {
          const fields = JC.fields.scan();
          if (!fields.length) return { ok: true, frame: location.href, filledCount: 0, filled: [], skipped: [], needsInput: [] };
          const { profile, resume, coverLetter, resumeText } = await storage(['profile', 'resume', 'coverLetter', 'resumeText']);
          if (!profile) return { ok: false, frame: location.href, error: 'No profile saved in Job Copilot. Open the options page and import profile.json.' };
          const files = { resume: payload.files?.resume || resume, coverLetter: payload.files?.coverLetter || coverLetter };
          const st = await settings();
          const run = () => JC.autofill.autofill({ profile, files, overrides: payload.overrides, overrideSource: payload.overrideSource, jobDesc: payload.jobDesc || (() => { try { return (JC.extract.job() || {}).description || ''; } catch (_) { return ''; } })(), overwrite: !!payload.overwrite, resumeText, profileWins: st.profileWins !== false });
          const r = await (JC.learn ? JC.learn.ours(run) : run());
          return Object.assign({ ok: true }, r);
        }
        case 'reviewFix': {
          // Only the service worker's own on-device check sends this (never the page bridge).
          if (payload._origin !== 'ai-check') return { ok: false, frame: location.href, error: 'not allowed' };
          const { profile } = await storage(['profile']);
          if (!profile) return null;
          const run = () => JC.autofill.applyReview(payload.fixes, profile);
          return Object.assign({ ok: true, frame: location.href }, JC.learn ? await JC.learn.ours(run) : run());
        }
        case 'flagFields': {
          // The on-device answer check: outline answers it thinks are wrong (red) or can't confirm (amber).
          if (payload._origin !== 'ai-check') return { ok: false, frame: location.href, error: 'not allowed' };
          let n = 0;
          for (const fl of payload.flags || []) {
            const el = fl.selector && document.querySelector(fl.selector);
            if (!el) continue;
            const t = el.type === 'radio' || el.type === 'checkbox' ? el.closest('fieldset, [role="radiogroup"], .field') || el : el;
            t.style.outline = fl.verdict === 'wrong' ? '2px solid #dc2626' : '2px dashed #d97706';
            t.style.outlineOffset = '2px';
            t.title = fl.verdict === 'wrong' ? "Job Copilot: the on-device AI thinks this answer doesn't match your profile or resume. Please check it." : "Job Copilot: the on-device AI couldn't confirm this answer from your profile or resume. Please check it.";
            const clear = () => {
              t.style.outline = '';
              t.title = '';
            };
            el.addEventListener('input', clear, { once: true });
            el.addEventListener('change', clear, { once: true });
            n++;
          }
          return { ok: true, frame: location.href, flagged: n };
        }
        case 'startApplication':
          if (!isTop) return null;
          return Object.assign({ frame: location.href }, await JC.nav.startApplication());
        case 'nextStep': {
          // Multi-page forms: click Next / Continue / Save & Continue (even when the site's layout hid it).
          // Never Submit: that one is scrolled into view and outlined for the user.
          const NEXT = /^(next|next step|next page|continue|save (and|&) continue|save (and|&) next|proceed|go to next step|continue to next step)\b(?!.*\bwith\b)/i;
          const SUBMIT = /^(submit|submit application|submit my application|send application|apply|apply now|finish|complete application)\b/i;
          const btns = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"]')].filter((b) => b.getClientRects().length && !b.disabled);
          const label = (b) => JC.dom.clean(b.innerText || b.value || b.getAttribute('aria-label') || '');
          const next = btns.find((b) => NEXT.test(label(b)) && label(b).length < 40);
          if (next) {
            const before = location.href;
            next.scrollIntoView({ block: 'center' });
            next.click();
            // Still here after a moment, with error messages showing? The site rejected the step.
            await new Promise((r) => setTimeout(r, 1800));
            const errors =
              location.href === before && next.isConnected
                ? [...document.querySelectorAll('[data-automation-id="errorMessage"], [role="alert"], .error-message, .field-error, .invalid-feedback, [class*="error" i][id*="error" i]')]
                    .filter((e) => e.getClientRects().length && JC.dom.clean(e.innerText).length)
                    .map((e) => JC.dom.clean(e.innerText).slice(0, 120))
                    .slice(0, 8)
                : [];
            return { ok: true, frame: location.href, clicked: label(next), errors };
          }
          const sub = btns.find((b) => SUBMIT.test(label(b)) && label(b).length < 40);
          if (sub) {
            sub.scrollIntoView({ block: 'center' });
            sub.style.outline = '3px solid #16a34a';
            sub.style.outlineOffset = '3px';
            return { ok: false, frame: location.href, submit: label(sub), reason: 'This is the last step: review the form, then click the outlined submit button yourself.' };
          }
          return { ok: false, frame: location.href, reason: 'No Next or Submit button found in this frame.' };
        }
        case 'showField': {
          // The side panel's "Show" button: scroll to a field and flash it.
          const target = payload.selector && document.querySelector(payload.selector);
          if (!target) return isTop ? { ok: false, frame: location.href, error: 'That field is no longer on the page (the page changed). Click Autofill to refresh the list.' } : null;
          target.scrollIntoView({ block: 'center', behavior: 'smooth' });
          const old = target.style.boxShadow;
          target.style.boxShadow = '0 0 0 4px rgba(124,58,237,.6)';
          setTimeout(() => (target.style.boxShadow = old), 2500);
          try {
            target.focus({ preventScroll: true });
          } catch (_) {}
          return { ok: true, frame: location.href };
        }
        case 'fillField':
          return Object.assign({ frame: location.href }, JC.learn ? await JC.learn.ours(() => JC.autofill.fillOne(payload)) : JC.autofill.fillOne(payload));
        case 'attachFile': {
          const fields = JC.fields.scan().filter((f) => f.type === 'file');
          const kind = payload.kind || 'resume';
          const target = (payload.ref && fields.find((f) => f.ref === payload.ref)) || fields.find((f) => f.key === kind);
          if (!target) return { ok: false, frame: location.href, error: `no ${kind} upload field in this frame` };
          const ok = JC.autofill.attachFile(target.el, payload.file);
          return { ok, frame: location.href, selector: `[data-jc-ref="${target.ref}"]`, file: payload.file && payload.file.name };
        }
        default:
          return { ok: false, error: `unknown command: ${cmd}` };
      }
    } catch (e) {
      return { ok: false, frame: location.href, error: String((e && e.message) || e) };
    }
  };

  // ------------------------------------------------------------ page bridge
  if (isTop) {
    window.addEventListener('message', async (ev) => {
      if (ev.source !== window) return;
      const m = ev.data;
      if (!m || m.channel !== JC.BRIDGE_CHANNEL || m.dir !== 'req') return;
      const reply = (body) => window.postMessage(Object.assign({ channel: JC.BRIDGE_CHANNEL, dir: 'res', id: m.id }, body), '*');
      const s = await settings();
      if (!s.bridgeEnabled) return reply({ ok: false, error: 'Job Copilot bridge is disabled in the extension options.' });
      try {
        const res = await chrome.runtime.sendMessage({ type: 'jc:bridge', cmd: m.cmd, payload: m.payload || {} });
        reply({ ok: res && res.ok !== false, data: res, error: res && res.error });
      } catch (e) {
        reply({ ok: false, error: 'Extension unavailable (was it reloaded? refresh the tab): ' + e.message });
      }
    });

    settings().then((s) => {
      window.postMessage({ channel: JC.BRIDGE_CHANNEL, dir: 'hello', enabled: !!s.bridgeEnabled, version: JC.VERSION }, '*');
    });

    // Badge: initial + SPA navigations (LinkedIn, Indeed, Workday are SPAs).
    let lastUrl = '';
    let timer = null;
    let hasJobs = false;
    const report = () => {
      try {
        const s = quickStatus();
        s.jobCount = JC.extract.listings().length;
        hasJobs = s.jobCount > 0;
        chrome.runtime.sendMessage({ type: 'jc:status', status: s }).catch(() => {});
      } catch (_) {
        /* extension context invalidated */
      }
    };
    const tick = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        clearTimeout(timer);
        timer = setTimeout(report, 1200);
        setTimeout(report, 4000); // lazy-loaded results
      }
    };
    tick();
    setInterval(tick, 1500);

    // Infinite-scroll feeds add jobs without changing the URL: re-check when the page grows
    // (throttled to once every 2.5 s, and only on pages that already show jobs).
    let pending = null;
    let lastRun = 0;
    const onGrow = () => {
      if (pending) return;
      const wait = Math.max(0, 2500 - (Date.now() - lastRun));
      pending = setTimeout(() => {
        pending = null;
        lastRun = Date.now();
        report();
      }, wait);
    };
    new MutationObserver((muts) => {
      if (hasJobs && muts.some((m) => m.addedNodes.length)) onGrow();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // Forms that change without loading a new page (single-page ATSs: Taleo, SuccessFactors, Oracle,
  // Workday steps, a form that appears after sign-in): tell the service worker when a different
  // set of questions shows up, so an application tab gets autofilled whatever the site.
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    let lastSig = '';
    let timer = null;
    let lastScan = 0;
    const check = () => {
      timer = null;
      lastScan = Date.now();
      let fields;
      try {
        fields = JC.fields.scan();
      } catch (_) {
        return;
      }
      const keyed = fields.filter((f) => f.key && f.type !== 'file');
      const sig = fields.map((f) => f.label).slice(0, 15).join('|');
      if (sig === lastSig) return;
      lastSig = sig;
      if (keyed.length < 2 && !JC.fields.looksLikeApplication(fields)) return;
      try {
        chrome.runtime.sendMessage({ type: 'jc:form-changed', fields: fields.length, keyed: keyed.length }).catch(() => {});
      } catch (_) {
        /* extension reloaded */
      }
    };
    new MutationObserver((muts) => {
      if (timer || !muts.some((m) => m.addedNodes.length)) return;
      timer = setTimeout(check, Math.max(1500, 3000 - (Date.now() - lastScan)));
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
