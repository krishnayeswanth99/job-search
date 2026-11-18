/*
 * Job Copilot: the AI tasks, independent of which model runs them.
 *
 * Each task builds its prompt, calls `complete(prompt, schema)` (a function that returns the
 * model's text) and parses the reply. The caller decides the model:
 *   - Chrome's Gemini Nano: offscreen/nano.js passes a Prompt API session,
 *   - Claude or any OpenAI-compatible server: the service worker passes JC.llm.completer(cfg).
 *
 * Tasks never return made-up facts: choices are limited to real options or profile fields, and
 * tailoring keeps employers, titles and dates from the profile (see tailor()).
 */
(function (root) {
  const JC = (root.JC = root.JC || {});

  /** End-to-end tests store canned replies instead of running a model. */
  function testComplete(testReply) {
    return async () => testReply;
  }

  /** Field check: which profile field answers each filled field (or none). */
  async function check({ review, profile, testReply }, complete) {
    if (!profile) return { ok: false, error: 'no profile' };
    const { prompt, fields, keys } = JC.nanoCheck.buildPrompt({ review, profile: JC.normalizeProfile(profile) });
    if (!fields.length) return { ok: true, fixes: [], checked: 0 };
    const run = testReply ? testComplete(testReply) : complete;
    const reply = await run(prompt, JC.nanoCheck.schema(fields, keys));
    return { ok: true, fixes: JC.nanoCheck.parse(reply, fields, keys), checked: fields.length };
  }

  /** Answer check: ok / wrong / unsure for each answer put in. */
  async function verify({ items, profile, resumeText, job, testReply }, complete) {
    const { prompt, fields } = JC.nanoCheck.buildVerifyPrompt({ items, profile, resumeText, job });
    if (!fields.length) return { ok: true, flags: [], checked: 0 };
    // "VERDICTS:{\"part of a label\": \"wrong\"}" answers by label (tests).
    if (typeof testReply === 'string' && testReply.startsWith('VERDICTS:')) {
      const by = JSON.parse(testReply.slice(9));
      const verdicts = {};
      for (const f of fields) verdicts[f.id] = (Object.entries(by).find(([k]) => f.label.toLowerCase().includes(k.toLowerCase())) || [])[1] || 'ok';
      return { ok: true, flags: JC.nanoCheck.parseVerify({ verdicts }, fields), checked: fields.length };
    }
    const run = testReply ? testComplete(testReply) : complete;
    const reply = await run(prompt, JC.nanoCheck.verifySchema(fields));
    return { ok: true, flags: JC.nanoCheck.parseVerify(reply, fields), checked: fields.length };
  }

  /** Draft answers to open questions, `batch` at a time, from the profile and resume only. */
  async function answer({ questions, job, profile, resumeText, testReply, batch }, complete) {
    const A = JC.ask;
    const overrides = {};
    const askMe = [];
    const problems = [];
    // "BY_LABEL:{\"part of a label\": \"answer\"}" answers by label (tests).
    const byLabel = typeof testReply === 'string' && testReply.startsWith('BY_LABEL:') ? JSON.parse(testReply.slice(9)) : null;
    for (const group of A.batches(questions, batch || 3)) {
      let reply = null;
      if (byLabel) {
        const answers = {};
        for (const q of group) answers[q.id] = (Object.entries(byLabel).find(([k]) => q.label.toLowerCase().includes(k.toLowerCase())) || [])[1] || 'ASK_ME';
        reply = JSON.stringify({ answers });
      } else {
        const prompt = A.buildCompactPrompt({ questions: group, job, profile, resumeText });
        try {
          reply = await (testReply ? testComplete(testReply) : complete)(prompt, A.schemaFor(group));
        } catch (e) {
          problems.push(String((e && e.message) || e).slice(0, 160));
        }
      }
      if (reply === null) continue;
      try {
        const parsed = A.parseReply(reply, group);
        for (const q of group) {
          const v = parsed.overrides[q.id];
          if (!v) continue;
          if (q.options && q.options.length && !q.options.includes(v)) continue; // choices: real options only
          if (q.maxLength && v.length > q.maxLength) continue;
          overrides[q.id] = v;
        }
        askMe.push(...parsed.askMe);
      } catch (_) {
        problems.push('reply was not JSON');
      }
    }
    return { ok: true, overrides, askMe, problems };
  }

  /**
   * Tailor an application to a job: a summary, bullets per job, skills and a cover letter, written
   * only from the applicant's own data. Returns a draft (see JC.draft.fromModel).
   */
  async function tailor({ profile, resumeText, job, testReply, small }, complete) {
    const { prompt, schema } = JC.draft.buildTailorPrompt({ profile, resumeText, job, small });
    const reply = await (testReply && !String(testReply).startsWith('BY_LABEL:') && !String(testReply).startsWith('VERDICTS:') ? testComplete(testReply) : complete)(prompt, schema);
    return { ok: true, draft: JC.draft.fromModel(reply, profile, job, resumeText) };
  }

  /** "Test the model" in options. */
  async function ping(args, complete) {
    const t0 = Date.now();
    const reply = await complete('Reply with exactly: OK', null);
    return { ok: true, reply: String(reply || '').trim().slice(0, 200), ms: Date.now() - t0 };
  }

  JC.aiTasks = { check, verify, answer, tailor, ping };
  if (typeof module !== 'undefined' && module.exports) module.exports = JC.aiTasks;
})(typeof globalThis !== 'undefined' ? globalThis : self);
