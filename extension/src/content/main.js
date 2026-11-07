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
    try {
      const denied = await checkWrite(cmd, payload);
      if (denied) return { ok: false, frame: location.href, error: denied };

      switch (cmd) {
        case 'ping':
          return { ok: true, frame: location.href, isTop, version: JC.VERSION };
        case 'detect': {
          const s = quickStatus();
          s.jobCount = s.pageType === 'listings' || isTop ? JC.extract.listings().length : 0;
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
          return Object.assign({ frame: location.href }, JC.nav.followApply());
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
          const { profile, resume, coverLetter } = await storage(['profile', 'resume', 'coverLetter']);
          if (!profile) return { ok: false, frame: location.href, error: 'No profile saved in Job Copilot. Open the options page and import profile.json.' };
          const files = { resume: payload.files?.resume || resume, coverLetter: payload.files?.coverLetter || coverLetter };
          const r = JC.autofill.autofill({ profile, files, overrides: payload.overrides, overwrite: !!payload.overwrite });
          return Object.assign({ ok: true }, r);
        }
        case 'fillField':
          return Object.assign({ frame: location.href }, JC.autofill.fillOne(payload));
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
    const report = () => {
      try {
        const s = quickStatus();
        s.jobCount = JC.extract.listings().length;
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
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
