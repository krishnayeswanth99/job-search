/*
 * Job Copilot: which model runs the AI tasks.
 *
 *   settings.llm = { provider: 'nano' | 'claude' | 'openai', baseUrl, model, apiKey }
 *
 * - nano:   Chrome's built-in Gemini Nano (Prompt API), run by offscreen/nano.js. Free, on-device.
 * - claude: the Anthropic API with your key (the same key as "Read my resume with Claude").
 * - openai: any server that speaks the OpenAI chat-completions format: Ollama or LM Studio on your
 *           own computer, or OpenRouter, Groq, Together, OpenAI… (see docs/models.md).
 *
 * buildRequest / readResponse are pure (unit-tested); completer() does the fetch.
 */
(function (root) {
  const JC = (root.JC = root.JC || {});

  const PROVIDERS = [
    { id: 'nano', name: "Chrome's on-device AI (Gemini Nano): free, private, no setup" },
    { id: 'openai', name: 'OpenAI-compatible server: Ollama / LM Studio on this computer, or OpenRouter, Groq, OpenAI…' },
    { id: 'claude', name: 'Claude (Anthropic API key)' },
  ];

  // Ready-made settings for common servers (the model is a suggestion; use any you have).
  const PRESETS = {
    ollama: { label: 'Ollama (this computer)', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b-instruct' },
    lmstudio: { label: 'LM Studio (this computer)', baseUrl: 'http://localhost:1234/v1', model: 'qwen2.5-7b-instruct' },
    openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.1-8b-instruct' },
    groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant' },
    openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  };

  const SYSTEM =
    'You help a job applicant fill in applications. Use only the facts you are given about the applicant; never invent experience, employers, dates, numbers or credentials. Follow the requested JSON format exactly.';

  /** -> { url, init } for one request. `attempt` 0 asks for strict JSON-schema output, 1 plain JSON, 2 free text. */
  function buildRequest(cfg, prompt, schema, attempt) {
    attempt = attempt || 0;
    const p = String(prompt || '');
    if (cfg.provider === 'claude') {
      const body = { model: cfg.model || 'claude-haiku-5-5', max_tokens: 4000, system: SYSTEM, messages: [{ role: 'user', content: attempt && schema ? p + '\n\nReply with only the JSON object.' : p }] };
      body.output_config = attempt === 0 && schema ? { effort: 'low', format: { type: 'json_schema', schema } } : { effort: 'low' };
      return {
        url: 'https://api.anthropic.com/v1/messages',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey || '', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify(body),
        },
      };
    }
    if (cfg.provider === 'openai') {
      const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
      const body = { model: cfg.model, temperature: 0.2, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: attempt && schema ? p + '\n\nReply with only the JSON object.' : p }] };
      if (schema && attempt === 0) body.response_format = { type: 'json_schema', json_schema: { name: 'reply', schema, strict: false } };
      else if (schema && attempt === 1) body.response_format = { type: 'json_object' };
      const headers = { 'content-type': 'application/json' };
      if (cfg.apiKey) headers.authorization = 'Bearer ' + cfg.apiKey;
      return { url: base + '/chat/completions', init: { method: 'POST', headers, body: JSON.stringify(body) } };
    }
    throw new Error(`${cfg.provider} runs inside Chrome, not over HTTP`);
  }

  /** The reply text from a provider's JSON response. */
  function readResponse(cfg, json) {
    if (!json || typeof json !== 'object') throw new Error('empty reply');
    if (json.error) throw new Error(typeof json.error === 'string' ? json.error : json.error.message || JSON.stringify(json.error).slice(0, 200));
    if (cfg.provider === 'claude') {
      if (json.stop_reason === 'refusal') throw new Error('the model declined');
      return (json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    }
    const c = json.choices && json.choices[0];
    return (c && c.message && (c.message.content || '')) || '';
  }

  /** What's missing before a provider can run, or ''. */
  function problem(cfg) {
    if (!cfg || cfg.provider === 'nano') return '';
    if (cfg.provider === 'claude') return cfg.apiKey ? '' : 'Add your Anthropic API key in options (Claude API).';
    if (cfg.provider === 'openai') return !cfg.baseUrl ? 'Set the server address in options (AI model).' : !cfg.model ? 'Set the model name in options (AI model).' : '';
    return `unknown provider "${cfg.provider}"`;
  }

  /**
   * async (prompt, schema) => text for an HTTP provider. Servers that don't support JSON-schema
   * output get plain-JSON mode, then free text (the parsers find the JSON in the reply).
   */
  function completer(cfg, fetchImpl) {
    const f = fetchImpl || fetch;
    return async function complete(prompt, schema) {
      const why = problem(cfg);
      if (why) throw new Error(why);
      let last = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { url, init } = buildRequest(cfg, prompt, schema, attempt);
        let res;
        try {
          res = await f(url, Object.assign({ signal: AbortSignal.timeout ? AbortSignal.timeout(120000) : undefined }, init));
        } catch (e) {
          throw new Error(`could not reach ${new URL(url).host}: ${e.message || e}${/localhost|127\.0\.0\.1/.test(url) ? ' (is the server running, and does it allow this extension? see docs/models.md)' : ''}`);
        }
        let json = null;
        try {
          json = await res.json();
        } catch (_) {}
        if (res.ok) return readResponse(cfg, json);
        last = new Error(`${res.status} from ${new URL(url).host}: ${(json && json.error && (json.error.message || json.error)) || res.statusText}`.slice(0, 300));
        if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 429) break; // not a format problem
        if (!schema) break;
      }
      throw last;
    };
  }

  JC.llm = { PROVIDERS, PRESETS, buildRequest, readResponse, completer, problem };
  if (typeof module !== 'undefined' && module.exports) module.exports = JC.llm;
})(typeof globalThis !== 'undefined' ? globalThis : self);
