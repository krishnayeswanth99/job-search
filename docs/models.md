# AI models in Job Copilot

Job Copilot uses a language model for four jobs:

| Task | What it does | When |
|---|---|---|
| **Field check** | Says which profile field fits each filled box ("Middle Name" is not your full name) | After every autofill |
| **Answer check** | Says ok / wrong / unsure for each answer that wasn't copied straight from your profile | After every autofill |
| **Answers** | Drafts answers to questions left open, from your profile and resume only | After every autofill |
| **Tailoring** | Writes a tailored resume (summary, bullets per job, skills) and a cover letter for one job | When you click **Tailor resume & cover letter** |

Pick the model in **Options → AI model**. **Test the model** sends a one-line prompt and shows the reply.

## Which model to pick

| Model | Cost | Privacy | Quality | Setup |
|---|---|---|---|---|
| **Chrome's on-device AI (Gemini Nano)** (default) | free | never leaves your computer | fine for checks and short answers, weak for tailoring | none (Chrome downloads it once) |
| **Ollama / LM Studio** on your computer | free | never leaves your computer | good with a 7-8B instruct model | install + one setting (below) |
| **Google Gemini API, Groq, OpenRouter** | free tiers available | sent to that service | good to excellent | API key |
| **OpenAI and other paid APIs** | per use | sent to that service | good to excellent | API key |
| **Claude** (Anthropic API) | per use | sent to Anthropic | excellent, especially for tailoring | API key |

Never sent to any model: diversity answers (gender, race, veteran, disability, orientation), signatures, passwords.
Sent: your profile (name, contact, links, work history and details, schools, skills, languages, saved answers), the
resume lines relevant to the questions, and the job description.

## Small laptops (8 GB, e.g. MacBook Air M2 8 GB)

Memory is shared by macOS, Chrome and the model, so:

- **Gemini Nano** may not be offered on 8 GB machines. Check `chrome://on-device-internals`: it shows whether the model
  is ready, downloading or not supported on this device.
- **Ollama:** use a ~3B model; 7-8B models need ~5 GB and make an 8 GB Mac swap while Chrome is open.

  | Model | Memory | Good for |
  |---|---|---|
  | `qwen2.5:3b-instruct` (preset "Ollama, small model") | ~2 GB | yes/no and short answers, checks |
  | `llama3.2:3b` | ~2 GB | similar |
  | `phi3.5` | ~2.3 GB | a bit better reasoning, slower |

  Fine for answering and checking; tailored resumes and cover letters are noticeably better with a cloud model.
- **Cloud with no load on your Mac:** the *Google Gemini API* preset (free tier, key from aistudio.google.com), Groq
  (free tier), OpenRouter models ending in `:free`, or Claude Haiku (cents per day). These receive your profile, the
  relevant resume lines and the job description.
- A good split: a small local model day to day, and switch to a cloud model when you click **Tailor resume & cover
  letter**.

## Chrome's on-device AI (Gemini Nano)

Needs a recent Chrome on a computer that supports it (enough memory or a GPU). The first time, click **Answer with
on-device AI** in the Job Copilot popup: Chrome downloads the model once (a few GB). Until then the debug log says
"on-device model not downloaded yet".

## Ollama (free, on your computer)

1. Install from ollama.com, then pull a model that follows instructions and writes JSON well:
   ```bash
   ollama pull qwen2.5:7b-instruct
   ```
   (`llama3.1:8b-instruct` and `mistral-nemo` also work. Bigger is better for tailoring if your computer can run it.)
2. Let the extension talk to it. Ollama only accepts requests from websites and extensions you allow:
   ```bash
   OLLAMA_ORIGINS="chrome-extension://*" ollama serve
   ```
   On macOS with the Ollama app, run this once and restart Ollama:
   ```bash
   launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
   ```
3. In **Options → AI model**: Model = *OpenAI-compatible server*, Preset = *Ollama*, and the model name you pulled.

## LM Studio (free, on your computer)

1. Download a model (for example Qwen2.5 7B Instruct) in LM Studio.
2. **Developer** tab → **Start Server**, and turn on **CORS** in the server settings.
3. In **Options → AI model**: *OpenAI-compatible server*, Preset = *LM Studio*, and the model's identifier as LM Studio
   shows it.

## OpenRouter, Groq, OpenAI, Together…

Any service with an OpenAI-style `/v1/chat/completions` endpoint works: choose *OpenAI-compatible server*, pick a
preset or type the address (it ends in `/v1`), the model name, and your API key. Your data is sent to that service.

## Claude

Choose *Claude*. It uses the API key and model from the **Claude API** section of options (the same key as "Read my
resume with Claude"). Haiku is fast and cheap; Sonnet and Opus write better tailored drafts.

## What Job Copilot sends (for server authors)

**OpenAI-compatible:** `POST {address}/chat/completions` with

```json
{
  "model": "<model name>",
  "temperature": 0.2,
  "messages": [{ "role": "system", "content": "…" }, { "role": "user", "content": "<task prompt>" }],
  "response_format": { "type": "json_schema", "json_schema": { "name": "reply", "schema": { "…": "…" }, "strict": false } }
}
```

and an `Authorization: Bearer <key>` header when a key is set. If the server answers with an error, the same request
is retried with `"response_format": { "type": "json_object" }`, then without `response_format` (the prompt already asks
for JSON). The reply text is read from `choices[0].message.content`; it must contain one JSON object.

**Claude:** `POST https://api.anthropic.com/v1/messages` with `output_config.format` set to the task's JSON schema
(retried without it on an error), read from the `text` content blocks.

## Adding another kind of model (for developers)

The tasks live in `extension/src/shared/ai-tasks.js`. Each one builds its prompt and calls

```js
complete(prompt, schema) // -> Promise<string>: the model's reply, containing one JSON object
```

`schema` is a JSON Schema for the reply, or `null` for free text. So a new model only has to provide `complete`:

- **An HTTP API** with a different format: add a provider to `PROVIDERS` in `extension/src/shared/llm.js`, build its
  request in `buildRequest(cfg, prompt, schema, attempt)` and read its reply in `readResponse(cfg, json)`, then add a
  case to `tests/unit/llm.test.mjs`. The options page lists providers from `PROVIDERS` automatically.
- **A model that runs inside Chrome** (another Prompt-API model, WebLLM / WebGPU…): copy `extension/offscreen/nano.js`,
  replace `nanoComplete` with your engine, and route your provider id to it in `runAI` in
  `extension/src/background.js`.

Keep the guardrails: the tasks already limit choices to real options and drop tailored bullets whose numbers aren't in
your data; a provider should never post-process replies in a way that adds facts.
