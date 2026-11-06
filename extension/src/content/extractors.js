/*
 * Job Copilot: per-portal job extractors.
 *
 * Each extractor implements (all optional, generic fallbacks fill the gaps):
 *   pageType()        -> 'listings' | 'job' | 'application' | 'unknown'
 *   listings()        -> [job]   jobs visible in a search/results page
 *   job()             -> job     the job currently open (detail page or side panel)
 *
 * Job shape: { title, company, location, url, jobId, postedAt, salary,
 *              employmentType, remote, easyApply, source }
 *
 * Portal markup changes often. Every selector list is ordered newest-first with
 * older fallbacks, and JSON-LD / generic link scanning back everything up.
 * To add a portal: add it to JC.PORTALS (shared/config.js), add an extractor
 * here, and add a playbook in skills/job-search/portals/.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});
  const { pick, pickAttr, absUrl, blockText, uniqBy, text, clean, findButton } = JC.dom;

  const MAX_DESC = 15000;
  const MAX_JOBS = 100;

  const job = (o) =>
    Object.assign(
      { title: '', company: '', location: '', url: '', jobId: '', postedAt: '', salary: '', employmentType: '', remote: false, easyApply: false },
      o,
      { title: clean(o.title), company: clean(o.company), location: clean(o.location) }
    );

  function cardsToJobs(cards, fn) {
    const out = [];
    for (const c of cards) {
      try {
        const j = fn(c);
        if (j && j.title) out.push(job(j));
      } catch (_) {
        /* skip malformed card */
      }
      if (out.length >= MAX_JOBS) break;
    }
    return uniqBy(out, (j) => j.url || j.jobId || j.title + j.company);
  }

  const qsa = (sel, scope) => {
    try {
      return [...(scope || document).querySelectorAll(sel)];
    } catch (_) {
      return [];
    }
  };

  // ---------------------------------------------------------------- LinkedIn
  const linkedin = {
    pageType() {
      const p = location.pathname;
      if (/\/jobs\/view\/\d+/.test(p)) return 'job';
      if (/\/jobs\/(search|collections)|\/jobs\/?$/.test(p)) return 'listings';
      return 'unknown';
    },
    listings() {
      const cards = qsa('li[data-occludable-job-id], div.job-card-container, li.jobs-search-results__list-item, ul.jobs-search__results-list > li, div.base-card, [data-job-id]');
      return cardsToJobs(cards, (c) => {
        const id =
          c.getAttribute('data-occludable-job-id') ||
          c.getAttribute('data-job-id') ||
          pickAttr(c, ['[data-job-id]'], 'data-job-id') ||
          ((pickAttr(c, ['a[href*="/jobs/view/"]'], 'href').match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/) || [])[1]) ||
          ((c.getAttribute('data-entity-urn') || '').match(/(\d+)$/) || [])[1] ||
          '';
        const title = pick(c, ['.job-card-list__title--link strong', '.job-card-list__title', 'a.job-card-container__link span[aria-hidden="true"]', '.job-card-container__link', '.base-search-card__title', 'a[href*="/jobs/view/"]']);
        return {
          jobId: id,
          title,
          company: pick(c, ['.artdeco-entity-lockup__subtitle', '.job-card-container__primary-description', '.job-card-container__company-name', '.base-search-card__subtitle', 'h4']),
          location: pick(c, ['.job-card-container__metadata-wrapper li', '.job-card-container__metadata-item', '.artdeco-entity-lockup__caption', '.job-search-card__location']),
          salary: pick(c, ['.job-card-container__metadata-wrapper li:nth-child(2)', '.job-search-card__salary-info']),
          postedAt: pickAttr(c, ['time'], 'datetime') || pick(c, ['time']),
          easyApply: /easy apply/i.test(text(c)),
          url: id ? `https://www.linkedin.com/jobs/view/${id}/` : absUrl(pickAttr(c, ['a[href*="/jobs/view/"]'], 'href')),
        };
      });
    },
    job() {
      const id = (location.href.match(/currentJobId=(\d+)/) || location.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/) || [])[1] || '';
      const title = pick(document, ['.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', '.t-24.job-details-jobs-unified-top-card__job-title', 'h1.top-card-layout__title', '.jobs-details h1', 'main h1']);
      if (!title) return null;
      const descEl = document.querySelector('#job-details, .jobs-description__content, .jobs-box__html-content, .show-more-less-html__markup, .description__text');
      return job({
        jobId: id,
        title,
        company: pick(document, ['.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name', '.topcard__org-name-link', '.top-card-layout__second-subline a']),
        location: pick(document, ['.job-details-jobs-unified-top-card__primary-description-container .tvm__text', '.job-details-jobs-unified-top-card__bullet', '.jobs-unified-top-card__bullet', '.topcard__flavor--bullet']),
        easyApply: !!findButton(/^easy apply/i),
        url: id ? `https://www.linkedin.com/jobs/view/${id}/` : location.href,
        description: blockText(descEl, MAX_DESC),
      });
    },
  };

  // ------------------------------------------------------------------ Indeed
  const indeed = {
    pageType() {
      if (/\/viewjob|\/rc\/clk|vjk=/.test(location.href) && document.querySelector('#jobDescriptionText')) return 'job';
      if (/\/jobs|\/q-|\/m\/jobs/.test(location.pathname)) return 'listings';
      if (/smartapply\.indeed\.com|\/apply/.test(location.href)) return 'application';
      return document.querySelector('#jobDescriptionText') ? 'job' : 'unknown';
    },
    listings() {
      const cards = qsa('div.job_seen_beacon, li div.cardOutline, td.resultContent, a.tapItem');
      return cardsToJobs(cards, (c) => {
        const holder = c.closest('[data-jk]') || c.querySelector('[data-jk]') || c;
        const jk = holder.getAttribute('data-jk') || (pickAttr(c, ['a[href*="jk="]'], 'href').match(/jk=([a-z0-9]+)/i) || [])[1] || '';
        return {
          jobId: jk,
          title: pickAttr(c, ['h2.jobTitle span[title]'], 'title') || pick(c, ['h2.jobTitle a span', 'h2.jobTitle', '.jobTitle']),
          company: pick(c, ['[data-testid="company-name"]', '.companyName', '.company_location [data-testid="company-name"]']),
          location: pick(c, ['[data-testid="text-location"]', '.companyLocation']),
          salary: pick(c, ['.salary-snippet-container', '[data-testid="attribute_snippet_testid"].salary-snippet-container', '.metadata.salary-snippet-container', '.estimated-salary']),
          postedAt: pick(c, ['[data-testid="myJobsStateDate"]', '.date']),
          easyApply: /easily apply|indeed apply/i.test(text(c)),
          url: jk ? `${location.origin}/viewjob?jk=${jk}` : absUrl(pickAttr(c, ['h2 a', 'a'], 'href')),
        };
      });
    },
    job() {
      const descEl = document.querySelector('#jobDescriptionText');
      const title = pick(document, ['[data-testid="jobsearch-JobInfoHeader-title"]', 'h1.jobsearch-JobInfoHeader-title', '.jobsearch-JobInfoHeader-title-container h1', 'h2.jobsearch-JobInfoHeader-title']);
      if (!title && !descEl) return null;
      const jk = (location.href.match(/(?:jk|vjk)=([a-z0-9]+)/i) || [])[1] || '';
      return job({
        jobId: jk,
        title: title.replace(/\s*-\s*job post$/i, ''),
        company: pick(document, ['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]', '.jobsearch-InlineCompanyRating div']),
        location: pick(document, ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]', '.jobsearch-JobInfoHeader-subtitle > div:last-child']),
        salary: pick(document, ['#salaryInfoAndJobType', '[data-testid="jobsearch-OtherJobDetailsContainer"]']),
        easyApply: !!document.querySelector('#indeedApplyButton, .indeed-apply-button'),
        url: jk ? `${location.origin}/viewjob?jk=${jk}` : location.href,
        description: blockText(descEl, MAX_DESC),
      });
    },
  };

  // --------------------------------------------------------------- Glassdoor
  const glassdoor = {
    pageType() {
      if (/\/job-listing\//.test(location.pathname)) return 'job';
      if (/\/Job\/|\/Jobs\//.test(location.pathname)) return 'listings';
      return 'unknown';
    },
    listings() {
      return cardsToJobs(qsa('[data-test="jobListing"], li[data-jobid]'), (c) => {
        const id = c.getAttribute('data-jobid') || pickAttr(c, ['[data-jobid]'], 'data-jobid');
        return {
          jobId: id,
          title: pick(c, ['[data-test="job-title"]', 'a[data-test="job-link"]']),
          company: pick(c, ['[class*="EmployerProfile_compactEmployerName"]', '[data-test="emp-name"]', '.employer-name']),
          location: pick(c, ['[data-test="emp-location"]', '.location']),
          salary: pick(c, ['[data-test="detailSalary"]']),
          easyApply: /easy apply/i.test(text(c)),
          url: absUrl(pickAttr(c, ['a[data-test="job-title"]', 'a[data-test="job-link"]', 'a'], 'href')),
        };
      });
    },
    job() {
      const descEl = document.querySelector('[class*="JobDetails_jobDescription"], .jobDescriptionContent, #JobDescriptionContainer');
      const title = pick(document, ['[data-test="job-title"]', '[id^="jd-job-title"]', 'h1']);
      if (!title) return null;
      return job({
        title,
        company: pick(document, ['[data-test="employer-name"]', '[class*="EmployerProfile_employerName"]']),
        location: pick(document, ['[data-test="location"]']),
        salary: pick(document, ['[data-test="detailSalary"]']),
        url: location.href,
        description: blockText(descEl, MAX_DESC),
      });
    },
  };

  // --------------------------------------------------------------- Wellfound
  const wellfound = {
    pageType() {
      if (/\/jobs\/\d+/.test(location.pathname)) return 'job';
      if (/\/jobs|\/role\/|\/location\//.test(location.pathname)) return 'listings';
      return 'unknown';
    },
    listings() {
      const links = qsa('a[href*="/jobs/"]').filter((a) => /\/jobs\/\d+/.test(a.getAttribute('href')));
      return cardsToJobs(links, (a) => {
        const card = a.closest('[class*="styles_component"], [data-test="StartupResult"], div[class*="mb-6"]') || a.parentElement;
        return {
          jobId: (a.getAttribute('href').match(/\/jobs\/(\d+)/) || [])[1],
          title: text(a),
          company: pick(card, ['h2', '[class*="startupName"]', 'a[href*="/company/"] h2']),
          location: pick(a.parentElement || card, ['[class*="location"]', 'span']),
          salary: pick(a.parentElement || card, ['[class*="compensation"]']),
          url: absUrl(a.getAttribute('href')),
        };
      });
    },
  };

  // -------------------------------------------------------------- Greenhouse
  const greenhouse = {
    pageType() {
      const hasForm = document.querySelector('#application-form, #application_form, form#application, form[action*="applications"]');
      if (/\/jobs\/\d+/.test(location.pathname) || /gh_jid=|token=/.test(location.search)) return hasForm && !document.querySelector('.job__description, #content .content-intro, .job-post') ? 'application' : 'job';
      if (hasForm) return 'application';
      return 'listings';
    },
    listings() {
      const rows = qsa('tr.job-post, div.opening, section.level-0 .opening, [data-mapped="true"] .opening, .job-posts tr');
      const fromRows = cardsToJobs(rows, (r) => {
        const a = r.querySelector('a[href]');
        return {
          title: pick(r, ['p.body--medium', 'a']) || text(a),
          location: pick(r, ['p.body__secondary', '.location', 'span.location']),
          url: absUrl(a && a.getAttribute('href')),
          jobId: ((a && a.getAttribute('href')) || '').match(/jobs\/(\d+)/)?.[1] || '',
          company: greenhouse.company(),
        };
      });
      if (fromRows.length) return fromRows;
      return cardsToJobs(qsa('a[href*="/jobs/"]').filter((a) => /\/jobs\/\d+/.test(a.href)), (a) => ({
        title: text(a.querySelector('p') || a),
        url: a.href,
        jobId: a.href.match(/jobs\/(\d+)/)[1],
        company: greenhouse.company(),
      }));
    },
    company() {
      return pick(document, ['.company-name', 'header .logo img[alt]']) || pickAttr(document, ['.logo img', 'header img'], 'alt').replace(/\s*logo$/i, '') || (location.pathname.split('/')[1] || '').replace(/-/g, ' ');
    },
    job() {
      const title = pick(document, ['.job__title h1', 'h1.app-title', '.app-title', 'h1.section-header', 'h1']);
      if (!title) return null;
      const descEl = document.querySelector('.job__description, #content, .job-post-container .content, #job-description');
      return job({
        title,
        company: pick(document, ['.company-name', '.job__header .company']) || greenhouse.company(),
        location: pick(document, ['.job__location', '.location', 'div.location']),
        url: location.href,
        jobId: (location.pathname.match(/jobs\/(\d+)/) || location.search.match(/gh_jid=(\d+)/) || [])[1] || '',
        description: blockText(descEl, MAX_DESC),
      });
    },
  };

  // ------------------------------------------------------------------- Lever
  const lever = {
    pageType() {
      if (/\/apply\/?$/.test(location.pathname)) return 'application';
      if (/^\/[^/]+\/[0-9a-f-]{36}/.test(location.pathname)) return 'job';
      return 'listings';
    },
    listings() {
      return cardsToJobs(qsa('.posting'), (p) => {
        const a = p.querySelector('a.posting-title, a[href*="lever.co"]');
        return {
          title: pick(p, ['[data-qa="posting-name"]', 'h5', '.posting-title']),
          location: pick(p, ['.sort-by-location', '.location', '.posting-categories .location']),
          employmentType: pick(p, ['.sort-by-commitment', '.commitment']),
          remote: /remote/i.test(pick(p, ['.workplaceTypes', '.sort-by-location'])),
          url: absUrl(a && a.getAttribute('href')),
          jobId: p.getAttribute('data-qa-posting-id') || ((a && a.getAttribute('href')) || '').split('/').pop(),
          company: lever.company(),
        };
      });
    },
    company() {
      return pickAttr(document, ['.main-header-logo img'], 'alt') || (location.pathname.split('/')[1] || '').replace(/-/g, ' ');
    },
    job() {
      const title = pick(document, ['.posting-headline h2', '.posting-header h2', 'h2']);
      if (!title) return null;
      return job({
        title,
        company: lever.company(),
        location: pick(document, ['.posting-categories .location', '.posting-category.location', '.sort-by-location']),
        employmentType: pick(document, ['.posting-categories .commitment']),
        url: location.href.replace(/\/apply\/?$/, ''),
        jobId: (location.pathname.match(/([0-9a-f-]{36})/) || [])[1] || '',
        description: blockText(document.querySelector('[data-qa="job-description"], .section-wrapper.page-full-width, .content'), MAX_DESC),
      });
    },
  };

  // ------------------------------------------------------------------- Ashby
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const ashby = {
    pageType() {
      if (/\/application\/?$/.test(location.pathname)) return 'application';
      if (UUID.test(location.pathname)) return 'job';
      return 'listings';
    },
    listings() {
      const org = location.pathname.split('/')[1];
      const links = qsa(`a[href*="/${org}/"]`).filter((a) => UUID.test(a.getAttribute('href')));
      return cardsToJobs(links, (a) => {
        const lines = (a.innerText || '').split('\n').map(clean).filter(Boolean);
        return {
          title: pick(a, ['h3', 'h2']) || lines[0],
          location: lines.slice(1).join(' • '),
          url: a.href,
          jobId: (a.getAttribute('href').match(UUID) || [])[0],
          company: (org || '').replace(/-/g, ' '),
          remote: /remote/i.test(a.innerText),
        };
      });
    },
    job() {
      const title = pick(document, ['h1[class*="title"]', 'h1']);
      if (!title) return null;
      return job({
        title,
        company: (location.pathname.split('/')[1] || '').replace(/-/g, ' '),
        location: pick(document, ['[class*="section"] [class*="location"]']),
        url: location.href.replace(/\/application\/?$/, ''),
        jobId: (location.pathname.match(UUID) || [])[0] || '',
        description: blockText(document.querySelector('[class*="descriptionText"], [class*="_description"], main'), MAX_DESC),
      });
    },
  };

  // ----------------------------------------------------------------- Workday
  const workday = {
    pageType() {
      if (/\/apply(\/|$)|\/autofillWithResume|\/applyManually/.test(location.pathname) || document.querySelector('[data-automation-id="applyFlowPage"], [data-automation-id="progressBar"]')) return 'application';
      if (/\/job\//.test(location.pathname) || document.querySelector('[data-automation-id="jobPostingDescription"]')) return 'job';
      return 'listings';
    },
    listings() {
      return cardsToJobs(qsa('section[data-automation-id="jobResults"] li, li.css-1q2dra3, [data-automation-id="jobResults"] li'), (li) => {
        const a = li.querySelector('a[data-automation-id="jobTitle"], a[href*="/job/"]');
        return {
          title: text(a),
          location: pick(li, ['[data-automation-id="locations"] dd', '[data-automation-id="locations"]']),
          postedAt: pick(li, ['[data-automation-id="postedOn"] dd', '[data-automation-id="postedOn"]']),
          jobId: pick(li, ['[data-automation-id="subtitle"] li', 'ul[data-automation-id="subtitle"]']),
          url: absUrl(a && a.getAttribute('href')),
          company: workday.company(),
        };
      });
    },
    company() {
      return pickAttr(document, ['[data-automation-id="logoImage"], img[alt*="logo" i]'], 'alt').replace(/\s*logo$/i, '') || location.hostname.split('.')[0];
    },
    job() {
      const title = pick(document, ['[data-automation-id="jobPostingHeader"]', 'h2[data-automation-id="jobPostingHeader"]', 'h1']);
      if (!title) return null;
      return job({
        title,
        company: workday.company(),
        location: pick(document, ['[data-automation-id="locations"] dd', '[data-automation-id="locations"]']),
        postedAt: pick(document, ['[data-automation-id="postedOn"] dd']),
        employmentType: pick(document, ['[data-automation-id="time"] dd']),
        jobId: pick(document, ['[data-automation-id="requisitionId"] dd']),
        url: location.href.replace(/\/apply.*$/, ''),
        description: blockText(document.querySelector('[data-automation-id="jobPostingDescription"]'), MAX_DESC),
      });
    },
  };

  // ----------------------------------------------------------------- Generic
  const JOB_HREF = /\/(jobs?|careers?|positions?|openings?|vacanc(y|ies)|opportunit(y|ies)|requisitions?|postings?)\/[^?#]*[\w-]{3,}/i;
  const NOT_JOB = /^(jobs?|careers?|all jobs|view all|see all|search|apply|sign in|log in|home|about|benefits|teams?|locations?|students?|internships?|life at|our culture|faq|back|next|previous|more|\d+)$/i;

  const generic = {
    pageType() {
      if (JC.jsonld.jobPostings(document).length === 1) return 'job';
      if (generic.listings().length >= 3) return 'listings';
      return 'unknown';
    },
    listings() {
      const ld = JC.jsonld.jobPostings(document);
      if (ld.length > 1) return ld.slice(0, MAX_JOBS).map((j) => job(Object.assign(j, { description: undefined })));
      const links = qsa('a[href]').filter((a) => {
        const t = clean(a.innerText);
        return JOB_HREF.test(a.href) && t.length >= 4 && t.length <= 140 && !NOT_JOB.test(t) && a.href !== location.href;
      });
      return cardsToJobs(links, (a) => {
        const lines = (a.innerText || '').split('\n').map(clean).filter(Boolean);
        return { title: lines[0], location: lines.slice(1, 3).join(' • '), url: a.href };
      });
    },
    job() {
      const ld = JC.jsonld.jobPostings(document, MAX_DESC);
      if (ld.length === 1) return job(Object.assign(ld[0], { url: ld[0].url || location.href }));
      const title = pick(document, ['h1']);
      if (!title) return null;
      const main = document.querySelector('[class*="description" i], [id*="description" i], article, main') || document.body;
      return job({ title, url: location.href, company: (document.querySelector('meta[property="og:site_name"]') || {}).content || '', description: blockText(main, MAX_DESC) });
    },
  };

  JC.extractors = { linkedin, indeed, glassdoor, wellfound, greenhouse, lever, ashby, workday, generic };

  /** Merge a portal-specific job with JSON-LD (portal values win, JSON-LD fills blanks). */
  function enrich(j) {
    const ld = JC.jsonld.jobPostings(document, MAX_DESC);
    if (!ld.length) return j;
    const base = ld[0];
    if (!j) return job(Object.assign(base, { url: base.url || location.href }));
    // Structured data from the employer is the most reliable source for these.
    for (const k of ['company', 'salary', 'postedAt', 'employmentType', 'validThrough']) if (base[k]) j[k] = base[k];
    for (const k of Object.keys(base)) if (!j[k] && base[k]) j[k] = base[k];
    return j;
  }

  function applyLink() {
    const btn = findButton(/^(apply|apply now|apply for this job|apply on company (site|website)|easy apply|i'?m interested|submit application)\b/i);
    if (!btn) return null;
    return { text: clean(btn.innerText || btn.value), href: btn.href ? absUrl(btn.getAttribute('href')) : '' };
  }

  JC.extract = {
    portal() {
      return JC.portalForHost(location.hostname);
    },
    extractor() {
      const p = this.portal();
      return (p && JC.extractors[p.id]) || generic;
    },
    pageType() {
      const ex = this.extractor();
      try {
        return (ex.pageType || generic.pageType)();
      } catch (_) {
        return 'unknown';
      }
    },
    listings() {
      const ex = this.extractor();
      let jobs = [];
      try {
        jobs = ex.listings ? ex.listings() : [];
      } catch (_) {
        jobs = [];
      }
      if (!jobs.length && ex !== generic) jobs = generic.listings();
      const src = (this.portal() || { id: 'generic' }).id;
      return jobs.map((j) => Object.assign(j, { source: src }));
    },
    job() {
      const ex = this.extractor();
      let j = null;
      try {
        j = ex.job ? ex.job() : null;
      } catch (_) {
        j = null;
      }
      j = enrich(j) || (ex !== generic ? generic.job() : null);
      if (j) {
        j.source = (this.portal() || { id: 'generic' }).id;
        j.apply = applyLink();
        if (!j.description) j.description = '';
      }
      return j;
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
