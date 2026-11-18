/*
 * Job Copilot: application drafts (pure logic, no DOM, no network).
 *
 * A draft is one job's tailored application, reviewed by you before it's used:
 *   { key, job: { title, company, description }, createdAt, status: 'draft' | 'approved',
 *     summary, experience: [{ i, title, company, location, start, end, current, bullets[] }],
 *     education: [...], skills: [...], coverLetter, warnings: [] }
 *
 * The model only chooses and rewords: employers, titles, locations and dates always come from the
 * profile, bullets may only use numbers found in that job's own text, and skills must appear in
 * the profile or resume. Once approved, the same draft fills the form and is rendered as the resume
 * and cover letter that get attached, so the application and the files say the same thing.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});

  const clip = (s, n) => {
    s = String(s || '').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  };
  const bulletsOf = (text) =>
    String(text || '')
      .split(/\n+/)
      .map((l) => l.replace(/^\s*([•\-*–▪◦]|\d+[.)])\s*/, '').trim())
      .filter(Boolean);

  /** Prompt + JSON schema for tailoring. `small` trims everything for small on-device models. */
  function buildTailorPrompt({ profile, resumeText, job, small }) {
    profile = JC.normalizeProfile(profile);
    const per = profile.personal || {};
    const w = profile.work || {};
    const exp = profile.experience || [];
    const per_job = small ? 500 : 2500;
    const jobs = exp.slice(0, small ? 4 : 8).map((e, i) =>
      [
        `JOB ${i}: ${e.title || '?'} at ${e.company || '?'}${e.location ? ' (' + e.location + ')' : ''}, ${e.start || '?'} to ${e.current ? 'present' : e.end || '?'}`,
        e.description ? 'Resume bullets:\n' + clip(e.description, per_job) : '',
        e.details ? 'More detail and projects (written by the applicant):\n' + clip(e.details, per_job) : '',
      ]
        .filter(Boolean)
        .join('\n')
    );
    const edu = (profile.educationHistory || []).map((e) => [e.degree, e.fieldOfStudy, e.school, e.end && e.end.slice(0, 4)].filter(Boolean).join(', '));
    const jd = job && job.description ? (JC.ask && JC.ask.compactJob ? JC.ask.compactJob(job.description, small ? 1000 : 3000) : clip(job.description, 3000)) : '';
    const lines = [
      job && (job.title || job.company)
        ? `Tailor this applicant's resume and write a cover letter for the job "${job.title || ''}"${job.company ? ' at ' + job.company : ''}.`
        : "Write this applicant's strongest general resume (no specific job) and a short general cover letter.",
      '',
      'Rules:',
      '- Use ONLY facts in the applicant data below. Never invent employers, titles, dates, numbers, tools, degrees or results.',
      "- For each job, write 2-5 resume bullets (up to 6 for the two most recent), each one line, starting with a strong verb, using that job's own bullets and details. Put the experience most relevant to the job first. Keep every number exactly as written.",
      '- Leave out jobs entirely only if they are clearly irrelevant AND older than the other jobs; otherwise include them with fewer bullets.',
      "- summary: 2-3 sentences, first person implied (no \"I\"), about the applicant's actual experience as it fits this job.",
      "- skills: up to 15, only skills that appear in the applicant data, the most relevant to the job first.",
      `- coverLetter: ${small ? '150-220' : '200-320'} words, plain paragraphs separated by blank lines, addressed "Dear ${job && job.company ? job.company : 'Hiring'} Team,", signed with the applicant's name. Specific to the job, using only the applicant's real experience.`,
      '- notes: anything the applicant should check (for example a requirement the data does not show).',
      '',
      'APPLICANT',
      `Name: ${[per.firstName, per.lastName].filter(Boolean).join(' ')}`,
      per.city || per.country ? `Location: ${[per.city, per.state, per.country].filter(Boolean).join(', ')}` : '',
      profile.summary ? 'Current summary: ' + clip(profile.summary, 600) : '',
      w.skills ? 'Skills: ' + clip(w.skills, 800) : '',
      w.languages ? 'Languages: ' + w.languages : '',
      edu.length ? 'Education: ' + edu.join('; ') : '',
      '',
      ...jobs,
      !exp.length && resumeText ? 'RESUME TEXT\n' + clip(resumeText, small ? 2500 : 8000) : '',
      '',
      jd ? 'THE JOB (key lines)\n' + jd : '',
      '',
      'Reply with JSON: {"summary": "...", "experience": [{"job": 0, "bullets": ["..."]}], "skills": ["..."], "coverLetter": "...", "notes": ["..."]}',
    ].filter((l) => l !== '');
    const schema = {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        experience: { type: 'array', items: { type: 'object', properties: { job: { type: 'integer' }, bullets: { type: 'array', items: { type: 'string' } } }, required: ['job', 'bullets'], additionalProperties: false } },
        skills: { type: 'array', items: { type: 'string' } },
        coverLetter: { type: 'string' },
        notes: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary', 'experience', 'skills', 'coverLetter', 'notes'],
      additionalProperties: false,
    };
    return { prompt: lines.join('\n'), schema };
  }

  const numbersIn = (s) => (String(s || '').match(/\d[\d,.]*%?/g) || []).map((n) => n.replace(/[,.]$/, '').replace(/,/g, ''));

  /**
   * Turn the model's reply into a draft, keeping only what the applicant's data supports.
   * `extraText` (the resume) also counts as a source for skills and numbers.
   */
  function fromModel(reply, profile, job, extraText) {
    profile = JC.normalizeProfile(profile);
    let j = reply;
    if (typeof reply === 'string') {
      const m = reply.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('the model did not reply with JSON');
      j = JSON.parse(m[0]);
    }
    const warnings = (Array.isArray(j.notes) ? j.notes : []).map((n) => clip(n, 240)).filter(Boolean).slice(0, 8);
    const exp = profile.experience || [];
    const byJob = new Map();
    for (const e of Array.isArray(j.experience) ? j.experience : []) {
      const i = Number(e && (e.job ?? e.i));
      if (Number.isInteger(i) && i >= 0 && i < exp.length && Array.isArray(e.bullets)) byJob.set(i, e.bullets);
    }
    const experience = exp.map((e, i) => {
      const source = [e.description, e.details, extraText].join('\n');
      const have = new Set(numbersIn(source));
      let bullets = (byJob.get(i) || [])
        .map((b) => clip(String(b || '').replace(/^\s*([•\-*–▪◦]|\d+[.)])\s*/, ''), 300))
        .filter(Boolean)
        .slice(0, 8);
      const kept = bullets.filter((b) => numbersIn(b).every((n) => have.has(n)));
      if (kept.length < bullets.length) warnings.push(`${e.title || 'A job'} at ${e.company || '?'}: left out ${bullets.length - kept.length} bullet(s) with numbers that aren't in your data`);
      bullets = kept;
      if (!bullets.length) bullets = bulletsOf(e.description).slice(0, 6); // the model skipped it: your own bullets
      return { i, title: e.title, company: e.company, location: e.location, start: e.start, end: e.end, current: !!e.current, bullets };
    });
    const allText = [(profile.work || {}).skills, extraText, ...exp.map((e) => [e.description, e.details].join(' '))].join(' ').toLowerCase();
    const skills = (Array.isArray(j.skills) ? j.skills : [])
      .map((s) => clip(s, 40))
      .filter((s) => s && allText.includes(s.toLowerCase()))
      .slice(0, 15);
    const name = [profile.personal.firstName, profile.personal.lastName].filter(Boolean).join(' ');
    return {
      key: (job && job.key) || '',
      job: job ? { title: job.title || '', company: job.company || '', description: String(job.description || '').slice(0, 6000) } : null,
      createdAt: new Date().toISOString(),
      status: 'draft',
      summary: clip(j.summary || profile.summary || '', 900),
      experience,
      education: (profile.educationHistory || []).slice(0, 6),
      skills: skills.length ? skills : String((profile.work || {}).skills || '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 15),
      coverLetter: String(j.coverLetter || '').trim().slice(0, 4000) || '',
      name,
      warnings,
    };
  }

  /** The profile as an approved draft says it (fills the form the same way the files read). */
  function applyToProfile(profile, draft) {
    const p = JSON.parse(JSON.stringify(JC.normalizeProfile(profile)));
    if (!draft || draft.status !== 'approved') return p;
    if (draft.summary) p.summary = draft.summary;
    for (const e of draft.experience || []) {
      if (p.experience[e.i] && e.bullets && e.bullets.length) p.experience[e.i].description = e.bullets.map((b) => '• ' + b).join('\n');
    }
    if (draft.skills && draft.skills.length) p.work.skills = draft.skills.join(', ');
    if (draft.coverLetter) p.coverLetterText = draft.coverLetter;
    return p;
  }

  /** The resume as plain sections, for the PDF writer and for previews. */
  function resumeDoc(profile, draft) {
    profile = JC.normalizeProfile(profile);
    const per = profile.personal || {};
    const l = profile.links || {};
    const fmt = (ym) => {
      const m = /^(\d{4})-(\d{2})$/.exec(ym || '');
      return m ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] + ' ' + m[1] : ym || '';
    };
    const exp = (draft ? draft.experience : (profile.experience || []).map((e, i) => Object.assign({ i, bullets: bulletsOf(e.description) }, e))).filter((e) => e.title || e.company);
    return {
      name: [per.firstName, per.lastName].filter(Boolean).join(' '),
      contact: [per.email, per.phone, [per.city, per.state, per.country].filter(Boolean).join(', '), l.linkedin, l.github, l.portfolio || l.website].filter(Boolean),
      summary: draft ? draft.summary : profile.summary,
      experience: exp.map((e) => ({ heading: `${e.title || ''}${e.company ? ' — ' + e.company : ''}`, meta: [e.location, [fmt(e.start), e.current ? 'Present' : fmt(e.end)].filter(Boolean).join(' – ')].filter(Boolean).join(' · '), bullets: e.bullets || [] })),
      education: ((draft && draft.education) || profile.educationHistory || []).map((e) => ({ heading: [e.degree, e.fieldOfStudy].filter(Boolean).join(' in ') + (e.school ? ' — ' + e.school : ''), meta: [fmt(e.start), fmt(e.end)].filter(Boolean).join(' – ') + (e.gpa ? ` · GPA ${e.gpa}` : '') })),
      skills: draft ? draft.skills : String((profile.work || {}).skills || '').split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
      languages: (profile.work || {}).languages || '',
    };
  }

  JC.draft = { buildTailorPrompt, fromModel, applyToProfile, resumeDoc, bulletsOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = JC.draft;
})(typeof globalThis !== 'undefined' ? globalThis : self);
