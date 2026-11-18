/*
 * Job Copilot: repeatable sections (work experience, education, skills).
 *
 * Applications such as Workday's "My Experience" have one block of fields per job or school and an
 * "Add" / "Add Another" button. This finds those blocks, clicks Add until there is one per entry in
 * the profile's `experience` / `educationHistory` lists, and fills each block. Fields that already
 * have a value (yours, or the site's "Use my last application") are left alone.
 *
 * A field belongs to a section by its id/name (workExperience-53--jobTitle, education[0][school])
 * or by the section heading above it ("Work Experience", "Employment History", "Education").
 */
(function (root) {
  const JC = (root.JC = root.JC || {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const humanize = (s) => (JC.rules ? JC.rules.humanize(s) : String(s || '').toLowerCase());

  const KIND_ID = [
    // The prefix must be followed by an entry number ("workExperience-53--", "experience[0]"), so a
    // form-wide prefix like Greenhouse's "job_application[first_name]" doesn't count.
    ['exp', /^(work[-_ ]?experiences?|experiences?|employments?|employment[-_ ]?history|work[-_ ]?history|jobs?|positions?|previous[-_ ]?employers?)(?:[-_.]|\[)?\d+(?:\]|[-_.]|$)/i],
    ['edu', /^(educations?|education[-_ ]?history|schools?|academics?)(?:[-_.]|\[)?\d+(?:\]|[-_.]|$)/i],
    ['lang', /^(languages?|language[-_ ]?skills?)(?:[-_.]|\[)?\d+(?:\]|[-_.]|$)/i],
  ];
  const KIND_HEADING = [
    ['exp', /^(work experience|experience|professional experience|employment( history)?|work history|previous employment|employment details|job history|positions? held)\b/i],
    ['edu', /^(education|educational (background|history)|academic (background|history|qualifications)|schools?|degrees?|qualifications)\b/i],
    ['lang', /^(languages?( spoken| skills| proficiency)?)\b/i],
  ];
  const HEADING_SEL = 'h1, h2, h3, h4, h5, legend, [role="heading"], [data-automation-id$="Heading" i], [data-automation-id$="-section" i] > div:first-child';

  /** All section headings in document order, each { el, kind: 'exp' | 'edu' | null }. */
  function headings() {
    return [...document.querySelectorAll(HEADING_SEL)]
      .filter((h) => h.getClientRects().length)
      .map((h) => {
        const t = clean(h.innerText || h.textContent).replace(/\s*\d+\s*$/, '');
        const hit = KIND_HEADING.find(([, re]) => re.test(t));
        return { el: h, kind: hit ? hit[0] : null, text: t };
      })
      .filter((h) => h.text && h.text.length < 80);
  }

  /** 'exp' | 'edu' | null for a form control. */
  function kindOf(el, hs) {
    if (!el) return null;
    for (const s of [el.id, el.name, el.getAttribute && el.getAttribute('data-automation-id')]) {
      const hit = s && KIND_ID.find(([, re]) => re.test(String(s)));
      if (hit) return hit[0];
    }
    // The last section heading before the field.
    hs = hs || headings();
    let kind = null;
    for (const h of hs) {
      if (h.el.contains(el)) continue;
      if (h.el.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) kind = h.kind;
      else break;
    }
    return kind;
  }

  // Which part of an entry a field is, from its label and attributes.
  const PARTS = {
    exp: [
      ['current', /\b(i )?(currently|presently) (work|working|employed)\b|\bi work here\b|\bcurrent (job|role|position|employer)\b|\bstill (work|working)\b|\bto present\b/],
      ['description', /\b(role )?description\b|\bresponsibilit|\bduties\b|\bsummary\b|\bachievements?\b|\baccomplishments?\b|\bwhat (did|do) you do\b/],
      ['title', /\b(job|position|role) title\b|\btitle\b|\bposition\b|\bdesignation\b|\brole\b/],
      ['company', /\b(company|employer|organi[sz]ation|firm)( name)?\b/],
      ['location', /\blocation\b|\bcity\b|\bwhere\b/],
      ['start', /\b(start|from|began|begin)\b/],
      ['end', /\b(end|to|until|finish)\b/],
    ],
    lang: [
      ['native', /\bnative\b|\bmother tongue\b|\bfirst language\b/],
      ['level', /\b(comprehension|overall|reading|speaking|writing|listening|proficiency|fluency|level)\b/],
      ['language', /\blanguage\b/],
    ],
    edu: [
      ['fieldOfStudy', /\bfield of study\b|\bmajor\b|\bdiscipline\b|\barea of study\b|\bspeciali[sz]ation\b|\bconcentration\b/],
      ['degree', /\bdegree\b|\bqualification\b|\bdiploma\b|\blevel of education\b/],
      ['school', /\bschool\b|\buniversity\b|\bcollege\b|\binstitut|\bacademy\b/],
      ['gpa', /\bgpa\b|\bgrade\b|\boverall result\b|\bcgpa\b|\bmarks\b|\bpercentage\b/],
      ['start', /\b(start|from|began|begin)\b/],
      ['end', /\b(end|to|until|graduat|completion|finish)\b/],
    ],
  };

  function attrText(el) {
    const auto = (el.closest('[data-automation-id^="formField"]') || { getAttribute: () => '' }).getAttribute('data-automation-id');
    return [el.id, el.name, auto, el.getAttribute('aria-label'), el.placeholder].map(humanize).filter(Boolean).join(' | ');
  }

  /** { part, datePart? } for a field of a known kind, or null. */
  function partOf(f, kind) {
    const label = humanize(f.label || '');
    const attrs = attrText(f.el);
    const datePart = /\bmonth\b|\bmm\b/.test(label + ' ' + attrs) && /date ?section ?month|^month$|^mm$/.test(label || attrs) ? 'Month' : /date ?section ?year|^year$|^yyyy$/.test(label) || /date ?section ?year/.test(attrs) ? 'Year' : null;
    // Date boxes: start or end from the attributes ("workExperience-53--startDate-dateSectionMonth").
    if (datePart || /\bdate\b/.test(label + ' ' + attrs)) {
      if (/\b(start|from)\b/.test(attrs) || /\b(start|from)\b/.test(label)) return { part: 'start', datePart };
      if (/\b(end|to|graduation|completion)\b/.test(attrs) || /\b(end|to|graduat)\b/.test(label)) return { part: 'end', datePart };
    }
    for (const text of [label, attrs]) {
      if (!text) continue;
      for (const [part, re] of PARTS[kind]) if (re.test(text)) return { part, datePart };
    }
    return null;
  }

  /** The entry a field belongs to: Workday's number ("workExperience-53--"), or an index in the name. */
  function entryKeyOf(el) {
    for (const s of [el.id, el.name]) {
      const m = String(s || '').match(/^[a-z_-]*?[-_[](\d+)(?:\]|--|[-_.])/i) || String(s || '').match(/[[_-](\d+)[\]_-]/);
      if (m) return m[1];
    }
    return null;
  }

  /** Blocks of a kind in page order: [{ fields: [{ f, part, datePart }] }]. */
  function groups(kind, fields) {
    const hs = headings();
    const mine = fields.filter((f) => f.el && kindOf(f.el, hs) === kind);
    const out = [];
    const byKey = new Map();
    let cur = null;
    for (const f of mine) {
      const p = partOf(f, kind);
      if (!p) continue;
      const key = entryKeyOf(f.el);
      let g = key !== null ? byKey.get(key) : null;
      if (!g && key === null && cur && !cur.fields.some((x) => x.part === p.part && x.datePart === p.datePart)) g = cur;
      if (!g) {
        g = { key, fields: [] };
        out.push(g);
        if (key !== null) byKey.set(key, g);
      }
      g.fields.push(Object.assign({ f }, p));
      cur = g;
    }
    return out;
  }

  const ADD_RE = /^(\+\s*)?add( another| more| new)?( (work )?experience| (a )?(job|position|employer|employment|role)| education| (a )?(school|degree|qualification)| (a )?language)?\s*\+?$/i;

  /** The "Add" button of a section kind: its text names the kind, or the last heading before it does. */
  function addButton(kind) {
    const hs = headings();
    const btns = [...document.querySelectorAll('button, [role="button"], a')].filter((b) => b.getClientRects().length && !b.disabled && ADD_RE.test(clean(b.innerText || b.getAttribute('aria-label'))));
    for (const b of btns) {
      const t = clean(b.innerText || b.getAttribute('aria-label')).toLowerCase();
      if (/experience|job|position|employ|role/.test(t)) {
        if (kind === 'exp') return b;
        continue;
      }
      if (/education|school|degree|qualification/.test(t)) {
        if (kind === 'edu') return b;
        continue;
      }
      if (/language/.test(t)) {
        if (kind === 'lang') return b;
        continue;
      }
      if (kindOf(b, hs) === kind) return b;
    }
    return null;
  }

  // ------------------------------------------------------------------ values
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function dateValue(ym, f, datePart) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '')) || /^(\d{4})$/.exec(String(ym || ''));
    if (!m) return null;
    const y = m[1];
    const mm = m[2] || '01';
    if (datePart === 'Month') return f.type === 'select' ? MONTHS[Number(mm) - 1] : mm;
    if (datePart === 'Year') return y;
    if (f.el.type === 'month') return `${y}-${mm}`;
    if (f.el.type === 'date') return `${y}-${mm}-01`;
    if (f.type === 'select') {
      const opts = [...f.el.options].map((o) => o.text);
      if (opts.some((t) => /^(19|20)\d{2}$/.test(t.trim()))) return y;
      return MONTHS[Number(mm) - 1];
    }
    const ph = String(f.el.placeholder || f.label || '').toLowerCase();
    if (/yyyy-mm/.test(ph)) return `${y}-${mm}`;
    if (/mm\/dd\/yyyy/.test(ph)) return `${mm}/01/${y}`;
    if (/^yyyy$|\byear\b/.test(ph) && !/month|mm/.test(ph)) return y;
    return `${mm}/${y}`;
  }

  function valueFor(kind, item, part, f, datePart) {
    if (kind === 'lang') {
      if (part === 'native') return item.native ? 'yes' : 'no';
      if (part === 'level') return item.level || null;
      return item.language || null;
    }
    if (part === 'start') return dateValue(item.start, f, datePart);
    if (part === 'end') return kind === 'exp' && item.current ? null : dateValue(item.end, f, datePart);
    if (part === 'current') return item.current ? 'yes' : 'no';
    const v = item[part];
    return v === undefined || v === null || v === '' ? null : String(v);
  }

  /** The profile's entries, newest first; without a list, the current job/school from the profile. */
  function itemsFor(kind, profile) {
    if (kind === 'lang') return JC.rules.parseLanguages((profile.work || {}).languages);
    if (kind === 'exp') {
      if (profile.experience && profile.experience.length) return profile.experience;
      const w = profile.work || {};
      return w.currentTitle || w.currentCompany ? [{ title: w.currentTitle, company: w.currentCompany, current: true }] : [];
    }
    if (profile.educationHistory && profile.educationHistory.length) return profile.educationHistory;
    const e = profile.education || {};
    return e.school || e.degree ? [{ school: e.school, degree: e.degree, fieldOfStudy: e.fieldOfStudy, end: e.graduationYear ? `${e.graduationYear}-05` : '', gpa: e.gpa }] : [];
  }

  async function fillField(x, value, kind) {
    const A = JC.autofill;
    const f = x.f;
    if (f.type === 'checkbox') {
      const want = value === 'yes';
      if (f.el.checked !== want) f.el.click();
      return true;
    }
    if (f.hasValue) return false; // keep what's there
    const choices = x.part === 'degree' ? JC.rules.degreeCandidates(value) : x.part === 'level' && kind === 'lang' ? JC.rules.levelCandidates(value) : [value];
    if (!choices.length) return false;
    if (f.combobox || f.type === 'listbox') {
      const r = await A.fillCombobox(f.el, choices, null);
      return r.ok;
    }
    if (f.type === 'select') {
      for (const c of choices) if (A.fillSelect(f.el, c, null)) return true;
      return false;
    }
    return A.setText(f.el, value);
  }

  /**
   * Fill the work experience and education sections from the profile.
   * Returns { filled: [{ label, section, entry }], needsInput: [...], added }.
   */
  async function fill(profile, ctx) {
    ctx = ctx || {};
    const filled = [];
    const needsInput = [];
    let added = 0;
    for (const kind of ['exp', 'edu', 'lang']) {
      const items = itemsFor(kind, profile).slice(0, 8);
      if (!items.length) continue;
      let gs = groups(kind, JC.fields.scan());
      // Add blocks until there is one per entry (Workday starts with none: just an "Add" button).
      const note = (step, extra) => JC.recorder && JC.recorder.note && JC.recorder.note(Object.assign({ step }, extra || {}));
      const name = { exp: 'work experience', edu: 'education', lang: 'languages' }[kind];
      const listed = kind === 'exp' ? (profile.experience || []).length : kind === 'edu' ? (profile.educationHistory || []).length : items.length;
      if (!listed && kind !== 'lang') note(`${name}: your profile has no ${kind === 'exp' ? 'work history' : 'school'} list, only the current one is used (upload your resume again in options, or add entries under "Work experience & education")`);
      for (let tries = 0; gs.length < items.length && tries < items.length + 2; tries++) {
        const b = addButton(kind);
        if (!b) {
          note(`${name}: ${items.length} in your profile, ${gs.length} on the page, and no "Add" button found for this section`);
          break;
        }
        const before = gs.length;
        b.scrollIntoView({ block: 'center' });
        b.click();
        added++;
        // Workday can take a few seconds to render a new block.
        for (let w = 0; w < 10 && gs.length <= before; w++) {
          await sleep(500);
          gs = groups(kind, JC.fields.scan());
        }
        if (gs.length <= before) {
          note(`${name}: clicked "${clean(b.innerText)}" but no new block appeared`);
          break;
        }
      }
      if (items.length) note(`${name}: ${items.length} in your profile, ${gs.length} block${gs.length === 1 ? '' : 's'} on the page`);
      for (let i = 0; i < Math.min(items.length, gs.length); i++) {
        // "Currently work here" first: it hides the end date on many forms.
        const order = gs[i].fields.slice().sort((a, b) => (a.part === 'current' ? -1 : 0) - (b.part === 'current' ? -1 : 0));
        for (const x of order) {
          const v = valueFor(kind, items[i], x.part, x.f, x.datePart);
          if (v === null) continue;
          if (x.part !== 'current' && !x.f.el.isConnected) continue;
          let ok = false;
          try {
            ok = await fillField(x, v, kind);
          } catch (_) {
            ok = false;
          }
          const d = JC.fields.describe(x.f);
          const secName = { exp: 'work experience', edu: 'education', lang: 'language' }[kind];
          if (ok) filled.push({ label: d.label, selector: d.selector, section: secName, entry: i + 1, part: x.part, value: x.part === 'current' ? (v === 'yes' ? 'Yes' : 'No') : v });
          else if (!x.f.hasValue) needsInput.push(Object.assign(d, { reason: `${secName} ${i + 1}: could not fill ${x.part}`, suggested: v }));
        }
      }
    }
    const skills = await fillSkills(profile, ctx);
    return { filled: filled.concat(skills), needsInput, added };
  }

  /**
   * Which skills to add to a skills picker, best first (up to 10):
   *   1. profile skills the job description mentions,
   *   2. skills the job description asks for that the resume shows (even if not in the profile list),
   *   3. skills you added yourself on earlier forms that this job mentions,
   *   4. the rest of the profile skills.
   */
  function skillPlan(profile, ctx, memory) {
    const split = (t) => String(t || '').split(/[,;\n|•]+/).map((s) => s.trim()).filter((s) => s && s.length <= 40);
    const mine = split((profile.work || {}).skills);
    const jd = String((ctx && ctx.jobDesc) || '');
    const resume = String((ctx && ctx.resumeText) || '');
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const has = (text, s) => new RegExp('(^|[^A-Za-z0-9+#])' + esc(s) + '($|[^A-Za-z0-9+#])', 'i').test(text);
    const fromJd = jd && JC.rules.experienceTerms ? JC.rules.experienceTerms(jd, (profile.work || {}).skills).filter((t) => t.length >= 2 && t.length <= 30 && has(resume, t) && !/^(we|our|you|the|and|for|with|team|teams|data|role|job|work|company|inc|llc)$/i.test(t)) : [];
    const users = (memory.userSkills || []).filter((s) => jd && has(jd, s));
    const order = [...mine.filter((s) => jd && has(jd, s)), ...fromJd, ...users, ...mine];
    const out = [];
    for (const s of order) if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
    return out.slice(0, 10);
  }

  /** Workday-style skills picker: add skills one search at a time, remembering the picker's names. */
  async function fillSkills(profile, ctx) {
    const box = JC.fields.scan().find(isSkillsBox);
    if (!box) return [];
    const note = (step, extra) => JC.recorder && JC.recorder.note && JC.recorder.note(Object.assign({ step }, extra || {}));
    let memory = {};
    try {
      memory = (await chrome.storage.local.get('skillMemory')).skillMemory || {};
    } catch (_) {}
    memory.names = memory.names || {}; // "python" -> "Python (Programming Language)"
    memory.userSkills = memory.userSkills || [];
    const list = skillPlan(profile, ctx, memory);
    if (!list.length) {
      note('skills: your profile has no skills (add them under Work → Key skills in options)');
      return [{ label: box.label || 'Skills', selector: JC.fields.describe(box).selector, section: 'skills', failed: 'no skills in your profile' }];
    }
    const container = box.el.closest('[data-automation-id^="formField"]') || box.el.parentElement;
    const pills = () => [...(container ? container.querySelectorAll('[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"] li') : [])].map((e) => clean(e.innerText));
    const before = pills();
    const added = [];
    for (const s of list) {
      const have = pills().map((h) => h.toLowerCase());
      const known = memory.names[s.toLowerCase()];
      if (have.some((h) => h === s.toLowerCase() || h.startsWith(s.toLowerCase() + ' ') || (known && h === known.toLowerCase()))) continue;
      const r = await JC.autofill.fillCombobox(box.el, known ? [known, s] : [s], null).catch(() => ({ ok: false }));
      if (r.ok) {
        added.push(s);
        if (r.chosen) memory.names[s.toLowerCase()] = r.chosen.split(' > ').pop();
      }
      await sleep(250);
    }
    // Skills already there that Job Copilot didn't add (yours, or "use my last application"):
    // remembered, and offered on later forms whose job description mentions them.
    const ours = new Set(Object.values(memory.names).map((v) => v.toLowerCase()));
    for (const p of before) {
      const base = p.replace(/\s*\(.*\)\s*$/, '').trim();
      if (base && !ours.has(p.toLowerCase()) && !memory.userSkills.some((u) => u.toLowerCase() === base.toLowerCase())) memory.userSkills.push(base);
    }
    memory.userSkills = memory.userSkills.slice(-60);
    try {
      await chrome.storage.local.set({ skillMemory: memory });
    } catch (_) {}
    note(`skills: added ${added.length} of ${list.length} (${added.join(', ') || 'none matched the picker'})`);
    return [{ label: box.label || 'Skills', selector: JC.fields.describe(box).selector, section: 'skills', added, failed: added.length ? undefined : `none of ${list.slice(0, 5).join(', ')} matched the picker's options` }];
  }

  /** A type-ahead skills picker (Workday "Type to Add Skills" and similar). */
  function isSkillsBox(f) {
    return !!(f && f.combobox && f.type !== 'listbox' && (/\bskills?\b/i.test(f.label || '') || /(^|[-_])skills?([-_]|$)/i.test((f.el && f.el.id) || '')) && !/\b(language|years|rate|level)\b/i.test(f.label || ''));
  }

  JC.sections = { isSkillsBox, skillPlan, kindOf, headings, groups, partOf, addButton, fill, fillSkills, dateValue };
})(typeof globalThis !== 'undefined' ? globalThis : self);
