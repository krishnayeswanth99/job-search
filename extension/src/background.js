/*
 * Job Copilot: service worker.
 * - Runs commands in every frame of a tab and merges the results (application
 *   forms often live in iframes, e.g. Greenhouse embeds on company sites).
 * - Fetches local files for attachFile (localhost only).
 * - Maintains the toolbar badge.
 */
importScripts('shared/config.js', 'shared/profile-schema.js', 'shared/field-rules.js');

const FRAME_CMDS = new Set(['startApplication', 'nextStep', 'ping', 'detect', 'extractJobs', 'loadMoreJobs', 'resolveApplyLinks', 'stopResolve', 'extractJob', 'scanForm', 'autofill', 'fillField', 'attachFile', 'followApply', 'reviewFix']);

// ---------------------------------------------------- tabs opened by Apply buttons
// Job boards often open the employer's site in a new tab. Remember child tabs per
// opener so detect() can tell Claude where the application went.
const childTabs = new Map(); // openerTabId -> [{ tabId, url, title, openedAt }]
// ------------------------------------------------ "Record what I do" (debugging)
const recordings = new Map(); // tabId -> { startedAt, url, events: [] }
const REC_MAX_EVENTS = 400;
const REC_MAX_MS = 15 * 60 * 1000;
async function recSave(tabId) {
  const r = recordings.get(tabId);
  try {
    if (r) await chrome.storage.session.set({ ['rec:' + tabId]: r });
    else await chrome.storage.session.remove('rec:' + tabId);
  } catch (_) {
    /* session storage unavailable */
  }
}
async function recGet(tabId) {
  if (recordings.has(tabId)) return recordings.get(tabId);
  try {
    const v = (await chrome.storage.session.get('rec:' + tabId))['rec:' + tabId];
    if (v) recordings.set(tabId, v);
    return v || null;
  } catch (_) {
    return null;
  }
}
// ---------------------------------------------------- always-on debug log
// The last 300 notable events across tabs (extension steps, redirects caught, autofill results,
// confirmations, errors), so a problem can be reported without having started a recording.
const DEBUG_MAX = 300;
let debugQueue = Promise.resolve();
let learnQueue = Promise.resolve();
const DEBUG_TYPES = new Set(['extension-step', 'apply-link-saved', 'application-confirmed', 'tab-closed', 'autofill', 'error']);
function debugAdd(tabId, ev) {
  if (!DEBUG_TYPES.has(ev.type)) return;
  const entry = Object.assign({ at: new Date().toISOString(), tabId }, ev);
  debugQueue = debugQueue.then(async () => {
    try {
      const { debugLog } = await chrome.storage.session.get('debugLog');
      const log = (debugLog || []).concat(entry).slice(-DEBUG_MAX);
      await chrome.storage.session.set({ debugLog: log });
    } catch (_) {
      /* ignore */
    }
  });
}

async function recAdd(tabId, ev) {
  debugAdd(tabId, ev);
  const r = await recGet(tabId);
  if (!r) return;
  if (Date.now() - r.startedAt > REC_MAX_MS) return recStop(tabId);
  ev.t = ev.t || Date.now();
  ev.sinceStartMs = ev.t - r.startedAt;
  r.events.push(ev);
  if (r.events.length > REC_MAX_EVENTS) r.events.splice(0, r.events.length - REC_MAX_EVENTS);
  await recSave(tabId);
}
async function recStart(tabId) {
  const tab = await chrome.tabs.get(tabId);
  recordings.set(tabId, { startedAt: Date.now(), url: tab.url, version: self.JC.VERSION, userAgent: navigator.userAgent, events: [] });
  await recSave(tabId);
  await chrome.action.setBadgeText({ tabId, text: 'REC' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' });
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => globalThis.JC && globalThis.JC.recorder && globalThis.JC.recorder.start() }).catch(() => {});
  return { ok: true };
}
async function recStop(tabId) {
  const r = await recGet(tabId);
  recordings.delete(tabId);
  await recSave(tabId);
  await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => globalThis.JC && globalThis.JC.recorder && globalThis.JC.recorder.stop() }).catch(() => {});
  if (!r) return { ok: false, error: 'This tab was not being recorded.' };
  return { ok: true, report: Object.assign({ kind: 'job-copilot-recording', stoppedAt: Date.now(), durationMs: Date.now() - r.startedAt }, r) };
}

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId !== undefined) recAdd(tab.openerTabId, { type: 'tab-opened', tabId: tab.id, url: tab.pendingUrl || tab.url || '' });
  if (tab.openerTabId === undefined) return;
  const list = childTabs.get(tab.openerTabId) || [];
  list.push({ tabId: tab.id, url: tab.pendingUrl || tab.url || '', title: tab.title || '', openedAt: new Date().toISOString() });
  childTabs.set(tab.openerTabId, list.slice(-5));
});
// ---------------------------------------------------- saved apply links
// Employer application links found for jobs on boards/aggregators: { [jobKey]: { applyUrl, ... } }.
let linkQueue = Promise.resolve();
function saveApplyLink(key, data) {
  linkQueue = linkQueue.then(async () => {
    const { applyLinks } = await chrome.storage.local.get('applyLinks');
    const all = applyLinks || {};
    all[key] = data;
    const keys = Object.keys(all);
    if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete all[k];
    await chrome.storage.local.set({ applyLinks: all });
  });
  return linkQueue;
}

// The job card the user clicked last, per tab: a tab the site opens shortly after (Jobright's
// "Apply Without Customizing") is credited to that job.
const lastJob = new Map(); // tabId -> { key, title, company, at }

// Tabs where an application is in progress, so a confirmation there can be credited to the job
// (and the job board tab that opened it). Kept in session storage: applying can take a while.
async function setApplying(tabId, info) {
  try {
    await chrome.storage.session.set({ ['applying:' + tabId]: Object.assign({ at: Date.now() }, info) });
  } catch (_) {
    /* ignore */
  }
}
async function getApplying(tabId) {
  try {
    return (await chrome.storage.session.get('applying:' + tabId))['applying:' + tabId] || null;
  } catch (_) {
    return null;
  }
}

// ------------------------------------------------ "Apply one by one" queue
// queues: feedTabId -> { active, done: [jobKey], applied, skipped, failed, current: { key, title, tabId } }
// Kept in session storage too: the service worker is stopped after ~30 s idle (while you fill a form).
const queues = new Map();
const queuesReady = chrome.storage.session
  .get('queues')
  .then((v) => {
    for (const [k, q] of Object.entries(v.queues || {})) queues.set(Number(k), q);
  })
  .catch(() => {});
function qSave() {
  return chrome.storage.session.set({ queues: Object.fromEntries(queues) }).catch(() => {});
}
const QUEUE_MAX_FAILS = 3;
async function queueAdvance(feedTabId, why) {
  await queuesReady;
  const q = queues.get(feedTabId);
  if (!q || !q.active) return;
  q.current = null;
  await qSave();
  await chrome.action.setBadgeText({ tabId: feedTabId, text: `Q${q.applied + q.skipped + q.failed + 1}` }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ tabId: feedTabId, color: '#7c3aed' }).catch(() => {});
  let r;
  try {
    await chrome.tabs.update(feedTabId, { active: true });
    r = await chrome.tabs.sendMessage(feedTabId, { type: 'jc:queue-next', skip: q.done });
  } catch (e) {
    r = { ok: false, done: true, reason: 'The job board tab is gone: ' + (e.message || e) };
  }
  recAdd(feedTabId, { type: 'extension-step', detail: { queue: true, why, next: r } });
  if (!r || r.done) {
    q.active = false;
    q.finishedReason = (r && r.reason) || 'finished';
    await qSave();
    await chrome.action.setBadgeText({ tabId: feedTabId, text: '' }).catch(() => {});
    return;
  }
  if (!r.ok) {
    q.done.push(r.key);
    q.failed++;
    q.lastError = `${r.title}: ${r.reason}`;
    if (q.failed >= QUEUE_MAX_FAILS && q.applied + q.skipped === 0) {
      q.active = false;
      q.finishedReason = 'Stopped: the first jobs could not be opened (' + r.reason + ')';
      await qSave();
      return;
    }
    await qSave();
    setTimeout(() => queueAdvance(feedTabId, 'previous job failed'), 1500);
    return;
  }
  // The employer tab was opened by jc:open-tab (queue: true), which sets q.current.
  q.done.push(r.key);
  await qSave();
}

async function markApplied(tabId, msg, senderUrl) {
  const info = await getApplying(tabId);
  const at = new Date().toISOString();
  const record = { at, confirmation: String(msg.text || '').slice(0, 200), pageTitle: String(msg.title || '').slice(0, 200), applyUrl: (info && info.applyUrl) || senderUrl || '', key: (info && info.key) || '', title: (info && info.title) || '', company: (info && info.company) || '' };
  const { applications, applyLinks, savedJobs } = await chrome.storage.local.get(['applications', 'applyLinks', 'savedJobs']);
  const apps = (applications || []).filter((a) => !(record.key && a.key === record.key) && a.applyUrl !== record.applyUrl);
  apps.push(record);
  const links = applyLinks || {};
  if (record.key) links[record.key] = Object.assign({}, links[record.key] || {}, { appliedAt: at, applyUrl: (links[record.key] && links[record.key].applyUrl) || record.applyUrl });
  const saved = (savedJobs || []).map((j) => (j.url && (j.url === record.key || j.applyUrl === record.applyUrl) ? Object.assign({}, j, { status: 'applied', appliedAt: at }) : j));
  await chrome.storage.local.set({ applications: apps.slice(-1000), applyLinks: links, savedJobs: saved });
  await chrome.action.setBadgeText({ tabId, text: '✓' }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' }).catch(() => {});
  if (info && info.openerTabId) chrome.tabs.sendMessage(info.openerTabId, { type: 'jc:applied', key: record.key, at }).catch(() => {});
  recAdd(tabId, { type: 'application-confirmed', key: record.key, url: senderUrl, text: record.confirmation });
  if (info && info.openerTabId) recAdd(info.openerTabId, { type: 'application-confirmed', key: record.key, url: senderUrl });
  // Apply one by one: move on to the next job after a confirmed submission.
  await queuesReady;
  for (const [feedTabId, q] of queues) {
    if (q.active && q.current && q.current.tabId === tabId) {
      q.applied++;
      q.current = null;
      await qSave();
      setTimeout(async () => {
        await chrome.tabs.remove(tabId).catch(() => {});
        queueAdvance(feedTabId, 'applied');
      }, 3000);
    }
  }
  return { ok: true, key: record.key };
}

// Autofill an employer form opened from a job board, once it has loaded (setting autoFillOpened).
const autofillDone = new Set();
const autofillPending = new Map();
const startedApply = new Set(); // tabs where the employer's Apply was clicked already
const loginNoted = new Set(); // tabId -> timer (debounce: several load events per step)
function scheduleAutofill(tabId, openerTabId, pageKey) {
  clearTimeout(autofillPending.get(tabId));
  // Once per distinct form (multi-step forms: iCIMS, Workday, Taleo… get each step), identified by
  // the form's question labels, since some systems keep the same URL path across steps.
  const attempt = async (n) => {
    const { settings } = await chrome.storage.local.get('settings');
    if (settings && settings.autoFillOpened === false) return;
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_) {
      return;
    }
    if (tab.status !== 'complete' && n < 10) return setTimeout(() => attempt(n + 1), 1000);
    const d = await runCommand(tabId, 'detect', {}, 'popup').catch(() => null);
    if (d && d.login && d.login.required) {
      // Sign-in / create-account steps are the user's; the next page gets autofilled after.
      if (!loginNoted.has(tabId + '|' + tab.url)) {
        loginNoted.add(tabId + '|' + tab.url);
        debugAdd(tabId, { type: 'extension-step', detail: { step: 'sign-in or create-account page: waiting for you', url: tab.url } });
      }
      // Some sites show the form in place after sign-in (no new page load): keep checking.
      if (n < 200) autofillPending.set(tabId, setTimeout(() => attempt(n + 1), 4000));
      return;
    }
    if (d && !d.application && d.pageType === 'job' && !startedApply.has(tabId)) {
      // The employer's own job page (Workday, iCIMS, SmartRecruiters…): start the application.
      const { settings: st } = await chrome.storage.local.get('settings');
      if (!st || st.autoContinue !== false) {
        startedApply.add(tabId);
        const s = await runCommand(tabId, 'startApplication', {}, 'popup').catch((e) => ({ ok: false, reason: String(e) }));
        debugAdd(tabId, { type: 'extension-step', detail: { step: 'started the application on the employer page', result: s && (s.chose || (s.login && 'sign-in') || (s.form && 'form') || s.reason), steps: s && s.steps } });
        return setTimeout(() => attempt(1), 2500);
      }
    }
    const scan = await runCommand(tabId, 'scanForm', {}, 'popup').catch(() => null);
    // Any page in an application tab with at least two questions we know how to answer counts,
    // not only pages that look like a classic application (later steps have no name or email).
    const keyed = ((scan && scan.fields) || []).filter((f) => f.profileKey && f.type !== 'file').length;
    if (!d || (!d.application && keyed < 2)) {
      if (n < 6) autofillPending.set(tabId, setTimeout(() => attempt(n + 1), 1500)); // forms rendered by JavaScript
      return;
    }
    const sig = tabId + '|' + ((scan && scan.fields) || []).map((f) => f.label).slice(0, 12).join('|');
    if (autofillDone.has(sig)) return;
    autofillDone.add(sig);
    const r = await runCommand(tabId, 'autofill', {}, 'popup').catch((e) => ({ ok: false, error: String(e) }));
    debugAdd(tabId, { type: 'extension-step', detail: { step: 'auto-filled application page', page: pageKey || tab.url, filled: r && r.filledCount, needsInput: r && r.needsInput && r.needsInput.length, error: r && r.error } });
    if (openerTabId) recAdd(openerTabId, { type: 'extension-step', detail: { step: 'autofilled employer form', tabId, filled: r && r.filledCount, needsInput: r && r.needsInput && r.needsInput.length, error: r && r.error } });
    if (r && r.ok) {
      await chrome.action.setBadgeText({ tabId, text: 'FILL' }).catch(() => {});
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#16a34a' }).catch(() => {});
    }
  };
  autofillPending.set(tabId, setTimeout(() => attempt(0), 1500));
}

// Application tabs (opened from a job board): autofill each new page or step as it loads.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' && !info.url) return;
  const applying = await getApplying(tabId);
  if (!applying) return;
  let page = '';
  try {
    const u = new URL(tab.url || info.url || '');
    page = u.origin + u.pathname; // query strings change on every step reload; the path marks the step
  } catch (_) {
    return;
  }
  scheduleAutofill(tabId, applying.openerTabId || null, page);
});

// Tabs whose job link is already known (opened by Job Copilot itself, or credited once): later
// redirects in those tabs (login pages, error pages, ATS hops) must not overwrite the saved link.
const linkSettledTabs = new Set();

async function creditOpenedTab(openerId, url, childTabId) {
  if (childTabId && linkSettledTabs.has(childTabId)) return;
  const lj = lastJob.get(openerId);
  if (!lj || Date.now() - lj.at > 90000) return;
  let opener;
  try {
    opener = await chrome.tabs.get(openerId);
  } catch (_) {
    return;
  }
  const real = self.JC.unwrapUrl(url);
  const host = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  };
  if (!/^https?:/i.test(real) || host(real) === host(opener.url || '')) return;
  const data = { applyUrl: real, applyHost: host(real), via: 'your-click', at: new Date().toISOString(), title: lj.title || '', company: lj.company || '' };
  lastJob.delete(openerId);
  if (childTabId) linkSettledTabs.add(childTabId);
  await saveApplyLink(lj.key, data);
  if (childTabId) {
    await setApplying(childTabId, { key: lj.key, title: lj.title, company: lj.company, openerTabId: openerId, applyUrl: real });
    scheduleAutofill(childTabId, openerId);
  }
  chrome.tabs.sendMessage(openerId, { type: 'jc:apply-link-seen', key: lj.key, data }).catch(() => {});
  recAdd(openerId, { type: 'apply-link-saved', key: lj.key, url: real });
}

// ---------------------------------------------------- real clicks (optional)
// With the user's opt-in (debugger permission), click like a real mouse via the DevTools protocol,
// so sites that ignore script clicks respond. Chrome shows a "debugging this browser" bar meanwhile.
const debugAttached = new Map(); // tabId -> detach timer
async function realClick(tabId, x, y) {
  if (!chrome.debugger) return { ok: false, error: 'Real clicks need the debugger permission (Job Copilot options).' };
  const target = { tabId };
  try {
    if (!debugAttached.has(tabId)) await chrome.debugger.attach(target, '1.3');
    clearTimeout(debugAttached.get(tabId));
    debugAttached.set(tabId, setTimeout(() => chrome.debugger.detach(target).catch(() => {}), 30000));
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
if (chrome.debugger) chrome.debugger.onDetach.addListener((src) => debugAttached.delete(src.tabId));

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url && tab.openerTabId !== undefined) recAdd(tab.openerTabId, { type: 'tab-url', tabId, url: info.url });
  if (info.url && tab.openerTabId !== undefined && /^https?:/i.test(info.url)) creditOpenedTab(tab.openerTabId, info.url, tabId);
  if (!info.url && !info.title) return;
  for (const list of childTabs.values()) for (const c of list) if (c.tabId === tabId) Object.assign(c, { url: tab.url || c.url, title: tab.title || c.title });
});
// Tabs that open and close again within seconds (Jobright does this before its pop-up). Their
// address is often the real application link, so keep it, reported as detect().flashedTabs.
const flashedTabs = new Map(); // openerTabId -> [{ url, openedAt, closedAt }]
chrome.tabs.onRemoved.addListener((tabId) => {
  // Apply one by one: closing the employer tab without submitting skips that job.
  queuesReady.then(() => {
    for (const [feedTabId, q] of queues) {
      if (q.active && q.current && q.current.tabId === tabId) {
        q.skipped++;
        q.current = null;
        setTimeout(() => queueAdvance(feedTabId, 'skipped (tab closed)'), 800);
      }
      if (feedTabId === tabId) queues.delete(tabId);
    }
    qSave();
  });
  for (const [opener, list] of childTabs) {
    const c = list.find((x) => x.tabId === tabId);
    if (c) recAdd(opener, { type: 'tab-closed', tabId, url: c.url, openForMs: Date.now() - Date.parse(c.openedAt) });
  }
  if (recordings.has(tabId)) {
    recordings.delete(tabId);
    recSave(tabId);
  }
  childTabs.delete(tabId);
  flashedTabs.delete(tabId);
  for (const [k, list] of childTabs) {
    const gone = list.find((c) => c.tabId === tabId);
    if (gone && Date.now() - Date.parse(gone.openedAt) < 15000 && /^https?:/.test(gone.url)) {
      flashedTabs.set(k, (flashedTabs.get(k) || []).concat({ url: gone.url, openedAt: gone.openedAt, closedAt: new Date().toISOString() }).slice(-5));
    }
    childTabs.set(k, list.filter((c) => c.tabId !== tabId));
  }
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
      const submitted = frames.map((f) => f.submitted).find(Boolean);
      const out = Object.assign({}, top, { login, jobCount: top.jobCount || 0 });
      if (submitted) out.submitted = submitted;
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
    case 'resolveApplyLinks': {
      const f = frames.find((x) => x.frameId === 0) || frames[0];
      return Object.assign({}, f, { count: (f.jobs || []).length });
    }
    case 'loadMoreJobs':
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
      return { ok: true, url: top.frame, portal: top.portal, count: jobs.length, added: frames.reduce((n, f) => n + (f.added || 0), 0), jobs };
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
      const out = { ok: errors.length < frames.length, filledCount: 0, filled: [], skipped: [], needsInput: [], corrected: [], review: [], errors };
      for (const f of frames) {
        if (!f.ok) continue;
        out.filledCount += f.filledCount || 0;
        if (f.parseWaitMs) out.parseWaitMs = Math.max(out.parseWaitMs || 0, f.parseWaitMs);
        out.corrected.push(...(f.corrected || []));
        const tag = (x) => Object.assign({ frame: f.isTop === false ? f.frame : 'top' }, x);
        out.filled.push(...(f.filled || []).map(tag));
        out.skipped.push(...(f.skipped || []).map(tag));
        out.needsInput.push(...(f.needsInput || []).map(tag));
        out.review.push(...(f.review || []).map(tag));
      }
      if (!out.ok) out.error = errors[0] && errors[0].error;
      out.reminder = 'Nothing was submitted. Review the form, answer needsInput items, then ask the user before clicking Submit.';
      return out;
    }
    case 'reviewFix': {
      const out = { ok: true, changed: [], flagged: [] };
      for (const f of frames) {
        out.changed.push(...(f.changed || []));
        out.flagged.push(...(f.flagged || []));
      }
      return out;
    }
    case 'followApply':
      return frames.find((f) => f.frameId === 0) || frames[0];
    case 'startApplication':
      return frames.find((f) => f.frameId === 0) || frames[0];
    case 'nextStep':
      return frames.find((f) => f.ok) || frames.find((f) => f.submit) || frames.find((f) => f.frameId === 0) || frames[0];
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

// ------------------------------------------------------------ on-device check (Gemini Nano)
// The Prompt API isn't available in a service worker, so an offscreen page runs the model.
let offscreenReady = null;
async function ensureOffscreen() {
  if (!chrome.offscreen) throw new Error('offscreen pages need Chrome 109+');
  const has = chrome.runtime.getContexts ? (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0 : false;
  if (has) return;
  offscreenReady =
    offscreenReady ||
    chrome.offscreen
      .createDocument({ url: 'offscreen/nano.html', reasons: ['DOM_PARSER'], justification: "Run Chrome's on-device model to double-check autofilled answers" })
      .catch((e) => {
        if (!/single offscreen|already/i.test(String(e))) throw e;
      })
      .finally(() => (offscreenReady = null));
  await offscreenReady;
}

let aiQueue = Promise.resolve();
function aiCheck(tabId, review) {
  aiQueue = aiQueue.then(async () => {
    const { settings, profile, __testNanoReply } = await chrome.storage.local.get(['settings', 'profile', '__testNanoReply']);
    if ((settings && settings.aiCheck === false) || !profile) return;
    const t0 = Date.now();
    let res;
    try {
      await ensureOffscreen();
      res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'jc:nano-check', review, profile, testReply: __testNanoReply });
    } catch (e) {
      res = { ok: false, error: String(e.message || e) };
    }
    if (!res || !res.ok) {
      debugAdd(tabId, { type: 'extension-step', detail: { step: 'on-device check skipped', reason: ((res && res.error) || 'no reply').slice(0, 200) } });
      return;
    }
    debugAdd(tabId, { type: 'extension-step', detail: { step: 'on-device check', checked: res.checked, ms: Date.now() - t0, disagreed: res.fixes.map((f) => `${f.label.slice(0, 60)}: ${f.from} -> ${f.to}`) } });
    if (!res.fixes.length) return;
    const byFrame = await runInFrames(tabId, 'reviewFix', { fixes: res.fixes, _origin: 'ai-check' }).catch(() => []);
    const out = merge('reviewFix', byFrame);
    debugAdd(tabId, { type: 'extension-step', detail: { step: 'on-device check applied', changed: (out.changed || []).map((c) => `${c.label.slice(0, 60)}: ${c.from} -> ${c.to}`), flagged: (out.flagged || []).map((c) => c.label.slice(0, 60)) } });
  });
  return aiQueue;
}

async function runCommand(tabId, cmd, payload, origin) {
  if (!FRAME_CMDS.has(cmd) || cmd === 'reviewFix') return { ok: false, error: `unknown command: ${cmd}` };
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
  if (cmd === 'autofill') {
    const tab = await chrome.tabs.get(tabId).catch(() => ({}));
    debugAdd(tabId, { type: 'autofill', url: tab.url, from: origin, ok: out.ok, error: out.error, filled: out.filledCount, needsInput: (out.needsInput || []).map((f) => `${(f.label || '').slice(0, 80)} (${f.reason})`).slice(0, 30), corrected: (out.corrected || []).map((c) => c.label), parseWaitMs: out.parseWaitMs });
    if (out.review && out.review.length) aiCheck(tabId, out.review); // runs on its own, after the reply
    delete out.review;
  } else if (out && out.ok === false && out.error) {
    debugAdd(tabId, { type: 'error', cmd, from: origin, error: String(out.error).slice(0, 300) });
  }
  if (cmd === 'detect') {
    const kids = (childTabs.get(tabId) || []).filter((c) => /^https?:/.test(c.url));
    if (kids.length) out.openedTabs = kids;
    const flashed = flashedTabs.get(tabId) || [];
    if (flashed.length) out.flashedTabs = flashed.map((f) => Object.assign({}, f, { url: self.JC.unwrapUrl ? self.JC.unwrapUrl(f.url) : f.url }));
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

let rememberQueue = Promise.resolve();
async function rememberAnswers(items, ctx) {
  const { settings, profile } = await chrome.storage.local.get(['settings', 'profile']);
  if ((settings && settings.rememberAnswers === false) || !profile || !Array.isArray(items)) return { ok: false };
  const p = self.JC.normalizeProfile(profile);
  const r = self.JC.rules.mergeAnswers(p.answers, items.slice(0, 60), { company: String((ctx && ctx.company) || '').slice(0, 80), host: String((ctx && ctx.host) || '').slice(0, 120) });
  p.answers = r.answers; // also persists updated use counts
  await chrome.storage.local.set({ profile: p });
  return { ok: true, added: r.added, updated: r.updated };
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
    if (msg.type === 'jc:applying' && sender.tab && !fromExt) {
      // followApply in the same tab: the job board page is replaced by the employer's form.
      if (msg.job && msg.job.key) await setApplying(sender.tab.id, Object.assign({}, msg.job, { openerTabId: null, applyUrl: msg.url }));
      return { ok: true };
    }
    if (msg.type === 'jc:applied-confirmed' && sender.tab && !fromExt) {
      return markApplied(sender.tab.id, msg, sender.url || sender.tab.url);
    }
    if (msg.type === 'jc:apply-link-save' && sender.tab && !fromExt) {
      if (msg.key && msg.data && /^https?:/i.test(String(msg.data.applyUrl || ''))) await saveApplyLink(String(msg.key).slice(0, 500), msg.data);
      return { ok: true };
    }
    if (msg.type === 'jc:last-job' && sender.tab && !fromExt) {
      lastJob.set(sender.tab.id, { key: String(msg.key || '').slice(0, 500), title: msg.title, company: msg.company, at: Date.now() });
      return { ok: true };
    }
    if (msg.type === 'jc:progress' && sender.tab && !fromExt) {
      await chrome.action.setBadgeText({ tabId: sender.tab.id, text: String(msg.text || '').slice(0, 5) });
      if (msg.text) await chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#7c3aed' });
      return { ok: true };
    }
    if (msg.type === 'jc:real-click' && sender.tab && !fromExt && sender.frameId === 0) {
      const { settings } = await chrome.storage.local.get('settings');
      if (!settings || !settings.realClicks) return { ok: false, error: 'Real clicks are turned off.' };
      return realClick(sender.tab.id, Number(msg.x), Number(msg.y));
    }
    if (msg.type === 'jc:open-tab' && sender.tab && !fromExt) {
      // followApply({ newTab: true }): open the employer's application next to the job board tab.
      if (!/^https?:\/\//i.test(String(msg.url || ''))) return { ok: false };
      msg.url = self.JC.cleanApplyUrl(msg.url);
      const t = await chrome.tabs.create({ url: msg.url, openerTabId: sender.tab.id, index: sender.tab.index + 1 });
      linkSettledTabs.add(t.id);
      if (msg.queue) {
        await queuesReady;
        const q = queues.get(sender.tab.id);
        if (q && q.active) {
          q.current = { key: msg.job && msg.job.key, title: msg.job && msg.job.title, tabId: t.id };
          await qSave();
        }
      }
      if (msg.job && msg.job.key) await setApplying(t.id, Object.assign({}, msg.job, { openerTabId: sender.tab.id, applyUrl: msg.url }));
      if (msg.autofill) scheduleAutofill(t.id, sender.tab.id);
      return { ok: true, tabId: t.id };
    }
    if (msg.type === 'jc:form-changed' && sender.tab && !fromExt) {
      // New questions appeared in place (single-page ATS steps): autofill if this is an application tab.
      const applying = await getApplying(sender.tab.id);
      if (applying) scheduleAutofill(sender.tab.id, applying.openerTabId || null, 'form changed');
      return { ok: true, applying: !!applying };
    }
    if (msg.type === 'jc:learn-label' && sender.tab && !fromExt) {
      // Label learned from another autofill: label text and profile key only, never the value.
      const label = String(msg.label || '').slice(0, 120);
      const key = String(msg.key || '');
      const allowed = ['firstName', 'lastName', 'preferredName', 'email', 'phone', 'address1', 'address2', 'city', 'state', 'postalCode', 'country', 'linkedin', 'github', 'portfolio', 'website', 'twitter', 'currentTitle', 'currentCompany', 'school', 'degree', 'fieldOfStudy'];
      if (!label || !allowed.includes(key)) return { ok: false };
      learnQueue = learnQueue.then(async () => {
        const { learnedLabels } = await chrome.storage.local.get('learnedLabels');
        const all = learnedLabels || {};
        const prev = all[label];
        all[label] = { key, display: String(msg.display || label).slice(0, 120), host: String(msg.host || '').slice(0, 120), count: prev && prev.key === key ? (prev.count || 1) + 1 : 1, at: new Date().toISOString(), replaces: msg.replaces || undefined };
        await chrome.storage.local.set({ learnedLabels: all });
      });
      await learnQueue;
      debugAdd(sender.tab.id, { type: 'extension-step', detail: { step: 'learned a field label from another autofill', label: String(msg.display || label).slice(0, 120), key, host: msg.host } });
      return { ok: true };
    }
    if (msg.type === 'jc:debug' && sender.tab && !fromExt) {
      debugAdd(sender.tab.id, Object.assign({}, msg.event));
      return { ok: true };
    }
    if (msg.type === 'jc:debug-get' && fromExt) {
      const { debugLog } = await chrome.storage.session.get('debugLog').catch(() => ({}));
      return { ok: true, log: debugLog || [], version: self.JC.VERSION, userAgent: navigator.userAgent };
    }
    if (msg.type === 'jc:debug-clear' && fromExt) {
      await chrome.storage.session.remove('debugLog').catch(() => {});
      return { ok: true };
    }
    if (msg.type === 'jc:rec-event' && sender.tab && !fromExt) {
      await recAdd(sender.tab.id, Object.assign({}, msg.event, { frameId: sender.frameId }));
      return { ok: true };
    }
    if (msg.type === 'jc:rec-status' && sender.tab && !fromExt) {
      return { on: !!(await recGet(sender.tab.id)) };
    }
    if (msg.type && msg.type.startsWith('jc:queue-')) await queuesReady;
    if (msg.type === 'jc:queue-start' && fromExt) {
      queues.set(msg.tabId, { active: true, done: [], applied: 0, skipped: 0, failed: 0, current: null, startedAt: Date.now() });
      await qSave();
      queueAdvance(msg.tabId, 'start');
      return { ok: true };
    }
    if (msg.type === 'jc:queue-skip' && fromExt) {
      const q = queues.get(msg.tabId);
      if (q && q.current) await chrome.tabs.remove(q.current.tabId).catch(() => {}); // onRemoved moves on
      return { ok: true };
    }
    if (msg.type === 'jc:queue-stop' && fromExt) {
      const q = queues.get(msg.tabId);
      if (q) {
        q.active = false;
        q.finishedReason = 'stopped';
        await qSave();
      }
      await chrome.action.setBadgeText({ tabId: msg.tabId, text: '' }).catch(() => {});
      return { ok: true };
    }
    if (msg.type === 'jc:queue-state' && fromExt) {
      const q = queues.get(msg.tabId);
      return q ? { active: q.active, applied: q.applied, skipped: q.skipped, failed: q.failed, current: q.current, lastError: q.lastError, finishedReason: q.finishedReason } : { active: false };
    }
    if (msg.type === 'jc:rec-start' && fromExt) return recStart(msg.tabId);
    if (msg.type === 'jc:rec-stop' && fromExt) return recStop(msg.tabId);
    if (msg.type === 'jc:rec-query' && fromExt) {
      const r = await recGet(msg.tabId);
      return { on: !!r, events: r ? r.events.length : 0 };
    }
    if (msg.type === 'jc:remember' && sender.tab && !fromExt) {
      // Answers to new questions captured on Submit/Next. Merged one at a time here so
      // several frames can't overwrite each other's writes.
      return (rememberQueue = rememberQueue.then(() => rememberAnswers(msg.items, msg.ctx)));
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
