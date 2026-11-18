/*
 * Job Copilot: runs Chrome's on-device model (Gemini Nano, Prompt API) for the service worker,
 * which can't use it itself. The tasks (field check, answer check, answers, tailoring) live in
 * src/shared/ai-tasks.js; this page only supplies the model. Everything stays on this computer.
 */
const LANG = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };
let session = null;

async function getSession() {
  if (typeof LanguageModel === 'undefined') throw new Error("on-device AI isn't available in this Chrome (it needs Gemini Nano). Pick another model under AI model in options");
  const avail = await LanguageModel.availability(LANG).catch(() => 'unavailable');
  if (avail === 'unavailable') throw new Error("on-device AI isn't available on this computer. Pick another model under AI model in options");
  if (avail !== 'available') throw new Error('on-device model not downloaded yet (use "Answer with on-device AI" in the popup once to download it)');
  if (session) return session;
  try {
    session = await LanguageModel.create(LANG);
  } catch (_) {
    session = await LanguageModel.create();
  }
  return session;
}

/** (prompt, schema) => text, each prompt in a fresh context; without the schema if Nano rejects it. */
async function nanoComplete(prompt, schema) {
  const s = await getSession();
  const c = s.clone ? await s.clone() : s;
  try {
    try {
      return await c.prompt(prompt, schema ? { responseConstraint: schema } : undefined);
    } catch (e) {
      if (!schema) throw e;
      return await c.prompt(prompt + '\n\nReply with only the JSON object.');
    }
  } finally {
    if (c !== s && c.destroy) c.destroy();
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'jc:ai') return;
  const task = JC.aiTasks[msg.kind];
  if (!task) return reply({ ok: false, error: 'unknown task ' + msg.kind });
  task(Object.assign({ small: true, batch: 3 }, msg.args), nanoComplete)
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
