/*
 * Job Copilot: field classification rules (pure logic, no DOM).
 *
 *   classifyField({ label, name, id, placeholder, autocomplete, automationId, type, tag })
 *     -> { key, confidence } | null
 *   valueForKey(profile, key) -> string
 *   chooseOption(options, desired) -> index | -1
 *   matchSavedAnswer(label, answers) -> answer | null
 *
 * Unit-tested in tests/unit/field-rules.test.mjs.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});

  /** Labels longer than this are treated as free-form questions: only rules flagged `q` apply. */
  const LONG_LABEL = 70;

  // Order matters: more specific rules first.
  const RULES = [
    { key: 'consent', re: /\b(i (hereby )?(agree|acknowledge|consent|certify|confirm|attest|understand)|terms (of|and) (use|service|conditions)|privacy (policy|notice)|gdpr|data processing)\b/, q: true },
    { key: 'resume', re: /\b(resume|résumé|cv|curriculum vitae)\b/, fileOnly: true, q: true },
    { key: 'coverLetter', re: /\bcover ?letter\b/, fileOnly: true, q: true },
    { key: 'email', re: /\be-?mail\b/ },
    { key: 'preferredName', re: /\b(preferred (first )?name|nick ?name|name you go by)\b/ },
    { key: 'pronouns', re: /\bpronouns?\b/, q: true },
    { key: 'firstName', re: /\b(first|given|fore) ?name\b|\bfname\b/ },
    { key: 'lastName', re: /\b(last|family|sur) ?name\b|\blname\b/ },
    { key: 'phoneCountryCode', re: /\b((phone )?country (phone )?code|dial(ing)? code|calling code)\b/ },
    { key: 'skip', re: /\b(phone (device|type)|device type|extension)\b/ },
    { key: 'phone', re: /\b(phone|mobile|cell|telephone|tel)\b/ },
    { key: 'linkedin', re: /\blinked ?in\b/, q: true },
    { key: 'github', re: /\bgit ?hub\b/, q: true },
    { key: 'twitter', re: /\b(twitter|x\.com)\b/ },
    { key: 'portfolio', re: /\b(portfolio|dribbble|behance)\b/ },
    { key: 'website', re: /\b(website|personal (site|url|page)|blog|url)\b/ },
    { key: 'address2', re: /\b(address (line )?2|apt|apartment|suite|unit)\b/ },
    { key: 'address1', re: /\b(street|address (line )?1|mailing address|home address|^address)\b|^address$/ },
    { key: 'postalCode', re: /\b(zip|postal|post ?code|pin ?code)\b/ },
    { key: 'city', re: /\b(city|town)\b/ },
    { key: 'state', re: /\b(state|province|region|county)\b/ },
    { key: 'country', re: /\bcountry\b/ },
    { key: 'location', re: /\b(location|where are you (based|located)|current(ly)? (located|based))\b/ },
    { key: 'requiresSponsorship', re: /\b(sponsor(ship)?|visa|h-?1b|work permit status)\b/, q: true },
    { key: 'authorizedToWork', re: /\b((legally )?(authori[sz]ed|eligible|permitted) to work|work authori[sz]ation|right to work|lawfully)\b/, q: true },
    { key: 'over18', re: /\b((18|eighteen) (years|yrs)|at least 18|over 18|legal (working )?age)\b/, q: true },
    { key: 'willingToRelocate', re: /\brelocat/, q: true },
    { key: 'securityClearance', re: /\bclearance\b/, q: true },
    { key: 'yearsExperience', re: /\b(years? of (relevant |professional |total |work )?experience|how many years)\b/, q: true },
    // Current/previous pay is never filled from desired pay (and some places ban asking).
    { key: 'currentPay', re: /\b((current|present|previous|last|existing|most recent) (base |annual |hourly )?(salary|compensation|ctc|pay|rate|wage)|salary history)\b/, q: true },
    // Any pay question. classifyField() then decides the period (see payPeriod) and maps it to
    // desiredSalary (annual), desiredHourlyRate, or desiredPay (period unclear / monthly / daily).
    { key: 'pay', re: /\b(salary|salaries|compensation|remuneration|wages?|ctc|lpa|(desired|expected|target|minimum) pay|pay (expectations?|range|rate)|(hourly|day|daily|bill|billing) rate|rate per (hour|day))\b/, q: true },
    { key: 'noticePeriod', re: /\bnotice period\b/, q: true },
    { key: 'earliestStartDate', re: /\b(start date|when can you start|available to start|earliest (start|availability)|date available)\b/, q: true },
    { key: 'howDidYouHear', re: /\b(how did you (hear|find|learn)|where did you (hear|find|learn)|(referral|application|candidate) source|source of (application|referral)|how you heard)\b/, q: true },
    { key: 'sexualOrientation', re: /\b(sexual orientation|lgbtq?)\b/, q: true },
    { key: 'hispanicLatino', re: /\b(hispanic|latin[oax]|latine)\b/, q: true },
    { key: 'race', re: /\b(race|racial|ethnicity|ethnic)\b/, q: true },
    { key: 'gender', re: /\b(gender|sex)\b/, q: true },
    { key: 'veteran', re: /\b(veteran|military|armed forces|protected veteran)\b/, q: true },
    { key: 'disability', re: /\bdisabilit/, q: true },
    { key: 'school', re: /\b(school|university|college|institution)\b/ },
    { key: 'degree', re: /\bdegree\b/ },
    { key: 'fieldOfStudy', re: /\b(field of study|major|discipline|area of study|specialization)\b/ },
    { key: 'graduationYear', re: /\b(graduation|grad (year|date)|year of (graduation|completion))\b/ },
    { key: 'gpa', re: /\b(gpa|grade point)\b/ },
    { key: 'currentCompany', re: /\b(current|most recent|present|latest) (company|employer|organi[sz]ation)\b|^(company|employer)( name)?$/ },
    { key: 'currentTitle', re: /\b(current|most recent|present|latest) (job )?(title|role|position|designation)\b|^(job )?title$/ },
    { key: 'citizenship', re: /\bcitizenship\b/ },
    { key: 'remotePreference', re: /\b(work arrangement|remote preference|work (location|setting) preference)\b/ },
    { key: 'fullName', re: /\b(full|legal|your|candidate|applicant) name\b|^name$/ },
  ];

  const AUTOCOMPLETE = {
    'given-name': 'firstName',
    'family-name': 'lastName',
    name: 'fullName',
    nickname: 'preferredName',
    email: 'email',
    tel: 'phone',
    'tel-national': 'phone',
    'tel-country-code': 'phoneCountryCode',
    'street-address': 'address1',
    'address-line1': 'address1',
    'address-line2': 'address2',
    'address-level2': 'city',
    'address-level1': 'state',
    'postal-code': 'postalCode',
    country: 'country',
    'country-name': 'country',
    organization: 'currentCompany',
    'organization-title': 'currentTitle',
    url: 'website',
  };

  // Pay period signals, checked in this order against label + placeholder + attributes + options.
  const PERIODS = [
    ['hourly', /\b(hourly|per hour|an hour|hour rate|rate per hour|bill(ing)? rate|pay rate|wages?)\b|\/\s*h(ou)?r\b|\bp\/?h\b/],
    ['daily', /\b(daily|per day|a day|day rate)\b|\/\s*day\b/],
    ['monthly', /\b(monthly|per month|a month|pcm)\b|\/\s*mo(nth)?\b/],
    ['annual', /\b(annual(ly|ised|ized)?|per (year|annum)|a year|yearly|p\.a\.?|base salary|ctc|lpa|salary|salaries)\b|\/\s*(yr|year)\b/],
  ];

  function payPeriod(text) {
    for (const [period, re] of PERIODS) if (re.test(text)) return period;
    return 'unknown';
  }

  /** Profile key -> [section, field]. Keys not listed here are computed in valueForKey. */
  const KEY_PATH = {};
  for (const s of JC.PROFILE_SECTIONS || []) for (const [f] of s.fields) KEY_PATH[f] = [s.id, f];

  /** "legalNameSection_firstName" -> "legal name section first name" */
  function humanize(s) {
    return String(s || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-.[\]]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[*✱:?()"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function classifyField(f) {
    const type = (f.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'password', 'search'].includes(type)) return null;

    const ac = String(f.autocomplete || '').toLowerCase().split(/\s+/).pop();
    if (ac && AUTOCOMPLETE[ac] && type !== 'file') return { key: AUTOCOMPLETE[ac], confidence: 0.95, via: 'autocomplete' };

    const label = norm(f.label);
    const attrs = [f.name, f.id, f.automationId, f.placeholder, f.ariaLabel].map(humanize).filter(Boolean);
    const payText = [label, norm(f.placeholder), ...attrs, norm(f.optionsText)].join(' | ');
    const isLong = label.length > LONG_LABEL;
    const isFile = type === 'file';

    // Try the visible label first (highest signal), then attribute-derived text.
    const candidates = [];
    if (label) candidates.push({ text: label, weight: 0.9, long: isLong });
    for (const a of attrs) candidates.push({ text: a, weight: 0.7, long: a.length > LONG_LABEL });

    for (const c of candidates) {
      for (const r of RULES) {
        if (c.long && !r.q) continue;
        if (r.fileOnly && !isFile) continue;
        if (isFile && !r.fileOnly) continue;
        if (r.re.test(c.text)) {
          if (r.key === 'skip') return null;
          const via = c.text === label ? 'label' : 'attribute';
          if (r.key === 'pay') {
            const period = payPeriod(payText);
            const key = period === 'annual' ? 'desiredSalary' : period === 'hourly' ? 'desiredHourlyRate' : 'desiredPay';
            return { key, period, confidence: c.weight, via };
          }
          return { key: r.key, confidence: c.weight, via };
        }
      }
    }
    return null;
  }

  function get(profile, key) {
    const path = KEY_PATH[key];
    if (!path || !profile) return '';
    const sec = profile[path[0]] || {};
    const v = sec[path[1]];
    return v === undefined || v === null ? '' : String(v);
  }

  function valueForKey(profile, key) {
    if (!profile) return '';
    const p = profile.personal || {};
    switch (key) {
      case 'fullName':
        return [p.firstName, p.lastName].filter(Boolean).join(' ');
      case 'location':
        return [p.city, p.state, p.country].filter(Boolean).join(', ');
      case 'howDidYouHear':
        return profile.howDidYouHear || '';
      case 'consent':
      case 'resume':
      case 'coverLetter':
      case 'desiredPay': // period unclear, monthly or daily: never guess or convert
      case 'currentPay':
        return '';
      default:
        return get(profile, key);
    }
  }

  const YES = /^(yes|y|true|i am|i do|i have|i will|i can|i identify)\b(?!\s+not)/;
  const NO = /^(no|n|false|i am not|i'm not|i do not|i don't|i will not|i won't|not)\b/;
  const DECLINE_RE = /(decline|prefer not|not to (say|disclose|answer|self)|don'?t wish|do not wish|choose not|not wish|rather not|do not want|don'?t want|not specified|no answer)/;
  const PLACEHOLDER = /^(select|choose|please select|--|—|-|pick)/;

  const COUNTRY_ALIASES = [
    ['united states', 'united states of america', 'usa', 'us', 'u.s.', 'u.s.a.', 'america'],
    ['united kingdom', 'uk', 'great britain', 'britain', 'england'],
    ['india', 'bharat'],
    ['united arab emirates', 'uae'],
    ['south korea', 'korea, republic of', 'republic of korea', 'korea'],
  ];

  function aliases(v) {
    const n = norm(v);
    const group = COUNTRY_ALIASES.find((g) => g.includes(n));
    return group ? group : [n];
  }

  function words(s) {
    return norm(s).replace(/[^a-z0-9+ ]/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w));
  }
  const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'you', 'your', 'are', 'is', 'do', 'for', 'in', 'on', 'at', 'with', 'this', 'that', 'be', 'we', 'our', 'please', 'any', 'have', 'what', 'which', 'if', 'it']);

  function overlap(a, b) {
    const A = new Set(words(a));
    const B = new Set(words(b));
    if (!A.size || !B.size) return 0;
    let n = 0;
    for (const w of A) if (B.has(w)) n++;
    return n / Math.max(A.size, B.size);
  }

  const MULT = { k: 1e3, m: 1e6, lakh: 1e5, lakhs: 1e5, lpa: 1e5, l: 1e5 };

  /** All amounts in a text: "$100k – $150,000" -> [100000, 150000]; "0-2 years" -> [0, 2]. */
  function amounts(text) {
    const t = String(text || '').toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1');
    const out = [];
    const re = /(\d+(?:\.\d+)?)\s*(k|m|lakhs?|lpa|l)?(?![a-z0-9])/g;
    let m;
    while ((m = re.exec(t))) out.push(parseFloat(m[1]) * (m[2] ? MULT[m[2]] : 1));
    return out;
  }

  /** A single amount ("150000", "$150,000", "150k", "75/hr") -> number, else null (ranges, words). */
  function parseAmount(v) {
    const t = norm(v).replace(/^(usd|eur|gbp|inr|cad|aud|[$€£₹])\s*/, '').replace(/\s*(\/\s*[a-z]+|per [a-z]+|(an?|each) [a-z]+)$/, '');
    if (!/^[\d.,]+\s*(k|m|lakhs?|lpa|l)?$/.test(t)) return null;
    const a = amounts(t);
    return a.length === 1 ? a[0] : null;
  }

  /** Value for an <input type="number">: digits only, or null if it is not a single amount. */
  function toNumberValue(v) {
    const n = parseAmount(v);
    return n === null ? null : String(Math.round(n * 100) / 100);
  }

  /** Why a classified field was left empty, in words Claude can act on. */
  function emptyReason(key, period, profile) {
    const w = (profile && profile.work) || {};
    if (key === 'currentPay') return 'asks for current/previous pay: leave blank if optional, otherwise ask the user';
    if (key === 'desiredPay') {
      if (period === 'unknown') return 'pay question does not say hourly or annual: ask the user';
      return `asks for ${period} pay; the profile stores annual/hourly only: ask the user (do not convert)`;
    }
    if (key === 'desiredSalary' && w.desiredHourlyRate) return 'asks for annual salary but the profile only has an hourly rate: ask the user (do not convert)';
    if (key === 'desiredHourlyRate' && w.desiredSalary) return 'asks for an hourly rate but the profile only has an annual salary: ask the user (do not convert)';
    return `profile has no value for ${key}`;
  }

  /** options: [{ text, value }]. Returns the best index or -1. */
  function chooseOption(options, desired) {
    if (desired === undefined || desired === null || String(desired).trim() === '') return -1;
    const opts = options.map((o, i) => ({ i, t: norm(o.text), v: norm(o.value) })).filter((o) => (o.t || o.v) && !PLACEHOLDER.test(o.t));
    if (!opts.length) return -1;
    const d = norm(desired);

    if (DECLINE_RE.test(d)) {
      const m = opts.find((o) => DECLINE_RE.test(o.t));
      return m ? m.i : -1;
    }
    if (/^(yes|y|true)$/.test(d)) {
      const m = opts.find((o) => YES.test(o.t)) || opts.find((o) => /^(yes|true|1)$/.test(o.v));
      return m ? m.i : -1;
    }
    if (/^(no|n|false)$/.test(d)) {
      const m = opts.find((o) => NO.test(o.t)) || opts.find((o) => /^(no|false|0)$/.test(o.v));
      return m ? m.i : -1;
    }

    const targets = aliases(d);
    for (const t of targets) {
      const m = opts.find((o) => o.t === t || o.v === t);
      if (m) return m.i;
    }
    for (const t of targets) {
      const m = opts.find((o) => o.t.startsWith(t + ' ') || o.t.startsWith(t + ',') || t.startsWith(o.t + ' '));
      if (m) return m.i;
    }
    for (const t of targets) {
      const re = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      const m = opts.find((o) => re.test(o.t));
      if (m) return m.i;
    }
    // Numeric ranges, e.g. desired "6" vs "0-2 years" / "6-9 years" / "10+",
    // or "150000" vs "$100k - $150k" / "$150,000+" / "Under $50,000".
    const num = parseAmount(d);
    if (num !== null) {
      for (const o of opts) {
        const a = amounts(o.t);
        if (a.length >= 2 && num >= a[0] && num <= a[1]) return o.i;
        if (a.length === 1) {
          if (/(\+|or more|and (above|up|over)|or above|above|over|more than|at least|minimum)/.test(o.t) && num >= a[0]) return o.i;
          if (/(under|below|less than|up to|or less|maximum)/.test(o.t) && num <= a[0]) return o.i;
        }
      }
    }
    let best = -1;
    let score = 0;
    for (const o of opts) {
      const s = overlap(o.t, d);
      if (s > score) {
        score = s;
        best = o.i;
      }
    }
    return score >= 0.5 ? best : -1;
  }

  function matchSavedAnswer(label, answers) {
    if (!label || !Array.isArray(answers)) return null;
    const l = norm(label);
    let best = null;
    let score = 0;
    for (const a of answers) {
      if (!a || !a.question) continue;
      const q = norm(a.question);
      if (q && (l === q || (q.length > 12 && l.includes(q)))) return a.answer;
      const s = overlap(l, q);
      if (s > score) {
        score = s;
        best = a.answer;
      }
    }
    return score >= 0.6 ? best : null;
  }

  JC.rules = { classifyField, valueForKey, chooseOption, matchSavedAnswer, humanize, norm, payPeriod, amounts, parseAmount, toNumberValue, emptyReason, LONG_LABEL };

  if (typeof module !== 'undefined' && module.exports) module.exports = JC;
})(typeof globalThis !== 'undefined' ? globalThis : self);
