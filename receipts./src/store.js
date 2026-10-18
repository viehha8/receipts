// Tiny JSON-file store for messages the Telegram bot saves. Good enough for a hackathon;
// swap for a real database later. On hosts with ephemeral disks (Render free) data resets on redeploy.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'store.json');
const MAX_PER_CHAT = 3000;

let db = { chats: {} };
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  db = { chats: {} };
}

// Privacy: saved Telegram messages are deleted automatically after RETENTION_DAYS (default 7).
export const RETENTION_DAYS = () => Math.max(1, Number(process.env.RETENTION_DAYS || 7));
export function purgeOld(now = Date.now()) {
  const cutoff = now - RETENTION_DAYS() * 86_400_000;
  let removed = 0;
  for (const c of Object.values(db.chats)) {
    const before = c.messages.length;
    c.messages = c.messages.filter((m) => m.ts >= cutoff);
    removed += before - c.messages.length;
  }
  if (removed) save();
  return removed;
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(db));
      fs.renameSync(FILE + '.tmp', FILE);
    } catch (e) {
      console.error('Could not save store:', e.message);
    }
  }, 250);
}

export function getChat(chatId, title, username) {
  const id = String(chatId);
  let c = db.chats[id];
  if (!c) {
    c = db.chats[id] = { id, title: title || '', username: username || null, key: crypto.randomBytes(12).toString('hex'), paused: false, messages: [] };
    save();
  } else if ((title && c.title !== title) || (username !== undefined && c.username !== (username || null))) {
    if (title) c.title = title;
    if (username !== undefined) c.username = username || null;
    save();
  }
  return c;
}

export function findChat(chatId, key) {
  const c = db.chats[String(chatId)];
  if (!c || typeof key !== 'string') return null;
  const a = Buffer.from(c.key);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? c : null;
}

setTimeout(() => purgeOld(), 0);
setInterval(() => purgeOld(), 3_600_000).unref();

export function addMessage(chatId, msg) {
  const c = getChat(chatId);
  c.messages.push(msg);
  if (c.messages.length > MAX_PER_CHAT) c.messages.splice(0, c.messages.length - MAX_PER_CHAT);
  save();
}

export function editMessage(chatId, tgMessageId, text) {
  const c = db.chats[String(chatId)];
  const m = c?.messages.find((x) => x.tgMessageId === tgMessageId);
  if (m) {
    m.text = text;
    m.edited = true;
    save();
  }
}

export function setPaused(chatId, paused) {
  getChat(chatId).paused = paused;
  save();
}

export function forgetChat(chatId) {
  const c = getChat(chatId);
  const n = c.messages.length;
  c.messages = [];
  c.key = crypto.randomBytes(12).toString('hex'); // old dashboard links stop working
  save();
  return n;
}

export function forgetUser(chatId, userId) {
  const c = getChat(chatId);
  const before = c.messages.length;
  c.messages = c.messages.filter((m) => m.userId !== userId);
  save();
  return before - c.messages.length;
}

/** Messages in the shape the analyser and dashboard expect. Never exposes user ids. */
export function publicMessages(chat) {
  return chat.messages.map((m) => ({
    id: `t${m.tgMessageId}`,
    sender: m.sender,
    text: m.text,
    ts: m.ts,
    tgMessageId: m.tgMessageId,
    edited: !!m.edited,
  }));
}