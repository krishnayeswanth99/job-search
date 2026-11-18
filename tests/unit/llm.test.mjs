import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJC } from './load.mjs';

const JC = loadJC(['shared/config.js', 'shared/llm.js']);
const L = JC.llm;

test('OpenAI-compatible requests: JSON schema first, then plain JSON, then free text', () => {
  const cfg = { provider: 'openai', baseUrl: 'http://localhost:11434/v1/', model: 'qwen2.5:7b-instruct' };
  const r0 = L.buildRequest(cfg, 'hi', { type: 'object' }, 0);
  assert.equal(r0.url, 'http://localhost:11434/v1/chat/completions');
  const b0 = JSON.parse(r0.init.body);
  assert.equal(b0.model, 'qwen2.5:7b-instruct');
  assert.equal(b0.response_format.type, 'json_schema');
  assert.equal(r0.init.headers.authorization, undefined);
  assert.equal(JSON.parse(L.buildRequest(cfg, 'hi', { type: 'object' }, 1).init.body).response_format.type, 'json_object');
  assert.equal(JSON.parse(L.buildRequest(cfg, 'hi', { type: 'object' }, 2).init.body).response_format, undefined);
  assert.equal(L.buildRequest(Object.assign({ apiKey: 'k' }, cfg), 'hi').init.headers.authorization, 'Bearer k');
  assert.equal(L.readResponse(cfg, { choices: [{ message: { content: '{"a":1}' } }] }), '{"a":1}');
});

test('Claude requests and what is missing', () => {
  const r = L.buildRequest({ provider: 'claude', apiKey: 'sk', model: 'claude-haiku-5-5' }, 'hi', { type: 'object' }, 0);
  assert.equal(r.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(r.init.headers['x-api-key'], 'sk');
  assert.equal(JSON.parse(r.init.body).output_config.format.type, 'json_schema');
  assert.equal(L.readResponse({ provider: 'claude' }, { content: [{ type: 'text', text: 'OK' }] }), 'OK');
  assert.match(L.problem({ provider: 'claude' }), /API key/);
  assert.match(L.problem({ provider: 'openai', baseUrl: 'x' }), /model name/);
  assert.equal(L.problem({ provider: 'nano' }), '');
});

test('completer falls back from JSON-schema mode when a server rejects it', async () => {
  const calls = [];
  const fake = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.response_format && body.response_format.type);
    if (body.response_format && body.response_format.type === 'json_schema') return { ok: false, status: 400, statusText: 'bad', json: async () => ({ error: { message: 'response_format not supported' } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
  };
  const text = await L.completer({ provider: 'openai', baseUrl: 'http://x/v1', model: 'm' }, fake)('hi', { type: 'object' });
  assert.equal(text, '{"ok":true}');
  assert.deepEqual(calls, ['json_schema', 'json_object']);
});
