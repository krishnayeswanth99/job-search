/*
 * Job Copilot: service worker.
 * - Runs commands in every frame of a tab and merges the results (application
 *   forms often live in iframes, e.g. Greenhouse embeds on company sites).
 * - Fetches local files for attachFile (localhost only).
 * - Maintains the toolbar badge.
 */
importScripts('shared/config.js');

const FRAME_CMDS = new Set(['ping', 'detect', 'extractJobs', 'extractJob', 'scanForm', 'autofill', 'fillField', 'attachFile', 'followApply']);

// ---------------------------------------------------- tabs opened by Apply buttons
// Job boards often open the employer's site in a new tab. Remember child tabs per
// opener so detect() can tell Claude where the application went.
const childTabs = new Map(); // openerTabId -> [{ tabId, url, title, openedAt }]
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId === undefined) return;
  const list = childTabs.get(tab.openerTabId) || [];
  list.push({ tabId: tab.id, url: tab.pendingUrl || tab.url || '', title: tab.title || '', openedAt: new Date().toISOString() });
  childTabs.set(tab.openerTabId, list.slice(-5));
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info.url && !info.title) return;
  for (const list of childTabs.values()) for (const c of list) if (c.tabId === tabId) Object.assign(c, { url: tab.url || c.url, title: tab.title || c.title });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  childTabs.delete(tabId);
  for (const [k, list] of childTabs) childTabs.set(k, list.filter((c) => c.tabId !== tabId));
});

async function runInFrames(tabId, cmd, payload) {
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (c, p) => (globalThis.JC && globalThis.JC.handle ? globalThis.JC.handle(c, p) : null),
      args: [cmd, payload],
    });
  } catch (e) {
    // Some frames (e.g. chrome:// or blocked) can make allFrames fail; retry top frame only.
    results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (c, p) => (globalThis.JC && globalThis.JC.handle ? globalThis.JC.handle(c, p) : null),
      args: [cmd, payload],
    });
  }
  return results.filter((r) => r && r.result).map((r) => Object.assign({ frameId: r.frameId }, r.result));
}

function merge(cmd, frames) {
  if (!frames.length) return { ok: false, error: 'Job Copilot is not running in this tab. Reload the tab (content scripts load on page load) and try again.' };
  const top = frames.find((f) => f.frameId === 0) || frames[0];
  const errors = frames.filter((f) => f.ok === false && f.error).map((f) => ({ frame: f.frame, error: f.error }));

  switch (cmd) {
    case 'ping':
      return top;
    case 'detect': {
      const app = frames.find((f) => f.application);
      const login = frames.map((f) => f.login).find((l) => l && l.required) || top.login;
      const out = Object.assign({}, top, { login, jobCount: top.jobCount || 0 });
      delete out.frameId;
      if (app && app !== top) {
        out.pageType = 'application';
        out.application = true;
        out.applicationFrame = app.url;
        out.portal = out.portal || app.portal;
        delete out.apply;
      }
      return out;
    }
    case 'extractJobs': {
      const seen = new Set();
      const jobs = [];
      for (const f of frames) for (const j of f.jobs || []) {
        const k = j.url || j.jobId || j.title + j.company;
        if (!seen.has(k)) {
          seen.add(k);
          jobs.push(j);
        }
      }
      return { ok: true, url: top.frame, portal: top.portal, count: jobs.length, jobs };
    }
    case 'extractJob': {
      const withJob = frames.filter((f) => f.job && f.job.title);
      withJob.sort((a, b) => (b.job.description || '').length - (a.job.description || '').length);
      return withJob.length ? { ok: true, job: withJob[0].job, frame: withJob[0].frame } : { ok: false, error: 'No job posting found on this page.' };
    }
    case 'scanForm': {
      const fields = [];
      for (const f of frames) for (const x of f.fields || []) fields.push(Object.assign({ frame: f.isTop ? 'top' : f.frame }, x));
      return { ok: true, application: frames.some((f) => f.application), count: fields.length, fields };
    }
    case 'autofill': {
      const out = { ok: errors.length < frames.length, filledCount: 0, filled: [], skipped: [], needsInput: [], errors };
      for (const f of frames) {
        if (!f.ok) continue;
        out.filledCount += f.filledCount || 0;
        const tag = (x) => Object.assign({ frame: f.isTop === false ? f.frame : 'top' }, x);
        out.filled.push(...(f.filled || []).map(tag));
        out.skipped.push(...(f.skipped || []).map(tag));
        out.needsInput.push(...(f.needsInput || []).map(tag));
      }
      if (!out.ok) out.error = errors[0] && errors[0].error;
      out.reminder = 'Nothing was submitted. Review the form, answer needsInput items, then ask the user before clicking Submit.';
      return out;
    }
    case 'followApply':
      return frames.find((f) => f.frameId === 0) || frames[0];
    case 'fillField':
    case 'attachFile': {
      const hit = frames.find((f) => f.ok);
      return hit || { ok: false, error: (errors[0] && errors[0].error) || 'field not found', errors };
    }
    default:
      return top;
  }
}

function isLocalUrl(u) {
  try {
    const url = new URL(u);
    return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch (_) {
    return false;
  }
}

async function fetchAsFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > 10 * 1024 * 1024) throw new Error('file larger than 10 MB');
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'resume.pdf');
  const type = res.headers.get('content-type') || (name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  return { name, type: type.split(';')[0], dataBase64: btoa(bin) };
}

async function runCommand(tabId, cmd, payload, origin) {
  if (!FRAME_CMDS.has(cmd)) return { ok: false, error: `unknown command: ${cmd}` };
  // Never trust an origin claimed by the page; it is set here from the sender.
  payload = Object.assign({}, payload, { _origin: origin });
  delete payload.files;

  if (cmd === 'attachFile') {
    if (payload.url) {
      if (!isLocalUrl(payload.url)) return { ok: false, error: 'attachFile only fetches from http://127.0.0.1 or http://localhost (serve the file locally first).' };
      try {
        payload.file = await fetchAsFile(payload.url);
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    } else {
      const kind = payload.kind || 'resume';
      const stored = (await chrome.storage.local.get(kind))[kind];
      if (!stored) return { ok: false, error: `No ${kind} stored in Job Copilot options and no url given.` };
      payload.file = stored;
    }
  }
  const out = merge(cmd, await runInFrames(tabId, cmd, payload));
  if (cmd === 'detect') {
    const kids = (childTabs.get(tabId) || []).filter((c) => /^https?:/.test(c.url));
    if (kids.length) out.openedTabs = kids;
  }
  return out;
}

// ------------------------------------------------------------------ badge
async function setBadge(tabId, status) {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings && settings.showBadge === false) return chrome.action.setBadgeText({ tabId, text: '' });
  let text = '';
  let color = '#2563eb';
  if (status.login && status.login.required) {
    text = 'LOG';
    color = '#d97706';
  } else if (status.application) {
    text = 'FILL';
    color = '#16a34a';
  } else if (status.jobCount) {
    text = String(Math.min(status.jobCount, 999));
  } else if (status.pageType === 'job') {
    text = 'JOB';
  }
  await chrome.action.setBadgeBackgroundColor({ tabId, color });
  await chrome.action.setBadgeText({ tabId, text });
  const label = [status.portalName, status.pageType !== 'unknown' && status.pageType, status.jobCount && `${status.jobCount} jobs`].filter(Boolean).join(' · ');
  await chrome.action.setTitle({ tabId, title: label ? `Job Copilot: ${label}` : 'Job Copilot' });
}

// Extension pages (popup, options) vs. content scripts running in web pages.
const isExtensionPage = (sender) => sender.id === chrome.runtime.id && String(sender.url || '').startsWith(chrome.runtime.getURL(''));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const fromExt = isExtensionPage(sender);
    if (msg.type === 'jc:status' && sender.tab && !fromExt) {
      if (sender.frameId === 0) await setBadge(sender.tab.id, msg.status);
      return { ok: true };
    }
    if (msg.type === 'jc:bridge' && sender.tab && !fromExt) {
      return runCommand(sender.tab.id, msg.cmd, msg.payload, 'bridge');
    }
    if (msg.type === 'jc:popup' && fromExt) {
      return runCommand(msg.tabId, msg.cmd, msg.payload, 'popup');
    }
    return { ok: false, error: 'unknown message' };
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true;
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) await chrome.storage.local.set({ settings: self.JC.DEFAULT_SETTINGS });
  if (reason === 'install') chrome.runtime.openOptionsPage();
});
