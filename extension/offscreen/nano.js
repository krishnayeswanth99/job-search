/*
 * Job Copilot: runs Chrome's on-device model (Gemini Nano, Prompt API) for the service worker,
 * which can't use it itself. Asked to check freshly autofilled fields; replies with the fields the
 * model thinks were filled from the wrong profile field. Everything stays on this computer.
 */
const LANG = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
let session = null;

// Offscreen pages only get chrome.runtime, so the service worker sends the profile along.
async function getSession(testReply) {
  // End-to-end tests have no model: they store a canned reply instead.
  if (testReply) return { prompt: async () => testReply };
  if (typeof LanguageModel === 'undefined') throw new Error("on-device AI isn't available in this Chrome (it needs Gemini Nano)");
  const avail = await LanguageModel.availability(LANG).catch(() => 'unavailable');
  if (avail === 'unavailable') throw new Error("on-device AI isn't available on this computer");
  if (avail !== 'available') throw new Error('on-device model not downloaded yet (use "Answer with on-device AI" in the popup once to download it)');
  if (session) return session;
  try {
    session = await LanguageModel.create(LANG);
  } catch (_) {
    session = await LanguageModel.create();
  }
  return session;
}

async function check(review, profile, testReply) {
  if (!profile) return { ok: false, error: 'no profile' };
  const { prompt, fields, keys } = JC.nanoCheck.buildPrompt({ review, profile: JC.normalizeProfile(profile) });
  if (!fields.length) return { ok: true, fixes: [] };
  const s = await getSession(testReply);
  // Each check starts from a clean context.
  const c = s.clone ? await s.clone() : s;
  try {
    let reply;
    try {
      reply = await c.prompt(prompt, { responseConstraint: JC.nanoCheck.schema(fields, keys) });
    } catch (_) {
      reply = await c.prompt(prompt);
    }
    return { ok: true, fixes: JC.nanoCheck.parse(reply, fields, keys), checked: fields.length };
  } finally {
    if (c !== s && c.destroy) c.destroy();
  }
}

/** Draft answers to the questions autofill left open, a few at a time, from the profile and resume only. */
async function answer({ questions, job, profile, resumeText, testReply }) {
  const A = JC.ask;
  const s = await getSession(testReply);
  const overrides = {};
  const askMe = [];
  const problems = [];
  // End-to-end tests: "BY_LABEL:{\"part of a label\": \"answer\"}" answers by label instead of a model.
  const byLabel = typeof testReply === 'string' && testReply.startsWith('BY_LABEL:') ? JSON.parse(testReply.slice(9)) : null;
  for (const group of A.batches(questions, 3)) {
    if (byLabel) {
      const answers = {};
      for (const q of group) answers[q.id] = Object.entries(byLabel).find(([k]) => q.label.toLowerCase().includes(k.toLowerCase()))?.[1] || 'ASK_ME';
      const parsed = A.parseReply(JSON.stringify({ answers }), group);
      Object.assign(overrides, parsed.overrides);
      askMe.push(...parsed.askMe);
      continue;
    }
    const prompt = A.buildCompactPrompt({ questions: group, job, profile, resumeText });
    const c = s.clone ? await s.clone() : s;
    let reply = null;
    try {
      reply = await c.prompt(prompt, { responseConstraint: A.schemaFor(group) });
    } catch (e) {
      try {
        reply = await c.prompt(prompt + '\n\nReply with only the JSON object {"answers": {"<id>": "<answer>"}}.');
      } catch (e2) {
        problems.push(String((e2 && e2.message) || e2).slice(0, 120));
      }
    } finally {
      if (c !== s && c.destroy) c.destroy();
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

async function verify({ items, profile, resumeText, job, testReply }) {
  const { prompt, fields } = JC.nanoCheck.buildVerifyPrompt({ items, profile, resumeText, job });
  if (!fields.length) return { ok: true, flags: [], checked: 0 };
  // End-to-end tests: "VERDICTS:{\"part of a label\": \"wrong\"}".
  if (typeof testReply === 'string' && testReply.startsWith('VERDICTS:')) {
    const by = JSON.parse(testReply.slice(9));
    const verdicts = {};
    for (const f of fields) verdicts[f.id] = Object.entries(by).find(([k]) => f.label.toLowerCase().includes(k.toLowerCase()))?.[1] || 'ok';
    return { ok: true, flags: JC.nanoCheck.parseVerify({ verdicts }, fields), checked: fields.length };
  }
  const s = await getSession(testReply);
  const c = s.clone ? await s.clone() : s;
  try {
    let reply;
    try {
      reply = await c.prompt(prompt, { responseConstraint: JC.nanoCheck.verifySchema(fields) });
    } catch (_) {
      reply = await c.prompt(prompt + '\n\nReply with only the JSON object.');
    }
    return { ok: true, flags: JC.nanoCheck.parseVerify(reply, fields), checked: fields.length };
  } finally {
    if (c !== s && c.destroy) c.destroy();
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.target === 'offscreen' && msg.type === 'jc:nano-verify') {
    verify(msg)
      .then(reply)
      .catch((e) => reply({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  if (msg && msg.target === 'offscreen' && msg.type === 'jc:nano-answer') {
    answer(msg)
      .then(reply)
      .catch((e) => reply({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'jc:nano-check') return;
  check(msg.review, msg.profile, msg.testReply)
    .then(reply)
    .catch((e) => {
      if (session) {
        try {
          session.destroy();
        } catch (_) {}
        session = null;
      }
      reply({ ok: false, error: String((e && e.message) || e) });
    });
  return true;
});
