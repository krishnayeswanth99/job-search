/*
 * Job Copilot: check autofilled fields with Chrome's on-device model (Gemini Nano).
 *
 * Pure prompt building and reply parsing, no DOM and no model calls (those live in
 * offscreen/nano.js). The model never writes answers: for each filled field it only picks WHICH
 * profile field answers it, or "none". So it can catch a middle name filled with the full name,
 * or a "Title" prefix filled with a job title, but it cannot invent data.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});

  // Sections the model may see. EEO answers, saved answers and pay are left out.
  const SECTIONS = ['personal', 'links', 'work', 'education', 'authorization'];
  const NEVER = new Set(['desiredSalary', 'desiredHourlyRate', 'salaryCurrency', 'skills']);

  /** The applicant's data the model sees: [{ key, label, value }], non-empty fields only. */
  function bio(profile) {
    const out = [];
    for (const sec of JC.PROFILE_SECTIONS || []) {
      if (!SECTIONS.includes(sec.id)) continue;
      for (const [key, label] of sec.fields) {
        if (NEVER.has(key)) continue;
        const v = ((profile && profile[sec.id]) || {})[key];
        if (v !== undefined && v !== null && String(v).trim()) out.push({ key, label, value: String(v).trim().slice(0, 120) });
      }
    }
    const p = (profile && profile.personal) || {};
    if (p.firstName || p.lastName) out.push({ key: 'fullName', label: 'Full name', value: [p.firstName, p.lastName].filter(Boolean).join(' ') });
    return out;
  }

  /** Field descriptions for the prompt: [{ id, ref, label, type, options, maxLength, key }]. */
  function items(review) {
    return (review || []).slice(0, 15).map((r, i) => ({
      id: 'f' + (i + 1),
      ref: r.ref,
      frame: r.frame,
      label: String(r.label || '').slice(0, 160),
      type: r.type,
      options: (r.options || []).slice(0, 25),
      maxLength: r.maxLength,
      key: r.profileKey,
      weak: !!r.weak,
    }));
  }

  function buildPrompt({ review, profile }) {
    const data = bio(profile);
    const fields = items(review);
    const lines = [
      "You check an autofilled job application form. Below is the applicant's data, then the form fields, each with the data field that was used to fill it.",
      'For each form field, give the name of the data field whose value is the right answer, judging by the label and the kind of answer the field takes (its type, options and length).',
      'Keep the same data field when it is right. Answer "none" when no data field fits: for example a middle name, name prefix or suffix the data has no value for, or a question the data does not answer.',
      '',
      "APPLICANT'S DATA (name: value)",
      ...data.map((d) => `${d.key}: ${d.value}`),
      '',
      'FORM FIELDS',
      ...fields.map((f) => `${f.id}: "${f.label}" (${f.type}${f.options.length ? `; options: ${f.options.join(' | ')}` : ''}${f.maxLength ? `; max ${f.maxLength} characters` : ''}) filled with ${f.key}`),
      '',
      'Reply with JSON: {"checks": {"f1": "<data field name or none>", ...}}',
    ];
    return { prompt: lines.join('\n'), fields, keys: data.map((d) => d.key) };
  }

  function schema(fields, keys) {
    const props = {};
    for (const f of fields) props[f.id] = { type: 'string', enum: [...new Set(keys.concat([f.key, 'none']))] };
    return { type: 'object', properties: { checks: { type: 'object', properties: props, required: fields.map((f) => f.id), additionalProperties: false } }, required: ['checks'], additionalProperties: false };
  }

  /** -> [{ ref, frame, label, from, to }] for the fields the model says are wrong. */
  function parse(reply, fields, keys) {
    let j = reply;
    if (typeof reply === 'string') {
      const m = reply.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('reply was not JSON');
      j = JSON.parse(m[0]);
    }
    const checks = (j && (j.checks || j)) || {};
    const allowed = new Set(keys.concat(['none']));
    const out = [];
    for (const f of fields) {
      const to = String(checks[f.id] || '').trim();
      if (!to || to === f.key || !allowed.has(to)) continue;
      out.push({ ref: f.ref, frame: f.frame, label: f.label, from: f.key, to, weak: f.weak });
    }
    return out;
  }

  // ------------------------------------------------ verify every answer put in
  // The model reads each question with the answer that was filled and says "ok", "wrong" (it
  // contradicts the applicant's data) or "unsure" (the data doesn't say). It never writes answers:
  // doubtful ones are only outlined for the user.

  function buildVerifyPrompt({ items, profile, resumeText }) {
    const fields = (items || []).slice(0, 25).map((it, i) => ({
      id: 'a' + (i + 1),
      selector: it.selector,
      label: String(it.label || '').slice(0, 200),
      type: it.type,
      options: (it.options || []).slice(0, 15),
      value: String(it.value || '').slice(0, 300),
      source: it.source,
    }));
    const data = bio(profile);
    const exp = ((profile && profile.experience) || []).slice(0, 6).map((e) => `${e.title || '?'} at ${e.company || '?'} (${e.start || '?'} to ${e.current ? 'present' : e.end || '?'})`);
    const edu = ((profile && profile.educationHistory) || []).slice(0, 4).map((e) => `${e.degree || ''} ${e.fieldOfStudy || ''}, ${e.school || ''} ${e.end ? '(' + e.end.slice(0, 4) + ')' : ''}`.trim());
    const resume = resumeText && JC.ask && JC.ask.relevantResume ? JC.ask.relevantResume(resumeText, fields.map((f) => ({ label: f.label })), 2500) : '';
    const lines = [
      "You double-check a job application filled in for the applicant. For each question below, compare the answer that was filled in with the applicant's data.",
      'Reply "ok" when the data supports the answer (or it is a reasonable reading of it), "wrong" when the data contradicts it or it answers a different question, and "unsure" when the data does not say.',
      'Judge only against the data given. Do not judge style or wording.',
      '',
      "APPLICANT'S DATA",
      ...data.map((d) => `${d.label}: ${d.value}`),
      ...(exp.length ? ['Work history: ' + exp.join('; ')] : []),
      ...(edu.length ? ['Education: ' + edu.join('; ')] : []),
      ...(resume ? ['Resume (relevant lines):', resume] : []),
      '',
      'FILLED ANSWERS',
      ...fields.map((f) => `${f.id}: "${f.label}"${f.options.length ? ` (options: ${f.options.join(' | ')})` : ''} -> "${f.value}"`),
      '',
      'Reply with JSON: {"verdicts": {"a1": "ok" | "wrong" | "unsure", ...}}',
    ];
    return { prompt: lines.join('\n'), fields };
  }

  function verifySchema(fields) {
    const props = {};
    for (const f of fields) props[f.id] = { type: 'string', enum: ['ok', 'wrong', 'unsure'] };
    return { type: 'object', properties: { verdicts: { type: 'object', properties: props, required: fields.map((f) => f.id), additionalProperties: false } }, required: ['verdicts'], additionalProperties: false };
  }

  /** -> [{ selector, label, verdict: 'wrong' | 'unsure', value, source }] */
  function parseVerify(reply, fields) {
    let j = reply;
    if (typeof reply === 'string') {
      const m = reply.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('reply was not JSON');
      j = JSON.parse(m[0]);
    }
    const v = (j && (j.verdicts || j)) || {};
    return fields.filter((f) => v[f.id] === 'wrong' || v[f.id] === 'unsure').map((f) => ({ selector: f.selector, label: f.label, verdict: v[f.id], value: f.value, source: f.source }));
  }

  JC.nanoCheck = { bio, buildPrompt, schema, parse, buildVerifyPrompt, verifySchema, parseVerify };
  if (typeof module !== 'undefined' && module.exports) module.exports = JC.nanoCheck;
})(typeof globalThis !== 'undefined' ? globalThis : self);
