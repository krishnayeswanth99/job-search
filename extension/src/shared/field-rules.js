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
    // The date you sign or submit the form on (Workday Self Identify "Date", "Date signed"): today.
    // Must come before consent, which also matches "signature".
    { key: 'todayDate', re: /\b(date (signed|of signature|completed)|signed on|signature date|today'?s date|current date|date signed on)\b/ },
    // Typed sign-offs / e-signatures attest the form is true: the user's call, like consent boxes.
    { key: 'consent', re: /\b(sign[- ]?off|e-?signature|electronic signature|digital signature|signature)\b/, q: true },
    { key: 'consent', re: /\b(i (hereby )?(agree|acknowledge|consent|certify|confirm|attest|understand)|terms (of|and) (use|service|conditions)|privacy (policy|notice)|gdpr|data processing)\b/, q: true },
    { key: 'resume', re: /\b(resume|résumé|cv|curriculum vitae)\b/, fileOnly: true, q: true },
    // "How do you want to give us your resume?" choices (Taleo "Resume Upload Selection", "Select the
    // resume file to upload", "Apply with: LinkedIn / Upload / Manually"): pick uploading a file.
    { key: 'resumeSource', re: /\b((resume|cv) (upload )?(selection|source|options?|method)|resume upload|select the (resume |cv )?file to upload|how (would|do) you (like|want) to (apply|submit|provide|share|add) (your )?(resume|cv|application|profile)|upload (method|source|from)|import (your )?(resume|profile) from)\b/, choiceOnly: true, q: true },
    { key: 'coverLetter', re: /\bcover ?letter\b/, fileOnly: true, q: true },
    // A cover letter typed into a box (not uploaded): the approved draft's letter.
    { key: 'coverLetterText', re: /\b(cover ?letter|letter of (motivation|interest)|motivation(al)? letter)\b/, textOnly: true, q: true },
    { key: 'email', re: /\be-?mail\b/ },
    // "How do you pronounce your name?" is a free-text question, not the name itself.
    { key: 'skip', re: /\bpronounc/, q: true },
    // Name parts that aren't first/last. Workday ids ("legalName--middleName") also contain
    // "legal name", which would otherwise read as the full name.
    { key: 'middleName', re: /\b(middle (name|initial)s?|second name)\b/ },
    { key: 'skip', re: /\b(name )?(prefix|suffix|salutation|honorific)\b|^(mr ?\/ ?ms)$|\blegal name title\b|\blocal (given|family|first|last)? ?name\b|\bname in local script\b/ },
    { key: 'preferredName', re: /\b(preferred (first )?name|nick ?name|name you go by)\b/ },
    { key: 'pronouns', re: /\bpronouns?\b/, q: true },
    { key: 'firstName', re: /\b(first|given|fore) ?name\b|\bfname\b/ },
    { key: 'lastName', re: /\b(last|family|sur) ?name\b|\blname\b/ },
    { key: 'phoneCountryCode', re: /\b((phone )?country (phone )?code|dial(ing)? code|calling code)\b/ },
    // Phone type next to the number (iCIMS "Type", Workday "Phone Device Type"): Mobile.
    { key: 'phoneType', re: /\b(phone (device )?type|device type|phone number type|type of phone)\b|\bphone\b.*\btype\b/ },
    { key: 'skip', re: /\b(extension|ext)\b/ },
    // Former-employee ID questions: only for people who worked there; left empty, never flagged.
    { key: 'formerEmployeeId', re: /\b(previous|former|prior|past) [a-z0-9 ]{0,30}(employee|worker|associate) (id|number|#)\b|\bemployee (id|number) \(if applicable\)/, q: true },
    { key: 'phone', re: /\b(phone|mobile|cell|telephone|tel)\b/ },
    { key: 'linkedin', re: /\blinked ?in\b/, q: true },
    { key: 'github', re: /\bgit ?hub\b/, q: true },
    { key: 'twitter', re: /\b(twitter|x\.com)\b/ },
    { key: 'portfolio', re: /\b(portfolio|dribbble|behance)\b/, q: true },
    { key: 'website', re: /\b(website|personal (site|url|page)|blog|url)\b/ },
    { key: 'address2', re: /\b(address (line )?2|apt|apartment|suite|unit)\b/ },
    { key: 'address1', re: /\b(street|address (line )?1|mailing address|home address|^address)\b|^address$/ },
    { key: 'postalCode', re: /\b(zip|postal|post ?code|pin ?code)\b/ },
    { key: 'city', re: /\b(city|town)\b/ },
    // "Country/Region of Residence" is the country, not a state: country first.
    { key: 'country', re: /\bcountry\b/ },
    { key: 'state', re: /\b(state|province|region|county)\b/ },
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
    { key: 'timeZone', re: /\btime ?zone\b/ },
    { key: 'howDidYouHear', re: /^(source|candidate source|job source|recruiting source|referral source)$/ },
    { key: 'howDidYouHear', re: /\b(how did you (first )?(hear|find|learn|come across|discover)|where did you (hear|find|learn)|(referral|application|candidate) source|source of (application|referral)|how you heard)\b/, q: true },
    { key: 'transgender', re: /\b(transgender|trans experience|gender identity (is|matches|differs)|cisgender)\b/, q: true },
    { key: 'sexualOrientation', re: /\b(sexual orientation|lgbtq?\+?)\b/, q: true },
    { key: 'hispanicLatino', re: /\b(hispanic|latin[oax]|latine)\b/, q: true },
    { key: 'race', re: /\b(races?|racial|ethnicit(y|ies)|ethnic|ethnic origin|ethnic background)\b/, q: true },
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

  /**
   * The browser's time zone as one value with alternatives ("America/New_York | Eastern | GMT-05:00 | …"):
   * chooseOption tries the first; autofill tries each in turn (time-zone lists vary a lot by site).
   */
  function timeZoneGuess() {
    let iana = '';
    try {
      iana = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (_) {
      return '';
    }
    return iana;
  }
  function timeZoneCandidates(iana, offsetMin) {
    if (!iana) return [];
    const out = [iana, iana.split('/').pop().replace(/_/g, ' ')];
    const US = { 'America/New_York': 'Eastern', 'America/Detroit': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona', 'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii' };
    if (US[iana]) out.push(US[iana] + ' Time', US[iana]);
    if (iana === 'Asia/Kolkata' || iana === 'Asia/Calcutta') out.push('India Standard Time', 'IST', 'Chennai', 'Mumbai', 'New Delhi');
    if (iana === 'Europe/London') out.push('London', 'GMT', 'Greenwich Mean Time');
    if (typeof offsetMin === 'number') {
      const sign = offsetMin <= 0 ? '+' : '-';
      const abs = Math.abs(offsetMin);
      const hh = String(Math.floor(abs / 60)).padStart(2, '0');
      const mm = String(abs % 60).padStart(2, '0');
      out.push(`GMT${sign}${hh}:${mm}`, `UTC${sign}${hh}:${mm}`, `GMT${sign}${Number(hh)}`, `UTC${sign}${Number(hh)}`);
    }
    return out;
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

  /** 'Month' | 'Day' | 'Year' when the field is one box of a split date, else null. */
  function datePart(label, attrs) {
    const m = /^(mm|month|dd|day|yyyy|yy|year)$/.exec(label) || attrs.map((a) => /\bdate ?section ?(month|day|year)\b/.exec(a)).find(Boolean);
    if (!m) return null;
    const w = m[1];
    return /^m/.test(w) ? 'Month' : /^d/.test(w) ? 'Day' : 'Year';
  }

  const CHOICE_TYPES = ['radio', 'select', 'select-one', 'listbox', 'checkbox'];
  const UPLOAD_OPT = /\b(upload|attach|browse|(my |from (my )?)(computer|device|desktop|files?)|local (file|drive))\b/;
  const OTHER_SOURCE = /\b(linked ?in|indeed|dropbox|google drive|one ?drive|box\.com|icloud|seek|manual(ly)?|no thanks|skip|later|don'?t|do not|without|paste|type|copy)\b/;

  /** Index of the "upload a file from my computer" option, or -1. */
  function chooseResumeSource(options) {
    const opts = (options || []).map((o, i) => ({ i, t: norm(o.text || o.value || '') }));
    const ok = opts.filter((o) => o.t && !OTHER_SOURCE.test(o.t));
    const m = ok.find((o) => UPLOAD_OPT.test(o.t)) || ok.find((o) => /\b(resume|cv)\b/.test(o.t));
    return m ? m.i : -1;
  }

  // ------------------------------------------------ experience questions answered from the resume
  // "Have you built and supported production software using Python or Java?" -> Yes when the
  // resume or skills name Python or Java. Never answers No: without evidence it's left for you.
  const EXPERIENCE_Q = /\b(have you|do you have|are you (familiar|experienced|proficient|comfortable)|(experience|expertise|proficien\w*) (with|in|using|of)|worked (with|on|in)|hands[- ]on|familiar with|proficient (in|with)|knowledge of|built|developed|used)\b/i;
  const NOT_TECH = new Set('have do does did are is can could will would you your we our us please if yes no i the a an and or of in on with using for to at as by any years year experience production software systems system application applications building built supported support team teams company role this that these those currently previous professional work working environment environments services service tools tool such like etc'.split(' '));

  /** Technologies or skills a question asks about: capitalised terms (Python, AWS, C++) and known skills. */
  function experienceTerms(label, skills) {
    const text = String(label || '');
    const out = new Set();
    const known = String(skills || '')
      .split(/[,;\n|•]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 1 && s.length <= 40);
    for (const s of known) {
      const re = new RegExp('(^|[^a-z0-9+#])' + s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9+#])', 'i');
      if (re.test(text)) out.add(s);
    }
    const toks = text.match(/[A-Za-z][A-Za-z0-9+#.\-]*[A-Za-z0-9+#]|\b[A-Z]\b[+#]*/g) || [];
    toks.forEach((t, i) => {
      if (i === 0 || NOT_TECH.has(t.toLowerCase())) return;
      if (/[A-Z]/.test(t) || /[+#]/.test(t) || /\.js$/i.test(t)) out.add(t.replace(/\.$/, ''));
    });
    return [...out];
  }

  /**
   * 'Yes' when a yes/no experience question names technologies the resume (or skills) shows,
   * else null. "X or Y" needs one of them, "X and Y" needs all.
   */
  function evidenceAnswer(label, resumeText, skills) {
    const q = String(label || '');
    if (!EXPERIENCE_Q.test(q) || q.length > 300) return null;
    // Employment / relationship questions name a company, not a skill.
    if (/\b((worked|been employed|employed) (for|at|by)|relatives?|family|friends?|referr|previously (applied|interviewed)|current(ly)? employ|former employee|this company|our company)\b/i.test(q)) return null;
    const terms = experienceTerms(q, skills);
    if (!terms.length) return null;
    const hay = ' ' + String(resumeText || '') + ' ' + String(skills || '') + ' ';
    const has = (t) => new RegExp('(^|[^A-Za-z0-9+#])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9+#])', 'i').test(hay);
    const needAll = /\band\b/i.test(q) && !/\bor\b/i.test(q) && terms.length > 1;
    const found = terms.filter(has);
    return (needAll ? found.length === terms.length : found.length > 0) ? 'Yes' : null;
  }

  // ------------------------------------------- "Have you ever worked at <Company>?" from the resume
  const LEGAL = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|llp|plc|gmbh|ag|sa|bv|pvt|private|group|holdings|technologies|technology)\b\.?/gi;
  const companyKey = (s) => String(s || '').replace(/&/g, ' and ').replace(LEGAL, ' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /** The company a "have you worked at X" question names, or '' (also '' for "this company" / "us"). */
  function formerEmployerOf(label) {
    const q = String(label || '').replace(/\s+/g, ' ');
    const m =
      q.match(/\b(?:ever|previously|formerly|currently|before|in the past)?\s*(?:worked|been employed|employed|interned|been an? (?:employee|intern|contractor|worker)|been (?:a )?(?:regular|contingent)[^?]{0,40}?)\s+(?:at|for|by)\s+(.+?)(?=\s+(?:as|in any|in a|either|or any|including|\(|,|before|previously|at any)\b|[?(,.]|$)/i) ||
      q.match(/\b(?:current|former|previous|past)\s+(?:employee|intern|contractor|worker)s?\s+(?:of|at)\s+(.+?)(?=\s+(?:as|or|\(|,)\b|[?(,.]|$)/i);
    if (!m) return '';
    const name = m[1].trim().replace(/^the\s+/i, '');
    if (!name || /^(this|our|the) (company|organi[sz]ation|firm|employer)$|^(us|we|here|any of|one of)\b/i.test(name) || name.length > 60) return '';
    return name;
  }

  /**
   * "Have you ever worked at Applied Materials (as an employee, contractor, intern…)?" -> 'Yes' if
   * the resume names that company, 'No' if it doesn't. Needs a real resume (not just a few lines).
   */
  function formerEmployerAnswer(label, resumeText) {
    const name = formerEmployerOf(label);
    const text = String(resumeText || '');
    if (!name || text.length < 400) return null;
    const k = companyKey(name);
    if (!k || k.length < 3) return null;
    return (' ' + companyKey(text) + ' ').includes(' ' + k + ' ') ? 'Yes' : 'No';
  }

  // ------------------------------------------------------------ country phone codes
  // One code, several countries (+1 US/Canada/Caribbean, +7 Russia/Kazakhstan, +44 UK/Jersey…): pick
  // the option with the right code AND the right country; without a country, the main one.
  const MAIN_FOR_CODE = { 1: 'united states', 7: 'russia', 44: 'united kingdom', 61: 'australia', 47: 'norway', 39: 'italy', 358: 'finland', 262: 'reunion', 590: 'guadeloupe', 599: 'curacao', 212: 'morocco', 64: 'new zealand', 34: 'spain', 33: 'france', 41: 'switzerland', 46: 'sweden', 45: 'denmark' };
  const COUNTRY_CODE = { 'united states': 1, usa: 1, us: 1, canada: 1, india: 91, 'united kingdom': 44, uk: 44, australia: 61, germany: 49, france: 33, singapore: 65, 'united arab emirates': 971, ireland: 353, netherlands: 31, china: 86, japan: 81, mexico: 52, brazil: 55 };
  const codeOf = (s) => {
    const m = String(s || '').match(/\+\s?(\d{1,4})\b|\(\s*(\d{1,4})\s*\)/);
    return m ? Number(m[1] || m[2]) : null;
  };

  /** The applicant's dialing code as a number: profile code, else the phone's +NN, else the country's. */
  function dialCode(profile) {
    const p = (profile && profile.personal) || {};
    return codeOf(p.phoneCountryCode && /^\d+$/.test(String(p.phoneCountryCode).trim()) ? '+' + p.phoneCountryCode : p.phoneCountryCode) || codeOf(String(p.phone || '').match(/^\s*\+\s?\d{1,4}/) || '') || COUNTRY_CODE[norm(p.country)] || null;
  }

  function choosePhoneCode(options, code, country) {
    const want = typeof code === 'number' ? code : codeOf(code);
    const opts = (options || []).map((o, i) => ({ i, t: norm(o.text || ''), c: codeOf(o.text) || codeOf(o.value) }));
    const same = want ? opts.filter((o) => o.c === want) : [];
    const names = country ? aliases(norm(country)) : [];
    const byCountry = (list) => list.find((o) => names.some((n) => n.length > 1 && new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(o.t)));
    const hit = byCountry(same) || (same.length === 1 ? same[0] : null) || same.find((o) => MAIN_FOR_CODE[want] && o.t.includes(MAIN_FOR_CODE[want])) || same[0] || (!want && byCountry(opts));
    return hit ? hit.i : -1;
  }

  // ---------------------------------------------- "Do you have 3+ years of X experience?" from history
  const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const ymIdx = (ym, now) => {
    const m = /^(\d{4})-(\d{2})/.exec(ym || '');
    return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
  };

  /** Months covered by intervals [start, end) with overlaps counted once. */
  function mergedMonths(iv) {
    const s = iv.filter((x) => x[0] !== null && x[1] !== null && x[1] > x[0]).sort((a, b) => a[0] - b[0]);
    let total = 0;
    let cur = null;
    for (const [a, b] of s) {
      if (!cur) cur = [a, b];
      else if (a <= cur[1]) cur[1] = Math.max(cur[1], b);
      else {
        total += cur[1] - cur[0];
        cur = [a, b];
      }
    }
    if (cur) total += cur[1] - cur[0];
    return total;
  }

  /** Each job's [start, end) in months, plus its text (title, bullets, details). */
  function jobSpans(profile, now) {
    const d = now && typeof now.getFullYear === 'function' ? now : new Date();
    const nowIdx = d.getFullYear() * 12 + d.getMonth() + 1;
    return ((profile && profile.experience) || []).map((e) => ({
      span: [ymIdx(e.start), e.current || !e.end ? nowIdx : ymIdx(e.end) === null ? null : ymIdx(e.end) + 1],
      text: [e.title, e.description, e.details].join(' ').toLowerCase(),
      title: String(e.title || '').toLowerCase(),
    }));
  }

  /**
   * "Do you have 2+ years of data scientist experience?" -> 'Yes' when the jobs whose title,
   * bullets or details mention it add up to N years; 'No' when all your work history together is
   * under N years; otherwise null (left for the AI or you). Internships count like other jobs.
   */
  // Same thing, different words: "ML" counts as "machine learning".
  const SYNONYMS = [
    ['machine learning', 'ml', 'machine-learning'],
    ['artificial intelligence', 'ai'],
    ['natural language processing', 'nlp'],
    ['deep learning', 'neural network', 'dl'],
    ['computer vision', 'cv', 'image recognition'],
    ['data scientist', 'data science'],
    ['statistical modeling', 'statistical modelling', 'statistics', 'statistical', 'econometrics'],
    ['data analysis', 'data analytics', 'analytics', 'data analyst'],
    ['software engineering', 'software engineer', 'software development', 'software developer'],
  ];

  function yearsAnswer(label, profile, now) {
    const d = yearsDetail(label, profile, now);
    return d ? d.answer : null;
  }

  /** The numbers behind yearsAnswer: { n, terms, years, total, answer } or null if not a years question. */
  function yearsDetail(label, profile, now) {
    const q = String(label || '').toLowerCase();
    const m = q.match(/(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*\+?\s*(?:or more |plus |\(\d+\)\s*)?years?/) || q.match(/(?:at least|minimum of|more than|over)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+years?/);
    if (!m || !/\b(do|have|are|did|would)\b/.test(q)) return null;
    const n = WORD_NUM[m[1]] || Number(m[1]);
    if (!n || n > 40) return null;
    const jobs = jobSpans(profile, now);
    const totalYears = jobs.length ? mergedMonths(jobs.map((j) => j.span)) / 12 : Number((profile && profile.work && profile.work.yearsExperience) || NaN);
    if (!(totalYears >= 0)) return null;
    // What the years are of: "years of <topic> experience" / "years of experience (in|with) <topic>".
    const after = q.slice(q.indexOf(m[0]) + m[0].length);
    let topic = (after.match(/^\s*(?:of\s+)?(?:professional\s+|relevant\s+|hands-on\s+|industry\s+)?(.*?)\s*(?:work\s+)?experience\b/) || [])[1] || '';
    if (!topic || /^(work|professional|relevant|total|industry)?$/.test(topic.trim())) topic = (after.match(/experience\s+(?:in|with|as|using|doing)\s+(?:an?\s+|the\s+)?([^?.,;]+)/) || [])[1] || '';
    const terms = topic
      .split(/\/|,|\bor\b|\band\b|\(|\)/)
      .map((t) => t.replace(/[^a-z0-9+#. -]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' '))
      .filter((t) => t.length >= 2 && !/^(the|a|an|in|of|with|tools?|techniques?|role|roles|position)$/.test(t));
    if (!terms.length) return { n, terms, years: totalYears, total: totalYears, answer: totalYears >= n ? 'Yes' : jobs.length ? 'No' : null };
    const stem = (w) => w.replace(/(ists?|ists|ing|ics|ic|al|s)$/, '');
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alts = (t) => {
      const out = [t];
      for (const g of SYNONYMS) if (g.some((x) => t === x || t.startsWith(x + ' ') || t.includes(x))) out.push(...g);
      return [...new Set(out)];
    };
    const mentions = (text, t) =>
      alts(t).some((a) => {
        if (a.length <= 3) return new RegExp('(^|[^a-z])' + esc(a) + '($|[^a-z])').test(text); // "ml", "ai", "nlp": whole words
        if (text.includes(a)) return true;
        const words = a.split(' ').map(stem).filter((w) => w.length >= 3);
        return words.length > 1 && words.every((w) => text.includes(w));
      });
    const relevant = jobs.filter((j) => terms.some((t) => mentions(j.text, t)));
    const years = mergedMonths(relevant.map((j) => j.span)) / 12;
    return { n, terms, years, total: totalYears, answer: years >= n ? 'Yes' : totalYears < n ? 'No' : null };
  }

  /**
   * Ways a degree is offered in dropdowns: "M.S." -> ["M.S.", "Master of Science", "Master's Degree",
   * "Masters", "Master"…]. The degree as written comes first.
   */
  function degreeCandidates(degree) {
    const d = String(degree || '').trim();
    const n = d.toLowerCase().replace(/[.\s']/g, '');
    const out = [d];
    const add = (...xs) => xs.forEach((x) => out.includes(x) || out.push(x));
    if (/^(phd|dphil|doctor|doctorate|doctoral)/.test(n) || /doctor/.test(n)) add('Doctorate', "Doctorate Degree", 'Doctoral Degree', 'PhD', 'Ph.D.', 'Doctor of Philosophy');
    else if (/^(mba|masterofbusiness)/.test(n)) add('MBA', 'Master of Business Administration', "Master's Degree", 'Masters', 'Master');
    else if (/^(ms|msc|ma|meng|mtech|me|mca|mphil|mfa|mps|master)/.test(n)) {
      if (/^(ms|msc|masterofscience)/.test(n)) add('Master of Science', 'MS', 'M.S.');
      if (/^(ma|masterofarts)/.test(n)) add('Master of Arts', 'MA', 'M.A.');
      if (/^(meng|me|mtech)/.test(n)) add('Master of Engineering', 'Master of Technology', 'M.Tech');
      add("Master's Degree", 'Masters Degree', 'Masters', 'Master', 'Graduate Degree', 'Postgraduate');
    } else if (/^(bs|bsc|ba|beng|btech|be|bca|bba|bcom|bachelor|ab|bfa|bachelors)/.test(n)) {
      if (/^(bs|bsc|bachelorofscience)/.test(n)) add('Bachelor of Science', 'BS', 'B.S.');
      if (/^(ba|ab|bachelorofarts)/.test(n)) add('Bachelor of Arts', 'BA', 'B.A.');
      if (/^(beng|btech|be|bachelorofengineering|bacheloroftechnology)/.test(n)) add('Bachelor of Engineering', 'Bachelor of Technology', 'B.Tech', 'B.E.');
      add("Bachelor's Degree", 'Bachelors Degree', 'Bachelors', 'Bachelor', 'Undergraduate Degree');
    } else if (/^(as|aa|associate)/.test(n)) add("Associate's Degree", 'Associate Degree', 'Associates');
    else if (/(highschool|ged|secondary|diploma)/.test(n)) add('High School Diploma', 'High School', 'GED', 'Diploma');
    return out.filter(Boolean);
  }

  /** "English (native), Hindi (fluent), Telugu" -> [{ language, native, level }] */
  function parseLanguages(text) {
    return String(text || '')
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6)
      .map((s) => {
        const m = s.match(/^(.+?)\s*(?:\(([^)]*)\)|[-–:]\s*(.+))?$/);
        const language = (m ? m[1] : s).trim();
        const lvl = ((m && (m[2] || m[3])) || '').trim().toLowerCase();
        const native = /native|mother|first language/.test(lvl);
        const level = native ? 'native' : /fluent|full|bilingual|professional/.test(lvl) ? 'fluent' : /advanced|proficient/.test(lvl) ? 'advanced' : /intermediate|conversational|working/.test(lvl) ? 'intermediate' : /basic|beginner|elementary|limited/.test(lvl) ? 'beginner' : '';
        return { language, native, level };
      });
  }

  /** How proficiency levels are offered: "5 - Fluent", "Native", "Advanced"… best first. */
  function levelCandidates(level) {
    switch (level) {
      case 'native':
        return ['Native', 'Native or Bilingual', 'Fluent', 'Expert', 'Advanced'];
      case 'fluent':
        return ['Fluent', 'Full Professional', 'Native or Bilingual', 'Expert', 'Advanced'];
      case 'advanced':
        return ['Advanced', 'Professional Working', 'Proficient', 'Fluent'];
      case 'intermediate':
        return ['Intermediate', 'Conversational', 'Limited Working', 'Working'];
      case 'beginner':
        return ['Beginner', 'Elementary', 'Basic', 'Classroom Study'];
      default:
        return [];
    }
  }

  function classifyField(f) {
    const type = (f.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'password', 'search'].includes(type)) return null;
    // A choice whose options include uploading a resume and another way (LinkedIn, manually…).
    const ot = norm(f.optionsText);
    if (CHOICE_TYPES.includes(type) && ot && /\b(upload|attach)\b/.test(ot) && /\b(resume|cv|computer|device|file)\b/.test(ot) && OTHER_SOURCE.test(ot))
      return { key: 'resumeSource', confidence: 0.8, via: 'options' };

    const ac = String(f.autocomplete || '').toLowerCase().split(/\s+/).pop();
    if (ac && AUTOCOMPLETE[ac] && type !== 'file') return { key: AUTOCOMPLETE[ac], confidence: 0.95, via: 'autocomplete' };

    const label = norm(f.label);
    const attrs = [f.name, f.id, f.automationId, f.placeholder, f.ariaLabel].map(humanize).filter(Boolean);

    // One box of a split date (Workday's Month / Day / Year spin boxes). Only today's date (a
    // signature date) and a graduation year are filled; anything else (birth date, start date) is
    // left to the user. The box's id often names the whole section ("selfIdentifiedDisabilityData
    // --dateSignedOn-dateSectionMonth"), which must not make it look like the section's question.
    const part = datePart(label, attrs);
    if (part) {
      const all = [label, ...attrs].join(' | ');
      if (RULES[0].re.test(all)) return { key: 'today' + part, confidence: 0.85, via: 'date part' };
      if (part === 'Year' && /\bgraduat/.test(all)) return { key: 'graduationYear', confidence: 0.7, via: 'date part' };
      return null;
    }
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
        if (r.choiceOnly && !CHOICE_TYPES.includes(type)) continue;
        if (r.textOnly && !['textarea', 'text', ''].includes(type)) continue;
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

  function valueForKey(profile, key, now) {
    if (!profile) return '';
    const p = profile.personal || {};
    const d = now && typeof now.getFullYear === 'function' ? now : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    switch (key) {
      case 'todayDate': // US order; autofill uses YYYY-MM-DD for <input type=date>
        return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
      case 'todayMonth':
        return pad(d.getMonth() + 1);
      case 'todayDay':
        return pad(d.getDate());
      case 'todayYear':
        return String(d.getFullYear());
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
      case 'formerEmployeeId':
        return '';
      case 'phoneType':
        return 'Mobile';
      case 'phoneCountryCode': {
        const c = dialCode(profile);
        return c ? '+' + c : '';
      }
      case 'coverLetterText': // from an approved tailored draft
        return profile.coverLetterText || '';
      case 'resumeSource': // which option: chooseResumeSource()
        return 'Upload';
      case 'timeZone':
        return timeZoneGuess();
      case 'howDidYouHearDetail':
        return profile.howDidYouHear || '';
      default: {
        const v = get(profile, key);
        // Diversity questions left empty in the profile: decline, never guess.
        if (!v && EEO_DEFAULT_DECLINE.has(key)) return JC.DECLINE || 'Decline to self-identify';
        return v;
      }
    }
  }
  const EEO_DEFAULT_DECLINE = new Set(['gender', 'race', 'hispanicLatino', 'veteran', 'disability', 'sexualOrientation', 'transgender']);

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
    if (key === 'coverLetterText') return 'cover letter: click "Tailor resume & cover letter" in the side panel, review the draft, then Approve';
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
      // Our value at the start of an option ("India" -> "India (+91)"), or an option at the start of
      // our value only when it is most of it: "Jersey City" must not pick the country "Jersey".
      const m = opts.find((o) => o.t.startsWith(t + ' ') || o.t.startsWith(t + ',') || (t.startsWith(o.t + ' ') && o.t.length >= t.length * 0.7));
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
    return score > 0.5 ? best : -1; // half the words is not enough: "Jersey City" is not "Jersey"
  }

  /**
   * Saved/remembered answers: [{ question, answer, scope?: 'any'|'company', company?, source?, uses?, updatedAt? }].
   * `ctx.company` is the current employer key (see JC.memory.context); company-scoped answers
   * are only reused for that same employer.
   */
  function matchSavedAnswer(label, answers, ctx) {
    if (!label || !Array.isArray(answers)) return null;
    const l = norm(label);
    const company = norm((ctx && ctx.company) || '');
    let best = null;
    let score = 0;
    for (const a of answers) {
      if (!a || !a.question) continue;
      if (a.scope === 'company' && (!company || norm(a.company) !== company)) continue;
      const q = norm(a.question);
      if (q && words(l).join(' ') === words(q).join(' ')) return a.answer;
      // Remembered answers need a near-identical question: "authorized to work in Singapore" must not
      // answer "authorized to work in the United States". Answers the user typed in are matched loosely.
      if (a.source === 'remembered') continue;
      if (q && (l === q || (q.length > 12 && l.includes(q)))) return a.answer;
      const s = overlap(l, q);
      if (s > score) {
        score = s;
        best = a.answer;
      }
    }
    return score >= 0.6 ? best : null;
  }

  // ------------------------------------------------------------ answer memory
  // Profile keys whose answers must never be remembered from a form (they live in the profile
  // already, are sensitive, or go stale).
  const NEVER_REMEMBER = new Set(['consent', 'resume', 'coverLetter', 'transgender', 'gender', 'race', 'hispanicLatino', 'veteran', 'disability', 'sexualOrientation', 'desiredPay', 'currentPay', 'desiredSalary', 'desiredHourlyRate']);

  /** Values that look like personal identifiers or secrets: never stored. */
  function looksSensitive(v) {
    const s = String(v || '');
    return (
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s) || // email
      /\b\d{3}-\d{2}-\d{4}\b/.test(s) || // SSN
      /\b(?:\d[ -]?){13,19}\b/.test(s) || // card / long account numbers
      (s.replace(/\D/g, '').length >= 7 && s.replace(/[\d\s()+.-]/g, '').length === 0) // phone-like
    );
  }

  /** Should this question/answer only be reused for the same employer? */
  function isCompanySpecific(question, answer, company) {
    const q = norm(question);
    const c = norm(company);
    if (/\bwhy (do you want to|are you interested in|would you like to|this|us|here|join|work (at|for|with))\b|\b(join|joining|working at|work at|work for) (us|our|the team|this company)\b|\bwhat (excites|interests|attracts) you\b|\babout (us|our (company|mission|product))\b/.test(q)) return true;
    if (c && c.length >= 3 && (q.includes(c) || norm(answer).includes(c))) return true;
    return false;
  }

  /**
   * Merge newly captured { question, answer, type } items into the answers list.
   * Returns { answers, added, updated }. Same normalized question (+ same company for scoped
   * answers) updates in place; manual answers the user wrote are never overwritten.
   */
  function mergeAnswers(answers, items, ctx) {
    const list = Array.isArray(answers) ? answers.slice() : [];
    const company = (ctx && ctx.company) || '';
    const now = (ctx && ctx.now) || new Date().toISOString();
    let added = 0;
    let updated = 0;
    for (const it of items || []) {
      const question = String(it.question || '').replace(/\s*[*✱]\s*$/, '').trim();
      const answer = String(it.answer == null ? '' : it.answer).trim();
      if (!question || !answer || question.length > 400 || answer.length > 4000 || looksSensitive(answer)) continue;
      const scope = isCompanySpecific(question, answer, company) ? 'company' : 'any';
      const nq = norm(question);
      if (list.some((a) => a && a.source !== 'remembered' && norm(a.question) === nq)) continue; // the user's own answer wins
      const existing = list.find((a) => a && norm(a.question) === nq && (scope === 'any' ? a.scope !== 'company' : a.scope === 'company' && norm(a.company) === norm(company)));
      if (existing) {
        if (existing.source !== 'remembered') continue; // the user's own saved answer wins
        if (existing.answer !== answer) {
          existing.answer = answer;
          updated++;
        }
        existing.uses = (existing.uses || 1) + 1;
        existing.updatedAt = now;
        continue;
      }
      const entry = { question, answer, scope, source: 'remembered', uses: 1, updatedAt: now };
      if (scope === 'company') entry.company = company;
      if (ctx && ctx.host) entry.host = ctx.host;
      list.push(entry);
      added++;
    }
    return { answers: list, added, updated };
  }

  /**
   * Do a site's value and our profile value mean the same thing? Formatting differences (phone
   * punctuation and country code, URL scheme/www/trailing slash, case, spacing, punctuation) don't count.
   */
  function sameValue(key, site, ours) {
    const a = String(site == null ? '' : site).trim();
    const b = String(ours == null ? '' : ours).trim();
    if (!a || !b) return a === b;
    const loose = (s) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    switch (key) {
      case 'phone': {
        const da = a.replace(/\D/g, '');
        const db = b.replace(/\D/g, '');
        return da.slice(-10) === db.slice(-10) && Math.min(da.length, db.length) >= 7;
      }
      case 'email':
        return a.toLowerCase() === b.toLowerCase();
      case 'linkedin':
      case 'github':
      case 'portfolio':
      case 'website':
      case 'twitter': {
        const u = (s) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
        return u(a) === u(b);
      }
      case 'location':
        // "London, United Kingdom" vs "London": the site's value only needs our city in it.
        return loose(a).includes(loose(b).split(' ')[0]) || loose(b).includes(loose(a));
      case 'fullName': {
        const ta = loose(a).split(' ');
        const tb = loose(b).split(' ');
        return ta[0] === tb[0] && ta[ta.length - 1] === tb[tb.length - 1];
      }
      default:
        return loose(a) === loose(b);
    }
  }

  JC.rules = { yearsAnswer, yearsDetail, mergedMonths, parseLanguages, levelCandidates, degreeCandidates, formerEmployerOf, formerEmployerAnswer, choosePhoneCode, dialCode, evidenceAnswer, experienceTerms, chooseResumeSource, sameValue, timeZoneCandidates, classifyField, valueForKey, chooseOption, matchSavedAnswer, mergeAnswers, isCompanySpecific, looksSensitive, NEVER_REMEMBER, humanize, norm, payPeriod, amounts, parseAmount, toNumberValue, emptyReason, LONG_LABEL };

  if (typeof module !== 'undefined' && module.exports) module.exports = JC;
})(typeof globalThis !== 'undefined' ? globalThis : self);
