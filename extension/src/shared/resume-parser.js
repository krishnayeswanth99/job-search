/*
 * Job Copilot: resume text -> profile suggestions (pure logic, no DOM).
 *
 *   JC.resume.parse(text, { now }) -> {
 *     fields: { 'personal.email': { value, confidence: 'high'|'medium'|'low', note? }, ... },
 *     sections: { summary, experience, education, skills, ... } (raw lines),
 *     warnings: [string]
 *   }
 *
 * Heuristics only: the options page shows every suggestion for review and
 * editing before anything is saved. Nothing is invented: a field is suggested
 * only when the text contains it.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});

  const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
  const DATE = `(?:(?:${MONTHS})\\.?\\s*,?\\s*)?(?:\\d{1,2}\\/)?(?:19|20)\\d{2}`;
  const RANGE_RE = new RegExp(`(${DATE})\\s*(?:–|—|-|to|until|till)\\s*(${DATE}|present|current|now|today|ongoing|date)`, 'gi');

  const HEADINGS = [
    ['summary', /^(professional |career )?(summary|profile|about( me)?|objective|overview)$/],
    ['experience', /^(work |professional |relevant |employment )?(experience|employment( history)?|work history|career history)$/],
    ['education', /^(education|academic (background|qualifications)|education (and|&) (training|certifications?)|qualifications)$/],
    ['skills', /^((technical |core |key )?(skills|competencies|technologies|tech stack|tools)( (and|&) (tools|technologies|interests))?|areas of expertise)$/],
    ['projects', /^(projects|personal projects|selected projects|key projects)$/],
    ['certifications', /^(certifications?|licen[cs]es( (and|&) certifications)?|courses)$/],
    ['other', /^(awards|honors|honours|achievements|publications|volunteer(ing)?( experience)?|languages|interests|activities|leadership|references)$/],
  ];

  const ROLE_WORDS = /\b(engineer|developer|programmer|manager|analyst|scientist|designer|consultant|director|lead|intern|architect|specialist|associate|coordinator|administrator|officer|head|vp|vice president|president|founder|co-founder|researcher|technician|assistant|executive|representative|tester|sre|devops|accountant|teacher|nurse|editor|writer|recruiter|strategist|owner|partner|principal|staff|fellow|trainee|apprentice|advisor|instructor|professor|marketer|product)\b/i;
  const SCHOOL_WORDS = /\b(university|college|institute|school|academy|polytechnic|iit|nit|bits|iiit|universit[äaé]t|école|ecole)\b/i;
  const DEGREE_RE = /\b(Bachelor(?:'?s)?(?: of [A-Z][A-Za-z]+(?: (?:and|&) [A-Z][A-Za-z]+)?)?|Master(?:'?s)?(?: of [A-Z][A-Za-z]+(?: (?:and|&) [A-Z][A-Za-z]+)?)?|Associate(?:'?s)? (?:of|in) [A-Z][A-Za-z]+|Ph\.?\s?D\.?|Doctor(?:ate)? of [A-Z][A-Za-z]+|MBA|M\.?B\.?A\.?|B\.\s?(?:S|A|E|Sc|Com|Eng)\.?|M\.\s?(?:S|A|E|Sc|Eng)\.?|BS|BA|BSc|BEng|MS|MA|MSc|MEng|B\.?\s?Tech|M\.?\s?Tech|BCA|MCA|BBA|B\.?E\.?|M\.?E\.?)(?![A-Za-z])/;
  const US_STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
  const COUNTRIES = ['United States', 'USA', 'United Kingdom', 'UK', 'India', 'Canada', 'Germany', 'France', 'Netherlands', 'Ireland', 'Spain', 'Italy', 'Australia', 'Singapore', 'Japan', 'China', 'Brazil', 'Mexico', 'Israel', 'Poland', 'Sweden', 'Switzerland', 'Portugal', 'United Arab Emirates', 'UAE', 'New Zealand', 'South Africa', 'Nigeria', 'Kenya', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Philippines', 'Vietnam', 'Indonesia', 'Malaysia', 'South Korea', 'Denmark', 'Norway', 'Finland', 'Belgium', 'Austria', 'Czech Republic', 'Romania', 'Ukraine', 'Argentina', 'Chile', 'Colombia', 'Egypt', 'Turkey', 'Hong Kong', 'Taiwan'];
  const COUNTRY_CANON = { USA: 'United States', UK: 'United Kingdom', UAE: 'United Arab Emirates' };

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function normalizeText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/ /g, ' ')
      .replace(/[•●▪◦‣⁃∙]/g, '•')
      .replace(/\t/g, '  ')
      .replace(/ {3,}/g, '  '); // keep double spaces: they separate columns ("Title  Mar 2021 – Present")
  }

  function headingOf(line) {
    const t = line.toLowerCase().replace(/[:\-–—_|#*]+\s*$/, '').replace(/^[#*\s]+/, '').trim();
    if (!t || t.length > 45) return null;
    for (const [id, re] of HEADINGS) if (re.test(t)) return id;
    return null;
  }

  function splitSections(lines) {
    const sections = { header: [] };
    let cur = 'header';
    for (const l of lines) {
      const h = headingOf(l);
      if (h) {
        cur = h;
        sections[cur] = sections[cur] || [];
        continue;
      }
      (sections[cur] = sections[cur] || []).push(l);
    }
    return sections;
  }

  function titleCase(w) {
    return w.length > 1 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w;
  }

  // ------------------------------------------------------------------ contact
  function findEmail(text) {
    const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return m ? m[0] : '';
  }

  function findPhone(lines) {
    for (const l of lines) {
      const cands = l.match(/(?:\+\s?\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d[\d\s.-]{5,}\d/g) || [];
      for (const c of cands) {
        const digits = c.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 15) continue;
        if (/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(c.trim())) continue;
        const cc = c.trim().match(/^\+\s?(\d{1,3})(?=[\s.(-])/);
        return { phone: clean(c), countryCode: cc ? '+' + cc[1] : '' };
      }
    }
    return null;
  }

  function findLinks(text, email) {
    const out = {};
    const li = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9_%-]+)/i);
    if (li) out.linkedin = `https://www.linkedin.com/in/${li[1]}`;
    const gh = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]+)(?![A-Za-z0-9-]*\.)/i);
    if (gh) out.github = `https://github.com/${gh[1]}`;
    const tw = text.match(/(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]+)/i);
    if (tw) out.twitter = `https://x.com/${tw[1]}`;
    const emailDomain = email ? email.split('@')[1].toLowerCase() : '';
    const urls = text.match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|dev|me|net|org|co|ai|app|xyz|site|tech|page|design|in|uk|ca)(?:\/[^\s|,;)]*)?/gi) || [];
    for (const u of urls) {
      const low = u.toLowerCase();
      if (/linkedin\.com|github\.com|twitter\.com|x\.com\/|@/.test(low)) continue;
      if (emailDomain && low.replace(/^https?:\/\//, '').replace(/^www\./, '').startsWith(emailDomain)) continue;
      if (/gmail|yahoo|outlook|hotmail|icloud/.test(low)) continue;
      const url = /^https?:\/\//i.test(u) ? u : 'https://' + u;
      const key = /behance|dribbble|portfolio/.test(low) ? 'portfolio' : 'website';
      if (!out[key]) out[key] = url.replace(/[.)]+$/, '');
    }
    return out;
  }

  function findName(lines) {
    for (const raw of lines.slice(0, 6)) {
      const l = clean(raw.split(/\s[|•·]\s|\s{2,}/)[0].replace(/^#+\s*/, ''));
      if (!l || /[@\d/:]/.test(l) || l.length > 40) continue;
      if (/^(resume|résumé|curriculum vitae|cv|contact|profile|summary)$/i.test(l)) continue;
      const words = l.split(' ');
      if (words.length < 2 || words.length > 4) continue;
      if (!words.every((w) => /^[A-ZÀ-Ý][A-Za-zÀ-ÿ'.-]*$/.test(w))) continue;
      if (ROLE_WORDS.test(l) && words.length > 2) continue;
      const parts = words.map(titleCase);
      return { full: parts.join(' '), first: parts[0], last: parts[parts.length - 1] };
    }
    return null;
  }

  function findLocation(lines) {
    for (const raw of lines.slice(0, 8)) {
      for (const seg of raw.split(/\s*[|•·]\s*|\s{2,}|\s+[–—]\s+/)) {
        const s = clean(seg);
        if (!s || /@|https?:|\.com|linkedin|github/i.test(s)) continue;
        const m = s.match(/^([A-Z][A-Za-z.'\- ]{1,30}),\s*([A-Z]{2}|[A-Z][A-Za-z ]{2,30})(?:,\s*([A-Z][A-Za-z ]{2,30}))?(?:\s+(\d{5}(?:-\d{4})?|\d{6}))?$/);
        if (!m) continue;
        const [, city, second, third, zip] = m;
        const loc = { city: clean(city) };
        const isCountry = (x) => x && COUNTRIES.some((c) => c.toLowerCase() === x.toLowerCase());
        if (US_STATES.has(second)) Object.assign(loc, { state: second, country: 'United States' });
        else if (isCountry(second)) loc.country = COUNTRY_CANON[second] || second;
        else {
          loc.state = second;
          if (isCountry(third)) loc.country = COUNTRY_CANON[third] || third;
        }
        if (zip) loc.postalCode = zip;
        if (!loc.country && !loc.state) continue;
        return loc;
      }
    }
    return null;
  }

  // --------------------------------------------------------------- experience
  function toMonthIndex(dateStr, isEnd, now) {
    const s = dateStr.toLowerCase();
    if (/present|current|now|today|ongoing|date/.test(s)) return now.getFullYear() * 12 + now.getMonth();
    const y = parseInt((s.match(/(19|20)\d{2}/) || [])[0], 10);
    if (!y) return null;
    const mm = s.match(new RegExp(MONTHS, 'i'));
    const slash = s.match(/(\d{1,2})\/(19|20)\d{2}/);
    let m = isEnd ? 11 : 0;
    if (mm) m = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(mm[0].slice(0, 3).toLowerCase());
    else if (slash) m = Math.min(11, Math.max(0, parseInt(slash[1], 10) - 1));
    return y * 12 + m;
  }

  function rangesIn(line, now) {
    const out = [];
    RANGE_RE.lastIndex = 0;
    let m;
    while ((m = RANGE_RE.exec(line))) {
      const start = toMonthIndex(m[1], false, now);
      const end = toMonthIndex(m[2], true, now);
      if (start !== null && end !== null && end >= start) out.push({ start, end, text: m[0], current: /present|current|now|today|ongoing|date/i.test(m[2]) });
    }
    return out;
  }

  const isBullet = (l) => /^\s*([•\-*–▪◦]|\d+[.)])\s/.test(l);

  function splitHeader(text) {
    return text
      .split(/\s+(?:—|–|-|\||·|•|@)\s+|\s+at\s+|,\s+|\s{2,}|\t/)
      .map(clean)
      .filter((p) => p && !/^(remote|hybrid|on-?site|full[- ]time|part[- ]time|contract|internship)$/i.test(p));
  }

  function looksLikeLocation(p) {
    return /^[A-Z][A-Za-z.' -]+,\s*([A-Z]{2}|[A-Z][a-z]+)$/.test(p) || COUNTRIES.some((c) => c.toLowerCase() === p.toLowerCase()) || /^remote\b/i.test(p);
  }

  function parseExperience(lines, now) {
    const roles = [];
    lines.forEach((l, i) => {
      if (isBullet(l)) return;
      const rs = rangesIn(l, now);
      if (!rs.length) return;
      let headerText = clean(l.replace(rs[0].text, ' ').replace(/[()|,–—-]\s*$/, ''));
      // Title/company often sit on the line(s) just above the dates.
      const above = [];
      for (let j = i - 1; j >= 0 && above.length < 2; j--) {
        if (isBullet(lines[j]) || rangesIn(lines[j], now).length) break;
        above.unshift(lines[j]);
      }
      const parts = splitHeader([...above, headerText].join(' | ')).filter((p) => !looksLikeLocation(p) && !/^(19|20)\d{2}$/.test(p));
      const title = parts.find((p) => ROLE_WORDS.test(p) && p.length <= 70) || '';
      const company = parts.find((p) => p !== title && p.length <= 60 && !ROLE_WORDS.test(p)) || parts.find((p) => p !== title && p.length <= 60) || '';
      roles.push({ title, company, start: rs[0].start, end: rs[0].end, current: rs[0].current });
    });
    return roles;
  }

  function totalYears(roles) {
    const iv = roles.map((r) => [r.start, r.end + 1]).sort((a, b) => a[0] - b[0]);
    let months = 0;
    let cur = null;
    for (const [s, e] of iv) {
      if (!cur) cur = [s, e];
      else if (s <= cur[1]) cur[1] = Math.max(cur[1], e);
      else {
        months += cur[1] - cur[0];
        cur = [s, e];
      }
    }
    if (cur) months += cur[1] - cur[0];
    return Math.floor(months / 12);
  }

  // ---------------------------------------------------------------- education
  function parseEducation(lines, now) {
    const out = {};
    const idx = lines.findIndex((l) => SCHOOL_WORDS.test(l));
    const degIdx = lines.findIndex((l) => DEGREE_RE.test(l));
    if (idx >= 0) {
      const parts = splitHeader(lines[idx].replace(RANGE_RE, ' '));
      out.school = parts.find((p) => SCHOOL_WORDS.test(p)) || clean(lines[idx]);
      out.school = out.school.replace(/\s*\(?(19|20)\d{2}\)?\s*$/, '').trim();
    }
    if (degIdx >= 0) {
      const l = lines[degIdx];
      const m = l.match(DEGREE_RE);
      out.degree = clean(m[1]);
      const after = l.slice(m.index + m[0].length);
      const fos = after.match(/^\s*(?:in|of|,|-|–|:)?\s*((?:[A-Z][A-Za-z&/]*)(?:\s+(?:and|&|of|[A-Z][A-Za-z&/]*))*)/);
      if (fos && fos[1] && !SCHOOL_WORDS.test(fos[1]) && fos[1].length >= 3) out.fieldOfStudy = clean(fos[1]).replace(/\s+(and|&|of)$/, '');
    }
    // Graduation year: the latest year in the first education entry.
    const anchor = Math.max(0, Math.min(...[idx, degIdx].filter((x) => x >= 0).concat([0])));
    const block = lines.slice(anchor, anchor + 4).join(' ');
    const years = (block.match(/\b(19|20)\d{2}\b/g) || []).map(Number).filter((y) => y <= now.getFullYear() + 6);
    if (years.length) out.graduationYear = String(Math.max(...years));
    const gpa = block.match(/\b(?:C?GPA|grade)\b[:\s]*([0-9](?:\.\d{1,2})?)\s*(?:\/\s*(4(?:\.0+)?|10(?:\.0+)?))?/i);
    if (gpa) out.gpa = gpa[2] ? `${gpa[1]}/${gpa[2]}` : gpa[1];
    return out;
  }

  // ------------------------------------------------------------------- skills
  function parseSkills(lines) {
    const items = [];
    for (const l of lines) {
      const body = l.replace(/^\s*[•\-*–]\s*/, '').replace(/^[A-Za-z &/]{2,30}:\s*/, '');
      for (const s of body.split(/\s*[,|•;·]\s*|\s{2,}/)) {
        const t = clean(s).replace(/\.$/, '');
        if (t && t.length <= 40 && !items.some((x) => x.toLowerCase() === t.toLowerCase())) items.push(t);
      }
    }
    return items.slice(0, 40);
  }

  function parseSummary(lines) {
    const para = [];
    for (const l of lines) {
      if (para.length && isBullet(l)) break;
      para.push(clean(l.replace(/^\s*[•\-*]\s*/, '')));
      if (para.join(' ').length > 500) break;
    }
    return clean(para.join(' ')).slice(0, 600);
  }

  // -------------------------------------------------------------------- main
  function parse(text, opts) {
    const now = (opts && opts.now) || new Date();
    const norm = normalizeText(text);
    const lines = norm.split('\n').map((l) => l.trim()).filter(Boolean);
    const sections = splitSections(lines);
    const fields = {};
    const warnings = [];
    const set = (path, value, confidence, note) => {
      if (value !== undefined && value !== null && String(value).trim() !== '') fields[path] = Object.assign({ value: String(value).trim(), confidence }, note ? { note } : {});
    };

    const top = (sections.header && sections.header.length ? sections.header : lines).slice(0, 10);

    const email = findEmail(norm);
    set('personal.email', email, 'high');
    const phone = findPhone(top.concat(lines.slice(0, 15)));
    if (phone) {
      set('personal.phone', phone.phone, 'high');
      set('personal.phoneCountryCode', phone.countryCode, 'medium');
    }
    const name = findName(lines);
    if (name) {
      set('personal.firstName', name.first, 'medium');
      set('personal.lastName', name.last, 'medium');
    } else warnings.push('Could not find your name at the top of the resume.');
    const loc = findLocation(top);
    if (loc) {
      set('personal.city', loc.city, 'medium');
      set('personal.state', loc.state, 'medium');
      set('personal.country', loc.country, 'medium');
      set('personal.postalCode', loc.postalCode, 'medium');
    }
    const links = findLinks(norm, email);
    for (const k of Object.keys(links)) set('links.' + k, links[k], 'high');

    if (sections.summary) set('summary', parseSummary(sections.summary), 'medium');

    const expLines = sections.experience || [];
    const roles = parseExperience(expLines.length ? expLines : lines, now);
    if (roles.length) {
      const latest = roles.find((r) => r.current) || roles.slice().sort((a, b) => b.end - a.end)[0];
      set('work.currentTitle', latest.title, latest.title ? 'medium' : 'low');
      set('work.currentCompany', latest.company, latest.company ? 'medium' : 'low');
      const yrs = totalYears(roles);
      set('work.yearsExperience', yrs, 'low', `computed from ${roles.length} dated role${roles.length === 1 ? '' : 's'} (overlaps merged); adjust if it includes internships or gaps`);
    } else warnings.push('No dated roles found. Fill in your current title, company and years of experience yourself.');

    const edu = parseEducation(sections.education || lines.filter((l) => SCHOOL_WORDS.test(l) || DEGREE_RE.test(l)), now);
    set('education.school', edu.school, 'medium');
    set('education.degree', edu.degree, 'medium');
    set('education.fieldOfStudy', edu.fieldOfStudy, 'low');
    set('education.graduationYear', edu.graduationYear, 'medium');
    set('education.gpa', edu.gpa, 'medium');

    if (sections.skills) {
      const skills = parseSkills(sections.skills);
      if (skills.length) set('work.skills', skills.join(', '), 'medium');
    }

    if (lines.length < 8) warnings.push('Very little text was found. If the resume is a scanned image, type your details in instead.');
    return { fields, sections, warnings };
  }

  JC.resume = { parse, normalizeText, splitSections, rangesIn: (l, now) => rangesIn(l, now || new Date()) };

  if (typeof module !== 'undefined' && module.exports) module.exports = JC;
})(typeof globalThis !== 'undefined' ? globalThis : self);
