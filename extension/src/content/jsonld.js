/*
 * Job Copilot: schema.org JobPosting reader.
 * Many career sites (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, most
 * company sites via Google for Jobs) embed JSON-LD. This is the most stable
 * signal we have, so every extractor tries it first or as a fallback.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});

  function flatten(node, out) {
    if (!node) return out;
    if (Array.isArray(node)) {
      node.forEach((n) => flatten(n, out));
      return out;
    }
    if (typeof node !== 'object') return out;
    out.push(node);
    if (node['@graph']) flatten(node['@graph'], out);
    if (node.itemListElement) flatten(node.itemListElement, out);
    if (node.item) flatten(node.item, out);
    return out;
  }

  function isType(node, type) {
    const t = node && node['@type'];
    return Array.isArray(t) ? t.includes(type) : t === type;
  }

  function stripHtml(html) {
    if (!html) return '';
    // DOMParser documents are inert: no scripts, handlers or image loads.
    const marked = String(html).replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, '\n$&');
    const d = new DOMParser().parseFromString(marked, 'text/html');
    return (d.body.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  }

  function place(loc) {
    if (!loc) return '';
    const list = Array.isArray(loc) ? loc : [loc];
    return list
      .map((l) => {
        const a = (l && l.address) || l || {};
        if (typeof a === 'string') return a;
        return [a.addressLocality, a.addressRegion, a.addressCountry && (a.addressCountry.name || a.addressCountry)].filter(Boolean).join(', ');
      })
      .filter(Boolean)
      .join(' | ');
  }

  function salary(bs) {
    if (!bs) return '';
    const v = bs.value || {};
    const cur = bs.currency || '';
    if (typeof v !== 'object') return [cur, v].join(' ').trim();
    const range = v.minValue && v.maxValue ? `${v.minValue}–${v.maxValue}` : v.value || v.minValue || v.maxValue || '';
    return [cur, range, v.unitText ? `/${String(v.unitText).toLowerCase()}` : ''].join(' ').replace(/\s+/g, ' ').trim();
  }

  function toJob(n, maxDesc) {
    const org = n.hiringOrganization || {};
    const remote = n.jobLocationType === 'TELECOMMUTE' || /remote/i.test(JSON.stringify(n.applicantLocationRequirements || ''));
    const desc = stripHtml(n.description);
    return {
      title: JC.dom.clean(n.title),
      company: JC.dom.clean(typeof org === 'string' ? org : org.name),
      location: place(n.jobLocation) || (remote ? 'Remote' : ''),
      remote,
      employmentType: [].concat(n.employmentType || []).join(', '),
      postedAt: n.datePosted || '',
      validThrough: n.validThrough || '',
      salary: salary(n.baseSalary || n.estimatedSalary),
      url: n.url || '',
      jobId: (n.identifier && (n.identifier.value || n.identifier)) || '',
      description: maxDesc && desc.length > maxDesc ? desc.slice(0, maxDesc) + '\n…[truncated]' : desc,
    };
  }

  function jobPostings(doc, maxDesc) {
    const nodes = [];
    for (const s of (doc || document).querySelectorAll('script[type="application/ld+json"]')) {
      try {
        flatten(JSON.parse(s.textContent), nodes);
      } catch (_) {
        /* ignore malformed JSON-LD */
      }
    }
    return nodes.filter((n) => isType(n, 'JobPosting')).map((n) => toJob(n, maxDesc));
  }

  JC.jsonld = { jobPostings, stripHtml };
})(typeof globalThis !== 'undefined' ? globalThis : self);
