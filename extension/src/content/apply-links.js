/*
 * Job Copilot: find the employer's real application link for jobs listed on a
 * board or aggregator (Jobright, Simplify, ZipRecruiter, Built In, ...).
 *
 *   JC.applyLinks.findIn(htmlOrText)        -> { url, via } | null      (pure-ish string scan)
 *   JC.applyLinks.resolve({ limit, delayMs }) -> { resolved, failed, blocked, jobs }
 *
 * For each listed job (JC.extract.listings()):
 *   1. fetch the job's own page on this site (same origin, the user's session) and
 *      scan its links and embedded data for the employer URL, no clicking;
 *   2. otherwise, for link-less cards, click the card, scan the detail view, go back.
 * Slow on purpose (one job every ~1.5 s, 15 per run by default), and it stops if the
 * site answers with a bot/security check instead of trying to get around it.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});
  if (JC.applyLinks) return;

  // Employer application systems: a URL on one of these is the real application.
  const ATS = /^https?:\/\/(?:[a-z0-9-]+\.)*(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|icims\.com|smartrecruiters\.com|jobvite\.com|workable\.com|bamboohr\.com|recruitee\.com|breezy\.hr|teamtailor\.com|taleo\.net|successfactors\.(com|eu)|oraclecloud\.com|rippling(-ats)?\.com|dover\.com|applytojob\.com|paylocity\.com|jazzhr\.com|personio\.(de|com)|pinpointhq\.com|gem\.com|wellfound\.com|careers-page\.com|ultipro\.com|adp\.com|eightfold\.ai)\//i;
  const KEYED = /"(apply_?url|applyUrl|applyLink|apply_link|applicationUrl|application_url|originalUrl|original_url|originalLink|externalUrl|external_url|externalApplyUrl|sourceUrl|source_url|jobUrl|job_url|redirectUrl|redirect_url)"\s*:\s*"(https?:[^"\s]{8,600})"/gi;
  const ANY_URL = /https?:(?:\/|\\u002F|\\\/){2}[^\s"'<>\\]{6,600}/gi;

  function unescape(u) {
    return u.replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/&amp;/g, '&');
  }

  function hostOf(u) {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch (_) {
      return '';
    }
  }

  /** Scan HTML/text for the employer's application URL. Returns the best candidate. */
  function findIn(text, selfHost) {
    if (!text) return null;
    const self = (selfHost || location.hostname).replace(/^www\./, '');
    const unwrap = (raw) => {
      // Unescape JSON/HTML, then follow redirect params (?url=https%3A...) up to twice.
      let u = unescape(raw);
      for (let i = 0; i < 2; i++) {
        let next = '';
        try {
          for (const [k, v] of new URL(u).searchParams) if (/^(url|u|dest|destination|target|redirect|redirect_url|to|link|joburl|apply_url|applyurl)$/i.test(k) && /^https?:\/\//i.test(v)) next = v;
        } catch (_) {
          break;
        }
        if (!next) break;
        u = next;
      }
      return u;
    };
    // 1. Explicit apply/original/external URL fields in embedded JSON (Next.js data, JSON-LD, ...).
    KEYED.lastIndex = 0;
    let m;
    const keyed = [];
    while ((m = KEYED.exec(text))) {
      const u = unwrap(m[2]);
      if (hostOf(u) && hostOf(u) !== self) keyed.push(u);
    }
    const keyedAts = keyed.find((u) => ATS.test(u));
    if (keyedAts) return { url: keyedAts, via: 'page-data' };
    // 2. Any employer-ATS URL anywhere on the page (links, redirect params, scripts).
    ANY_URL.lastIndex = 0;
    const all = (text.match(ANY_URL) || []).map(unwrap);
    const ats = all.find((u) => ATS.test(u));
    if (ats) return { url: ats.replace(/[),.;]+$/, ''), via: 'page-link' };
    // 3. A keyed external URL on another site (company careers page).
    if (keyed.length) return { url: keyed[0], via: 'page-data' };
    return null;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const looksBlocked = (html) => /security check|verify you are human|cf-challenge|challenges\.cloudflare\.com|captcha/i.test(html.slice(0, 20000));

  async function fromJobPage(url) {
    const res = await fetch(url, { credentials: 'include' });
    const html = await res.text();
    if (res.status === 403 || res.status === 429 || looksBlocked(html)) return { blocked: true };
    return findIn(html, new URL(url).hostname) || { none: true };
  }

  async function fromCardClick(selector) {
    const card = document.querySelector(selector);
    if (!card) return { none: true };
    const before = location.href;
    card.click();
    await sleep(1500);
    // Look at the detail view: the Apply button's link, then anything on the page.
    const info = JC.nav && JC.nav.applyInfo();
    let hit = info && info.target && /^https?:/.test(info.target) && hostOf(info.target) !== location.hostname.replace(/^www\./, '') ? { url: info.target, via: 'apply-link' } : null;
    if (!hit) hit = findIn(document.documentElement.innerHTML);
    if (location.href !== before) {
      history.back();
      await sleep(1200);
    }
    return hit || { none: true };
  }

  // ------------------------------------------------ saved apply links (persist across reloads)
  // { [jobKey]: { applyUrl, applyHost, via, at, title, company } }, written by the service worker.
  const known = {};
  const jobKey = (j) => j.url || (j.jobId ? location.hostname + ':' + j.jobId : '');
  try {
    chrome.storage.local.get('applyLinks').then((v) => Object.assign(known, v.applyLinks || {}));
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.applyLinks) Object.assign(known, ch.applyLinks.newValue || {});
    });
  } catch (_) {
    /* not in an extension context (unit tests) */
  }

  /** Copy saved links onto listed jobs (called by JC.extract.listings). */
  function merge(j) {
    const k = jobKey(j);
    const hit = k && known[k];
    if (hit && !j.applyUrl && hit.applyUrl) Object.assign(j, { applyUrl: hit.applyUrl, applyHost: hit.applyHost, applyVia: hit.via });
    if (hit && hit.appliedAt) j.appliedAt = hit.appliedAt;
    return j;
  }

  function save(j, url, via) {
    const key = jobKey(j);
    const data = { applyUrl: url, applyHost: hostOf(url), via, at: new Date().toISOString(), title: j.title || '', company: j.company || '' };
    if (key) known[key] = data;
    Object.assign(j, { applyUrl: url, applyHost: data.applyHost, applyVia: via });
    if (key) chrome.runtime.sendMessage({ type: 'jc:apply-link-save', key, data }).catch(() => {});
  }

  // Links caught from the user's own clicks (the service worker sees the tab Jobright opens).
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'jc:applied' && msg.key) {
        known[msg.key] = Object.assign({}, known[msg.key] || {}, { appliedAt: msg.at });
        answerAppliedPrompt(msg.key);
      }
      if (msg && msg.type === 'jc:apply-link-seen' && msg.key && msg.data) {
        known[msg.key] = msg.data;
        for (const j of JC.extract.listings()) if (jobKey(j) === msg.key) Object.assign(j, { applyUrl: msg.data.applyUrl, applyHost: msg.data.applyHost, applyVia: msg.data.via });
      }
    });
  } catch (_) {
    /* ignore */
  }

  /**
   * The employer site confirmed the application for `key`: answer this board's "Did you apply?"
   * with Yes (it's usually still open on this tab). Waits up to 10 minutes for the prompt. Only
   * ever called after a confirmation; turn off with settings.answerAppliedPrompt = false.
   */
  async function answerAppliedPrompt(key) {
    try {
      const { settings } = await chrome.storage.local.get('settings');
      if (settings && settings.answerAppliedPrompt === false) return;
    } catch (_) {
      return;
    }
    const end = Date.now() + 10 * 60 * 1000;
    const tick = () => {
      const p = JC.nav && JC.nav.appliedPrompt();
      if (p && p.yesSelector) {
        const yes = document.querySelector(p.yesSelector);
        if (yes) {
          yes.click();
          return;
        }
      }
      if (Date.now() < end) setTimeout(tick, 2000);
    };
    tick();
  }

  // Remember which job card the user clicked last, so a tab Jobright opens a moment later
  // (after "Apply Without Customizing") can be credited to that job.
  if (typeof document !== 'undefined') document.addEventListener(
    'click',
    (e) => {
      const portal = JC.portalForHost(location.hostname);
      if (!portal || !portal.aggregator || window !== window.top) return;
      const card = e.target && e.target.closest && e.target.closest('div[id]');
      let c = card;
      while (c && !/^[0-9a-f]{24}$/i.test(c.id)) c = c.parentElement && c.parentElement.closest('div[id]');
      if (!c) return;
      const j = JC.extract.listings().find((x) => x.jobId === c.id);
      if (j) chrome.runtime.sendMessage({ type: 'jc:last-job', key: jobKey(j), title: j.title, company: j.company }).catch(() => {});
    },
    true
  );

  // ------------------------------------------------------------- resolving
  let stopRequested = false;
  function stop() {
    stopRequested = true;
    return { ok: true };
  }
  const progress = (text) => chrome.runtime.sendMessage({ type: 'jc:progress', text }).catch(() => {});

  /** Cards currently in the page, in order, each with its job record. */
  function cardsOnPage() {
    const jobs = JC.extract.listings();
    return jobs.filter((j) => j.selector && document.querySelector(j.selector));
  }

  /**
   * Click-through mode (Jobright & co.): for each card, click its Apply, take the pop-up's skip
   * option, catch the employer address, close the site's pop-ups unanswered. Scrolls for more
   * cards as it goes. Every step is logged in `log`.
   */
  async function resolveByClicking(opts) {
    const limit = Math.min(opts.limit || 50, 100);
    const delayMs = Math.max(opts.delayMs === undefined ? 1200 : opts.delayMs, 0);
    stopRequested = false;
    const log = [];
    const done = new Set();
    let resolved = 0;
    let failed = 0;
    let emptyScrolls = 0;
    while (done.size < limit && !stopRequested) {
      const next = cardsOnPage().find((j) => !done.has(jobKey(j)) && !j.applyUrl);
      if (!next) {
        // Everything visible is done: scroll for more cards.
        const r = await JC.extract.loadMore({ rounds: 1 });
        if (!r.added && ++emptyScrolls >= 2) break;
        if (r.added) emptyScrolls = 0;
        continue;
      }
      done.add(jobKey(next));
      const card = document.querySelector(next.selector);
      card.scrollIntoView({ block: 'center' });
      await sleep(300);
      const trace = [];
      progress(`${done.size}/${limit}`);
      let f;
      try {
        f = await JC.nav.followApply({ scope: next.selector, navigate: false, trace });
      } catch (e) {
        f = { ok: false, reason: String(e.message || e) };
      }
      await sleep(500);
      JC.nav.closeDialogs();
      await sleep(400);
      JC.nav.closeDialogs();
      if (f && f.ok && f.to) {
        save(next, f.to, 'apply-button');
        resolved++;
      } else {
        next.applyError = (f && f.reason) || 'Apply did not reveal an employer link';
        failed++;
      }
      log.push({ job: `${next.title} @ ${next.company}`, key: jobKey(next), result: next.applyUrl || 'not found', steps: trace });
      if (JC.recorder && JC.recorder.note) JC.recorder.note({ job: next.title, applyUrl: next.applyUrl || null, steps: trace });
      if (delayMs) await sleep(delayMs);
    }
    progress('');
    const jobs = JC.extract.listings();
    return { resolved, failed, stopped: stopRequested, remaining: jobs.filter((j) => !j.applyUrl && !done.has(jobKey(j))).length, jobs, log };
  }

  async function resolve(opts) {
    opts = opts || {};
    // Aggregators like Jobright only reveal the employer link through their Apply flow, and fetching
    // their job pages may hit a security check, so go straight to clicking through.
    if (opts.viaApply) return resolveByClicking(opts);
    const limit = Math.min(opts.limit || 15, 40);
    const delayMs = Math.max(opts.delayMs === undefined ? 1500 : opts.delayMs, 0);
    const jobs = JC.extract.listings();
    const self = location.hostname.replace(/^www\./, '');
    let resolved = 0;
    let failed = 0;
    let blocked = false;
    let tried = 0;
    for (const j of jobs) {
      if (tried >= limit || blocked) break;
      if (j.applyUrl || j.applyTried) continue;
      j.applyTried = true;
      tried++;
      let r = null;
      try {
        if (j.url && hostOf(j.url) === self) r = await fromJobPage(j.url);
        else if (j.url && ATS.test(j.url)) r = { url: j.url, via: 'listing' };
        // Clicking is the last resort, only for cards with no job link at all (a click may load another page).
        if (!r && j.selector) r = await fromCardClick(j.selector);
      } catch (e) {
        r = { error: String(e.message || e) };
      }
      if (r && r.blocked) {
        blocked = true;
        j.applyTried = false;
        break;
      }
      if (r && r.url) {
        save(j, r.url, r.via);
        resolved++;
      } else {
        j.applyError = (r && r.error) || 'no employer link found on the job page';
        failed++;
      }
      if (delayMs) await sleep(delayMs);
    }
    return {
      resolved,
      failed,
      blocked,
      remaining: jobs.filter((j) => !j.applyUrl && !j.applyTried).length,
      note: blocked ? 'The site answered with a security check. Try resolveApplyLinks({ viaApply: true }) (clicks through Apply instead), or ask the user to open one job by hand. Never try to get around the check.' : undefined,
      jobs,
    };
  }

  JC.applyLinks = { findIn, resolve, stop, merge, save, jobKey, ATS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
