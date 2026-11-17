/*
 * Job Copilot: page-world API (runs in the page's MAIN world).
 *
 * Defines `window.jobCopilot` so Claude in Chrome's javascript_tool (which runs
 * in the page) can call the extension:
 *
 *   await window.jobCopilot.detect()
 *   await window.jobCopilot.extractJobs()
 *   await window.jobCopilot.extractJob()
 *   await window.jobCopilot.scanForm()
 *   await window.jobCopilot.autofill({ overrides: { "<selector|label|profileKey>": "value" } })
 *   await window.jobCopilot.fillField({ selector, value })
 *   await window.jobCopilot.attachFile({ kind: "resume", url: "http://127.0.0.1:8765/resume.pdf" })
 *
 * Every call also stores its result in `window.jobCopilot.last`, for tools that
 * do not await promises: call once, then read JSON.stringify(window.jobCopilot.last).
 * This file holds no data and no privileges; it only relays messages to the
 * isolated content script, which enforces the trust rules.
 */
(function () {
  if (window.jobCopilot && window.jobCopilot.__jc) return;
  const CHANNEL = 'job-copilot';
  const pending = new Map();
  let seq = 0;
  let enabled = null;
  let version = null;

  function call(cmd, payload, timeoutMs) {
    const id = `${Date.now().toString(36)}-${++seq}`;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        pending.delete(id);
        resolve(store({ ok: false, error: `Job Copilot did not answer "${cmd}" within ${timeoutMs / 1000}s. Is the extension installed and enabled? Try reloading the tab.` }));
      }, timeoutMs);
      pending.set(id, (msg) => {
        clearTimeout(t);
        resolve(store(msg.data && typeof msg.data === 'object' ? msg.data : { ok: msg.ok, error: msg.error }));
      });
      window.postMessage({ channel: CHANNEL, dir: 'req', id, cmd, payload: payload || {} }, '*');
    });
  }

  function store(result) {
    api.last = result;
    return result;
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const m = ev.data;
    if (!m || m.channel !== CHANNEL) return;
    if (m.dir === 'capture-open') {
      setCapture(!!m.on);
      return;
    }
    if (m.dir === 'rec') {
      // Recording (started by the user from the popup): report window.open() calls, which a
      // page may make and immediately undo (Jobright opens and closes a tab before its pop-up).
      if (m.on && !window.__jcOpenHooked) {
        window.__jcOpenHooked = true;
        const orig = window.open;
        window.open = function (url, name, features) {
          if (window.__jcRec) window.postMessage({ channel: CHANNEL, dir: 'rec-open', url: String(url || ''), name: name ? String(name) : '' }, '*');
          return orig.apply(this, arguments);
        };
      }
      window.__jcRec = !!m.on;
      return;
    }
    if (m.dir === 'hello') {
      enabled = !!m.enabled;
      version = m.version;
      return;
    }
    if (m.dir === 'res' && pending.has(m.id)) {
      const fn = pending.get(m.id);
      pending.delete(m.id);
      fn(m);
    }
  });

  // While Job Copilot clicks through an aggregator's Apply (followApply), stand in for window.open:
  // the site gets a stand-in window, and any address it tries to open or send that window to is
  // reported to the extension, which opens it itself (its own tabs aren't stopped by the pop-up
  // blocker). Turned off right after, and automatically after 20 s.
  let realOpen = null;
  let captureTimer = null;
  function fakeWindow(report) {
    const loc = { get href() { return 'about:blank'; }, set href(u) { report(u); }, assign: report, replace: report, reload() {}, toString() { return 'about:blank'; } };
    const w = { closed: false, opener: null, name: '', close() { w.closed = true; }, focus() {}, blur() {}, postMessage() {}, addEventListener() {}, removeEventListener() {},
      document: { write() {}, writeln() {}, open() {}, close() {}, title: '', body: null } };
    Object.defineProperty(w, 'location', { get() { return loc; }, set(u) { report(u); } });
    return w;
  }
  function setCapture(on) {
    if (on && !realOpen) {
      realOpen = window.open;
      window.open = function (url) {
        const report = (u) => {
          let abs = String(u || '');
          try { abs = new URL(abs, location.href).href; } catch (_) { /* keep as is */ }
          if (/^https?:/i.test(abs)) window.postMessage({ channel: CHANNEL, dir: 'captured-open', url: abs }, '*');
        };
        report(url);
        return fakeWindow(report);
      };
      captureTimer = setTimeout(() => setCapture(false), 20000);
    } else if (!on && realOpen) {
      window.open = realOpen;
      realOpen = null;
      clearTimeout(captureTimer);
    }
  }

  const T = 15000;
  const api = {
    __jc: true,
    last: null,
    get installed() {
      return enabled !== null;
    },
    get enabled() {
      return !!enabled;
    },
    get version() {
      return version;
    },
    ping: () => call('ping', {}, 5000),
    detect: () => call('detect', {}, T),
    extractJobs: (opts) => call('extractJobs', opts, T),
    loadMoreJobs: (opts) => call('loadMoreJobs', opts, 45000),
    resolveApplyLinks: (opts) => call('resolveApplyLinks', opts, 900000),
    stopResolve: () => call('stopResolve', {}, T),
    extractJob: () => call('extractJob', {}, T),
    scanForm: () => call('scanForm', {}, T),
    autofill: (opts) => call('autofill', opts, 30000),
    fillField: (opts) => call('fillField', opts, T),
    attachFile: (opts) => call('attachFile', opts, 30000),
    followApply: (opts) => call('followApply', opts, 25000),
    nextStep: () => call('nextStep', {}, T),
    startApplication: () => call('startApplication', {}, 20000),
    help: () =>
      'jobCopilot: detect() extractJobs() extractJob() followApply() scanForm() autofill({overrides,overwrite}) fillField({selector|ref|label, value, check}) attachFile({kind:"resume"|"coverLetter", url?, ref?}). Results are also in jobCopilot.last.',
  };

  Object.defineProperty(window, 'jobCopilot', { value: api, configurable: true, enumerable: false, writable: false });
})();
