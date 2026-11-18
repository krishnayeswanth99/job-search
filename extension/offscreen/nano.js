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

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
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
