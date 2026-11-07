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
    extractJob: () => call('extractJob', {}, T),
    scanForm: () => call('scanForm', {}, T),
    autofill: (opts) => call('autofill', opts, 30000),
    fillField: (opts) => call('fillField', opts, T),
    attachFile: (opts) => call('attachFile', opts, 30000),
    followApply: () => call('followApply', {}, T),
    help: () =>
      'jobCopilot: detect() extractJobs() extractJob() followApply() scanForm() autofill({overrides,overwrite}) fillField({selector|ref|label, value, check}) attachFile({kind:"resume"|"coverLetter", url?, ref?}). Results are also in jobCopilot.last.',
  };

  Object.defineProperty(window, 'jobCopilot', { value: api, configurable: true, enumerable: false, writable: false });
})();
