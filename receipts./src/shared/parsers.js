// Chat parsers. This file runs in BOTH the browser (dashboard) and Node (tests, eval),
// so it must not import anything. Times are parsed in the viewer's local time zone.
//
// Output message shape: { id: 'm1', sender: 'Ben', text: '...', ts: 1729000000000, tgMessageId?: 123 }

const INVISIBLE = /[‎‏﻿⁦-⁩]/g;
const SKIP_TEXT = /^(<media omitted>|<attached:.*>|image omitted|video omitted|audio omitted|sticker omitted|gif omitted|document omitted|this message was deleted|you deleted this message|null)$/i;

// 14/10/2026, 21:02 - Ben: hello      (Android)
const WA_ANDROID = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?[\s ]*([AaPp]\.?\s?[Mm]\.?)?\s+-\s+(.*)$/;
// [14/10/26, 9:02:15 PM] Ben: hello    (iOS)
const WA_IOS = /^\[(\d{1,2})[/.](\d{1,2})[/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?[\s ]*([AaPp]\.?\s?[Mm]\.?)?\]\s+(.*)$/;
// [2026-10-17 10:00] Ben: hello   |   [10:00] Ben: hello   |   Ben: hello
const SIMPLE = /^\s*(?:\[([^\]]{1,40})\]\s*)?([^:[\]\n]{1,40}?):\s+(.+)$/;

export function parseChat(rawText, filename = '') {
  const text = String(rawText ?? '').replace(/\r\n?/g, '\n');
  const trimmed = text.trim();
  if (!trimmed) throw new Error('The chat is empty.');

  if (trimmed.startsWith('{') || /\.json$/i.test(filename)) {
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new Error('That JSON file could not be read. In Telegram Desktop use: ⋮ → Export chat history → Format: JSON.');
    }
    return finish('telegram-json', parseTelegramJson(data));
  }

  const lines = text.split('\n');
  const nonEmpty = lines.filter((l) => l.trim()).length;
  const waHits = lines.filter((l) => WA_ANDROID.test(clean(l)) || WA_IOS.test(clean(l))).length;
  if (waHits >= 1 && waHits / nonEmpty >= 0.3) return finish('whatsapp', parseWhatsApp(lines));

  const simple = parseSimple(lines);
  if (!simple.length) {
    throw new Error('No messages found. Each message should look like "Name: message" or come from a WhatsApp/Telegram export.');
  }
  return finish('plain', simple);
}

function clean(line) {
  return line.replace(INVISIBLE, '').trimEnd();
}

function finish(format, messages) {
  const kept = messages.filter((m) => m.text && m.text.trim() && !SKIP_TEXT.test(m.text.trim()));
  kept.sort((a, b) => a.ts - b.ts); // stable sort keeps original order for equal times
  return {
    format,
    skipped: messages.length - kept.length,
    messages: kept.map((m, i) => ({ id: `m${i + 1}`, ...m, text: m.text.trim() })),
  };
}

function toDate(a, b, y, h, mi, s, ampm) {
  let day = +a;
  let month = +b;
  if (month > 12 && day <= 12) [day, month] = [month, day]; // US-style export
  let year = +y;
  if (year < 100) year += 2000;
  let hour = +h;
  if (ampm) {
    const pm = /p/i.test(ampm);
    if (pm && hour < 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  return new Date(year, month - 1, day, hour, +mi, +(s || 0)).getTime();
}

export function parseWhatsApp(lines) {
  const out = [];
  let current = null;
  for (const raw of lines) {
    const line = clean(raw);
    const m = line.match(WA_ANDROID) || line.match(WA_IOS);
    if (m) {
      const [, a, b, y, h, mi, s, ampm, rest] = m;
      const idx = rest.indexOf(': ');
      if (idx > 0 && idx <= 60) {
        current = { sender: rest.slice(0, idx).trim(), text: rest.slice(idx + 2), ts: toDate(a, b, y, h, mi, s, ampm) };
        out.push(current);
      } else {
        current = null; // system line, e.g. "Ben joined using this group's invite link"
      }
    } else if (current && line.trim()) {
      current.text += '\n' + line;
    }
  }
  return out;
}

export function parseTelegramJson(data) {
  const list = Array.isArray(data?.messages) ? data.messages : null;
  if (!list) throw new Error('This JSON has no "messages" list. Export a single chat from Telegram Desktop as JSON.');
  return list
    .filter((m) => m && m.type === 'message')
    .map((m) => {
      const t = Array.isArray(m.text)
        ? m.text.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('')
        : String(m.text ?? '');
      const ts = m.date_unixtime ? Number(m.date_unixtime) * 1000 : new Date(m.date).getTime();
      return { sender: m.from || 'Deleted account', text: t, ts, tgMessageId: m.id };
    })
    .filter((m) => Number.isFinite(m.ts));
}

function parseBracketTime(s, fallbackDay) {
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  m = s.match(/(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i);
  if (m) {
    let h = +m[1];
    if (m[3] && /p/i.test(m[3]) && h < 12) h += 12;
    if (m[3] && /a/i.test(m[3]) && h === 12) h = 0;
    const d = new Date(fallbackDay);
    d.setHours(h, +m[2], 0, 0);
    return d.getTime();
  }
  return null;
}

export function parseSimple(lines) {
  const out = [];
  let current = null;
  const today = Date.now();
  for (const raw of lines) {
    const line = clean(raw);
    if (!line.trim()) continue;
    const m = line.match(SIMPLE);
    if (m) {
      current = { sender: m[2].trim(), text: m[3], ts: parseBracketTime(m[1], today) };
      out.push(current);
    } else if (current) {
      current.text += '\n' + line.trim();
    }
  }
  // Fill in missing times so the time-window picker still works: one minute apart, ending now.
  const n = out.length;
  out.forEach((msg, i) => {
    if (msg.ts == null) {
      const prev = i > 0 ? out[i - 1].ts : null;
      msg.ts = prev != null ? prev + 60_000 : today - (n - i) * 60_000;
    }
  });
  return out;
}
