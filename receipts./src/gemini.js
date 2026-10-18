import fs from 'node:fs';

// Supports Google Gemini (GEMINI_API_KEY) or OpenAI (OPENAI_API_KEY).
// If both are set, Gemini is used. Set AI_PROVIDER=openai to force OpenAI.

export function provider() {
  const forced = (process.env.AI_PROVIDER || '').toLowerCase();
  if (forced === 'openai' || forced === 'gemini') return forced;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

export const MODEL = () =>
  provider() === 'openai'
    ? process.env.OPENAI_MODEL || 'gpt-4.1-mini'
    : process.env.GEMINI_MODEL || 'gemini-flash-latest';

export const aiReady = () => !!(provider() || process.env.GEMINI_MOCK_FILE);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gemini schema (uppercase types, nullable) -> plain JSON Schema, for telling OpenAI the shape.
function toJsonSchema(s) {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'type') out.type = String(v).toLowerCase();
    else if (k === 'nullable') continue;
    else out[k] = toJsonSchema(v);
  }
  if (s.nullable && out.type) out.type = [out.type, 'null'];
  return out;
}

async function postWithRetry(url, headers, body, timeoutMs, label) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (attempt < 2) continue;
      throw new Error(`Could not reach ${label} (${err.name === 'TimeoutError' ? 'timed out' : err.message}).`);
    }
    const data = await res.json().catch(() => ({}));
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1500 * attempt);
      continue;
    }
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText;
      if (res.status === 404) {
        const envName = label === 'OpenAI' ? 'OPENAI_MODEL' : 'GEMINI_MODEL';
        throw new Error(`${label} model "${MODEL()}" was not found. Set ${envName} in .env to a model your account has. Details: ${msg}`);
      }
      if (res.status === 401 || res.status === 403) {
        const tip = label === 'OpenAI' ? ' If your key is not from platform.openai.com, set OPENAI_BASE_URL in .env to your provider\'s address.' : '';
        throw new Error(`${label} rejected the API key (${res.status}).${tip} Details: ${msg}`);
      }
      throw new Error(`${label} API error ${res.status}: ${msg}`);
    }
    return data;
  }
}

async function callOpenAI({ system, user, schema, timeoutMs }) {
  const sys = schema
    ? `${system}\n\nRespond with a single JSON object only, matching this JSON Schema:\n${JSON.stringify(toJsonSchema(schema))}`
    : system;
  const body = {
    model: MODEL(),
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: user },
    ],
  };
  if (schema && process.env.OPENAI_JSON_MODE !== 'off') body.response_format = { type: 'json_object' };
  // OPENAI_BASE_URL lets you use any OpenAI-compatible provider (Tencent Hunyuan, DeepSeek, OpenRouter, a proxy...).
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}` };
  let data;
  try {
    data = await postWithRetry(`${base}/chat/completions`, headers, body, timeoutMs, 'OpenAI');
  } catch (e) {
    // Some compatible providers don't support JSON mode: retry once without it.
    if (body.response_format && /response_format|json_object|400/i.test(e.message)) {
      delete body.response_format;
      data = await postWithRetry(`${base}/chat/completions`, headers, body, timeoutMs, 'OpenAI');
    } else throw e;
  }
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`OpenAI returned no answer (${data?.choices?.[0]?.finish_reason || 'unknown reason'}).`);
  return text;
}

async function callGoogle({ system, user, schema, timeoutMs }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: schema ? { responseMimeType: 'application/json', responseSchema: schema } : {},
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL())}:generateContent`;
  const data = await postWithRetry(url, { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body, timeoutMs, 'Gemini');
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!text) throw new Error(`Gemini returned no answer (${cand?.finishReason || data?.promptFeedback?.blockReason || 'unknown reason'}).`);
  return text;
}

/**
 * Sends one prompt to the configured AI. Returns text (a JSON string when `schema` is given).
 * GEMINI_MOCK_FILE points to a JSON file ({ "analysis": {...}, "naive": "..." }) for UI work without an API key.
 */
export async function callGemini({ system, user, schema, timeoutMs = 90_000 }) {
  if (process.env.GEMINI_MOCK_FILE) {
    const mock = JSON.parse(fs.readFileSync(process.env.GEMINI_MOCK_FILE, 'utf8'));
    await sleep(400);
    return schema ? JSON.stringify(mock.analysis) : mock.naive;
  }
  const p = provider();
  if (!p) throw new Error('No AI key found. Add GEMINI_API_KEY or OPENAI_API_KEY to your .env file, save it, and restart.');
  return p === 'openai' ? callOpenAI({ system, user, schema, timeoutMs }) : callGoogle({ system, user, schema, timeoutMs });
}