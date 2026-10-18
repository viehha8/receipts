// Parses the argument of /receipts: "", "30m", "2h", "3d", "today", "all".

function tzOffsetMs(ts, tz) {
  const d = new Date(ts);
  const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return local - utc;
}

export function startOfToday(now, tz) {
  const off = tzOffsetMs(now, tz);
  const localNow = now + off;
  return localNow - (localNow % 86_400_000) - off;
}

export function parseWindow(arg, now = Date.now(), tz = 'Asia/Singapore') {
  const a = String(arg || '').trim().toLowerCase();
  if (!a) return { from: now - 86_400_000, label: 'last 24h' };
  if (a === 'all') return { from: 0, label: 'all saved messages' };
  if (a === 'today') return { from: startOfToday(now, tz), label: 'today' };
  const m = a.match(/^(\d{1,4})\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2][0];
  const ms = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return { from: now - n * ms, label: `last ${n}${unit}` };
}
