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

  async function resolve(opts) {
    const limit = Math.min((opts && opts.limit) || 15, 40);
    const delayMs = Math.max((opts && opts.delayMs) || 1500, 0);
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
        j.applyUrl = r.url;
        j.applyHost = hostOf(r.url);
        j.applyVia = r.via;
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
      note: blocked ? 'The site answered with a security check. Stop here and ask the user to open one job by hand (do not try to get around it).' : undefined,
      jobs,
    };
  }

  JC.applyLinks = { findIn, resolve, ATS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
