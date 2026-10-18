import 'dotenv/config';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { analyzeChat } from './analyze.js';
import { MODEL, aiReady } from './gemini.js';
import * as store from './store.js';
import { startBot } from './bot.js';
import { redactMessages } from './safety.js';
import { saveShare, loadShare, deleteShare, storageKind } from './shares.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(ROOT, 'public'), { index: false }));

// Home page at "/", the app at "/app". Old Telegram dashboard links (/?chat=...) still work.
app.get('/', (req, res) => {
  if (req.query.chat) return res.redirect('/app' + req.url.slice(1));
  res.sendFile(path.join(ROOT, 'public', 'home.html'));
});
app.get('/app', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.use('/lib', express.static(path.join(ROOT, 'src', 'shared')));

// --- simple per-IP rate limit for the AI endpoint ---
const hits = new Map();
function rateLimit(req, res, next) {
  const limit = Number(process.env.RATE_LIMIT || 30);
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= limit) return res.status(429).json({ error: 'Too many analyses from you. Wait a few minutes and try again.' });
  recent.push(now);
  hits.set(req.ip, recent);
  next();
}

let botRunning = false;

// --- optional access code (set ACCESS_CODE in .env) ---
const ACCESS_CODE = () => (process.env.ACCESS_CODE || '').trim();
function codeOk(req) {
  const want = ACCESS_CODE();
  if (!want) return true;
  const got = String(req.get('x-access-code') || '').trim();
  const a = crypto.createHash('sha256').update(want).digest();
  const b = crypto.createHash('sha256').update(got).digest();
  return crypto.timingSafeEqual(a, b);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, model: MODEL(), aiReady: aiReady(), bot: botRunning, locked: !!ACCESS_CODE() });
});

app.post('/api/unlock', rateLimit, (req, res) => {
  if (codeOk(req)) return res.json({ ok: true });
  res.status(401).json({ error: 'That access code is wrong.' });
});

const SAMPLES_DIR = path.join(ROOT, 'samples');
app.get('/api/samples', (req, res) => {
  const files = fs.existsSync(SAMPLES_DIR) ? fs.readdirSync(SAMPLES_DIR).filter((f) => /\.(txt|json)$/.test(f)) : [];
  res.json(files.map((f) => ({ file: f, title: f.replace(/^\d+-/, '').replace(/\.(txt|json)$/, '').replace(/-/g, ' ') })));
});
app.get('/api/samples/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const full = path.join(SAMPLES_DIR, file);
  if (!/\.(txt|json)$/.test(file) || !fs.existsSync(full)) return res.status(404).json({ error: 'Sample not found' });
  res.type('text/plain').send(fs.readFileSync(full, 'utf8'));
});

app.get('/api/chats/:id', (req, res) => {
  const chat = store.findChat(req.params.id, req.query.key);
  if (!chat) return res.status(404).json({ error: 'This group link is invalid or was reset with /forget.' });
  res.json({ title: chat.title, paused: chat.paused, messages: store.publicMessages(chat) });
});

app.post('/api/analyze', rateLimit, async (req, res) => {
  try {
    const { chatId, key, from, to, timeZone, compareNaive } = req.body || {};
    let messages;
    if (chatId) {
      // A valid group link is already a secret, so it doesn't need the access code.
      const chat = store.findChat(chatId, key);
      if (!chat) return res.status(404).json({ error: 'This group link is invalid or was reset.' });
      messages = store.publicMessages(chat);
    } else {
      if (!codeOk(req)) return res.status(401).json({ error: 'Enter the access code first.', needCode: true });
      messages = req.body?.messages;
      if (!Array.isArray(messages)) return res.status(400).json({ error: 'Send a list of messages.' });
      if (messages.length > 5000) return res.status(413).json({ error: 'Too many messages. Pick a shorter time window.' });
    }
    const lo = Number.isFinite(from) ? from : -Infinity;
    const hi = Number.isFinite(to) ? to : Infinity;
    messages = messages.filter((m) => m && Number(m.ts) >= lo && Number(m.ts) <= hi);
    if (messages.length < 2) return res.status(400).json({ error: 'Need at least 2 messages in the selected time window.' });

    const result = await analyzeChat(messages, { timeZone, compareNaive: !!compareNaive });
    result.shareToken = rememberForSharing(result, messages);
    res.json(result);
  } catch (e) {
    console.error('analyze failed:', e);
    res.status(500).json({ error: e.message || 'Analysis failed.' });
  }
});

// --- sharing ---
// Only results this server produced can be shared (the browser gets a one-time token), so nobody can forge receipts.
const pending = new Map();
function rememberForSharing(result, messages) {
  const token = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > 3_600_000) pending.delete(k);
  if (pending.size > 300) pending.delete(pending.keys().next().value);
  const ids = new Set();
  const clean = redactMessages(
    messages.map((m, i) => {
      let id = typeof m.id === 'string' && m.id ? m.id : `m${i + 1}`;
      ids.add(id);
      return { id, sender: String(m.sender || 'Unknown').slice(0, 60), text: String(m.text || '').slice(0, 4000), ts: Number(m.ts) };
    }),
  ).messages;
  const { shareToken, naive, ...stored } = result;
  pending.set(token, { at: now, result: stored, naive, messages: clean });
  return token;
}

app.post('/api/share', rateLimit, async (req, res) => {
  try {
    const { token, title, includeNaive, corrections } = req.body || {};
    const item = pending.get(String(token || ''));
    if (!item) return res.status(410).json({ error: 'This result is too old to share. Run the analysis again, then share.' });
    // Apply the user's own corrections ("This is wrong"), clearly marked as human edits.
    const result = structuredClone(item.result);
    for (const c of Array.isArray(corrections) ? corrections.slice(0, 100) : []) {
      const d = result.decisions?.[Number(c?.i)];
      if (d && ['confirmed', 'unconfirmed', 'disputed', 'cancelled'].includes(c.status) && c.status !== d.status) {
        d.corrected_from = d.status;
        d.status = c.status;
      }
    }
    const saved = await saveShare({
      title: String(title || '').trim().slice(0, 80) || 'Group chat receipts',
      result: includeNaive ? { ...result, naive: item.naive } : result,
      messages: item.messages,
    });
    res.json({ ...saved, url: `/r/${saved.id}`, storage: storageKind() });
  } catch (e) {
    console.error('share failed:', e);
    res.status(500).json({ error: e.message || 'Could not create a share link.' });
  }
});

app.get('/api/share/:id', async (req, res) => {
  try {
    const share = await loadShare(req.params.id);
    if (!share) return res.status(404).json({ error: 'This link has expired or was deleted.' });
    res.json(share);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/share/:id', async (req, res) => {
  try {
    const ok = await deleteShare(req.params.id, String(req.get('x-delete-key') || ''));
    if (!ok) return res.status(403).json({ error: 'Only the person who created this link can delete it.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// "This is wrong" feedback: labels only, no chat text. Used to measure how often people disagree with the AI.
app.post('/api/feedback', rateLimit, (req, res) => {
  const ok = ['confirmed', 'unconfirmed', 'disputed', 'cancelled'];
  const { type, ai_status, user_status } = req.body || {};
  if (!ok.includes(ai_status) || !ok.includes(user_status)) return res.status(400).json({ error: 'Bad feedback' });
  try {
    const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'feedback.jsonl'), JSON.stringify({ at: new Date().toISOString(), type: String(type || '').slice(0, 20), ai_status, user_status }) + '\n');
  } catch {}
  res.json({ ok: true });
});

app.get('/r/:id', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

startBot(app)
  .then((bot) => {
    botRunning = !!bot;
  })
  .catch((e) => console.error('⚠️  Telegram bot did not start:', e.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`🧾 Receipts dashboard: http://localhost:${PORT}`);
      if (!aiReady()) console.warn('⚠️  No AI key found. Add OPENAI_API_KEY or GEMINI_API_KEY to .env, save, and restart.');
      else console.log(`🤖 AI model: ${MODEL()}`);
      console.log(ACCESS_CODE() ? '🔒 Access code is ON' : '🔓 No access code set (anyone with the link can analyse)');
      console.log(storageKind() === 'mongodb' ? '🔗 Share links saved in MongoDB' : '🔗 Share links saved in the data folder');
    });
  });