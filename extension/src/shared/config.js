/*
 * Job Copilot: shared configuration.
 * Loaded by content scripts, the popup, the options page and the service worker.
 * Everything hangs off one global namespace so the files work as plain scripts
 * (no bundler) and can also be loaded into Node's `vm` for unit tests.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});

  JC.VERSION = '0.29.0';
  JC.BRIDGE_CHANNEL = 'job-copilot';

  /**
   * Portals that have a dedicated extractor. `hosts` are matched as a suffix of
   * the hostname, so `greenhouse.io` matches `job-boards.greenhouse.io`.
   */
  JC.PORTALS = [
    { id: 'linkedin', name: 'LinkedIn', hosts: ['linkedin.com'] },
    { id: 'indeed', name: 'Indeed', hosts: ['indeed.com', 'indeed.co.uk', 'indeed.ca', 'indeed.co.in'] },
    { id: 'glassdoor', name: 'Glassdoor', hosts: ['glassdoor.com', 'glassdoor.co.uk', 'glassdoor.co.in', 'glassdoor.ca'] },
    { id: 'wellfound', name: 'Wellfound', hosts: ['wellfound.com'] },
    { id: 'greenhouse', name: 'Greenhouse', hosts: ['greenhouse.io'] },
    { id: 'lever', name: 'Lever', hosts: ['lever.co'] },
    { id: 'ashby', name: 'Ashby', hosts: ['ashbyhq.com'] },
    { id: 'workday', name: 'Workday', hosts: ['myworkdayjobs.com', 'myworkdaysite.com', 'workday.com'] },
    { id: 'smartrecruiters', name: 'SmartRecruiters', hosts: ['smartrecruiters.com'] },
    { id: 'icims', name: 'iCIMS', hosts: ['icims.com'] },
    { id: 'jobvite', name: 'Jobvite', hosts: ['jobvite.com'] },
    { id: 'workable', name: 'Workable', hosts: ['workable.com'] },
    { id: 'bamboohr', name: 'BambooHR', hosts: ['bamboohr.com'] },
    // Aggregators: they list jobs but send you to the employer's ATS to apply.
    { id: 'jobright', name: 'Jobright', hosts: ['jobright.ai'], aggregator: true },
    { id: 'simplify', name: 'Simplify', hosts: ['simplify.jobs'], aggregator: true },
    { id: 'ziprecruiter', name: 'ZipRecruiter', hosts: ['ziprecruiter.com'], aggregator: true },
    { id: 'dice', name: 'Dice', hosts: ['dice.com'], aggregator: true },
    { id: 'builtin', name: 'Built In', hosts: ['builtin.com'], aggregator: true },
  ];

  /**
   * Domains where the Claude bridge may run *write* commands (autofill with
   * profile data, attaching files). Read-only commands work on any site.
   * Users can add more in the options page ("Trusted sites").
   */
  JC.DEFAULT_TRUSTED_DOMAINS = [
    'linkedin.com', 'indeed.com', 'glassdoor.com', 'wellfound.com',
    'greenhouse.io', 'lever.co', 'ashbyhq.com', 'myworkdayjobs.com', 'myworkdaysite.com',
    'smartrecruiters.com', 'icims.com', 'jobvite.com', 'workable.com', 'bamboohr.com',
    'recruitee.com', 'breezy.hr', 'teamtailor.com', 'personio.de', 'personio.com',
    'successfactors.com', 'successfactors.eu', 'taleo.net', 'oraclecloud.com', 'dover.com',
    'rippling-ats.com', 'ats.rippling.com', 'jazzhr.com', 'applytojob.com', 'paylocity.com',
  ];

  JC.DEFAULT_SETTINGS = {
    bridgeEnabled: true, // expose window.jobCopilot so Claude in Chrome can call it
    bridgeAutofill: true, // allow autofill/attach via the bridge on trusted domains
    trustedDomains: [], // user additions on top of DEFAULT_TRUSTED_DOMAINS
    showBadge: true,
    rememberAnswers: true, // learn answers to new questions when you submit, reuse them next time
    realClicks: false, // job boards: click like a real mouse (needs Chrome's debugger permission; shows a bar)
    answerAppliedPrompt: true, // after a confirmed submission, answer the job board's "Did you apply?" with Yes
    autoContinue: true, // you click Apply on a job board: take its "Apply Without Customizing" and open the employer form
    autoFillOpened: true, // autofill the employer form when it opens from a job board (never submits)
    learnFromOtherAutofill: true, // learn field labels from what other autofills fill in (label -> profile field only)
    openSidePanel: true, // the toolbar icon opens Job Copilot in Chrome's side panel (stays open; shows each answer live)
    autoNext: true, // application tabs: after a page is filled and nothing required is left, click Next / Save and Continue (never Submit)
    aiCheck: true, // after autofill, Chrome's on-device AI (Gemini Nano) checks which profile field fits each filled field
    profileWins: true, // profile is the source of truth: upload resume first, let the site parse, then correct it
  };

  JC.hostMatches = function hostMatches(hostname, domain) {
    hostname = String(hostname || '').toLowerCase();
    domain = String(domain || '').toLowerCase().replace(/^\*\./, '').trim();
    if (!domain) return false;
    return hostname === domain || hostname.endsWith('.' + domain);
  };

  /** Follow redirect params (?url=https%3A...) to the real destination, up to twice. */
  JC.unwrapUrl = function unwrapUrl(u) {
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

  /**
   * Make an application address suitable for opening in its own tab. Job boards often hand out
   * the embedded variant (iCIMS "?in_iframe=1"), which expects a parent page to size it, so the
   * form's buttons can end up out of view when opened directly.
   */
  JC.cleanApplyUrl = function cleanApplyUrl(u) {
    try {
      const url = new URL(JC.unwrapUrl(u));
      if (/(^|\.)icims\.com$/i.test(url.hostname)) {
        url.searchParams.delete('in_iframe');
        url.searchParams.delete('iframe');
      }
      return url.href;
    } catch (_) {
      return u;
    }
  };

  JC.portalForHost = function portalForHost(hostname) {
    return JC.PORTALS.find((p) => p.hosts.some((h) => JC.hostMatches(hostname, h))) || null;
  };

  JC.isTrustedHost = function isTrustedHost(hostname, userDomains) {
    const all = JC.DEFAULT_TRUSTED_DOMAINS.concat(userDomains || []);
    return all.some((d) => JC.hostMatches(hostname, d));
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = JC;
})(typeof globalThis !== 'undefined' ? globalThis : self);
