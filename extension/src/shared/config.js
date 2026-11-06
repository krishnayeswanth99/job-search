/*
 * Job Copilot: shared configuration.
 * Loaded by content scripts, the popup, the options page and the service worker.
 * Everything hangs off one global namespace so the files work as plain scripts
 * (no bundler) and can also be loaded into Node's `vm` for unit tests.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});

  JC.VERSION = '0.1.0';
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
  };

  JC.hostMatches = function hostMatches(hostname, domain) {
    hostname = String(hostname || '').toLowerCase();
    domain = String(domain || '').toLowerCase().replace(/^\*\./, '').trim();
    if (!domain) return false;
    return hostname === domain || hostname.endsWith('.' + domain);
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
