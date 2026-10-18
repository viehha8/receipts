import { parseChat } from '/lib/parsers.js';
import { icon, hydrateIcons } from '/icons.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const SHARE_ID = (location.pathname.match(/^\/r\/([A-Za-z0-9_-]{8,24})\/?$/) || [])[1] || null;
const longDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const state = {
  messages: [],
  format: '',
  group: null, // { chatId, key, title }
  from: null,
  to: null,
  result: null,
};

const STATUS = {
  confirmed: { label: 'Confirmed', icon: 'check', meaning: 'Someone said it and another person clearly agreed.' },
  unconfirmed: { label: 'Not confirmed yet', icon: 'clock', meaning: 'Suggested or offered, but nobody else said yes.' },
  disputed: { label: 'Disputed', icon: 'bolt', meaning: 'People disagreed and it was never settled.' },
  cancelled: { label: 'Cancelled', icon: 'cancel', meaning: 'It was agreed, then called off or replaced.' },
};
const TYPE_LABEL = { task: 'Task', deadline: 'Deadline', meeting: 'Meeting', location: 'Place', purchase: 'Purchase', money_split: 'Money', other: 'Plan' };
const TYPE_ICON = { task: 'task', deadline: 'clock', meeting: 'calendar', location: 'pin', purchase: 'bag', money_split: 'coin', other: 'note' };
const ROLE_LABEL = { proposal: 'suggested', commitment: 'committed', agreement: 'agreed', objection: 'objected', change: 'changed it', info: 'context' };

const MASCOT = `
<svg class="mascot" viewBox="0 0 120 140" aria-hidden="true">
  <path d="M18 10 Q18 4 24 4 H96 Q102 4 102 10 V124 L94 132 L86 124 L78 132 L70 124 L62 132 L54 124 L46 132 L38 124 L30 132 L22 124 L18 128 Z" fill="#fff" stroke="#2c2541" stroke-width="4" stroke-linejoin="round"/>
  <circle cx="45" cy="46" r="6" fill="#2c2541"/><circle cx="75" cy="46" r="6" fill="#2c2541"/>
  <circle cx="47" cy="44" r="2" fill="#fff"/><circle cx="77" cy="44" r="2" fill="#fff"/>
  <ellipse cx="34" cy="60" rx="7" ry="4" fill="#ffc9d0"/><ellipse cx="86" cy="60" rx="7" ry="4" fill="#ffc9d0"/>
  <path d="M50 60 Q60 70 70 60" fill="none" stroke="#2c2541" stroke-width="4" stroke-linecap="round"/>
  <rect x="34" y="84" width="52" height="5" rx="2.5" fill="#efe6dc"/>
  <rect x="34" y="96" width="38" height="5" rx="2.5" fill="#efe6dc"/>
  <rect x="34" y="108" width="46" height="5" rx="2.5" fill="#efe6dc"/>
</svg>`;

// ---------- helpers ----------
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function toLocalInput(ts) {
  if (ts == null) return '';
  const d = new Date(ts);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function fromLocalInput(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}
function hue(name) {
  let x = 0;
  for (const c of name) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return x % 360;
}
const inRange = (m) => (state.from == null || m.ts >= state.from) && (state.to == null || m.ts <= state.to + 59_999);
const money = (n, cur = 'SGD') => `${cur === 'SGD' ? 'S$' : cur + ' '}${Number(n).toFixed(2)}`;

function showError(msg) {
  const box = $('#errorBox');
  box.textContent = msg || '';
  box.classList.toggle('hidden', !msg);
}

function markSteps() {
  const loaded = state.messages.length > 1;
  $('#step1').classList.toggle('done', loaded);
  $('#step2').classList.toggle('done', loaded);
  $('#step3').classList.toggle('done', !!state.result);
}

// ---------- access code ----------
let accessCode = '';
try {
  accessCode = localStorage.getItem('receipts-code') || '';
} catch {}

function saveCode(code) {
  accessCode = code;
  try {
    if (code) localStorage.setItem('receipts-code', code);
    else localStorage.removeItem('receipts-code');
  } catch {}
}

function showLock(show, message = '') {
  $('#lock').classList.toggle('hidden', !show);
  document.body.classList.toggle('locked', show);
  $('#lockError').textContent = message;
  $('#lockError').classList.toggle('hidden', !message);
  if (show) setTimeout(() => $('#lockInput').focus(), 50);
}

async function api(url, opts = {}) {
  const headers = { ...(opts.headers || {}), 'x-access-code': accessCode };
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.needCode) {
    saveCode('');
    showLock(true, 'Your access code expired or is wrong. Enter it again.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- loading chats ----------
function loadMessages(messages, format) {
  state.messages = messages;
  state.format = format;
  state.from = messages[0]?.ts ?? null;
  state.to = messages[messages.length - 1]?.ts ?? null;
  state.result = null;
  $$('#rangeChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.range === 'all'));
  syncRangeInputs();
  renderTimeline();
  renderEmptyResults();
  showError('');
  markSteps();
}

function loadText(text, filename = '') {
  try {
    const parsed = parseChat(text, filename);
    state.group = null;
    loadMessages(parsed.messages, parsed.format);
  } catch (e) {
    showError(e.message);
  }
}

async function loadGroup() {
  const { chatId, key } = state.group;
  try {
    const data = await api(`/api/chats/${encodeURIComponent(chatId)}?key=${encodeURIComponent(key)}`);
    state.group.title = data.title;
    $('#groupInfo').innerHTML = `Telegram group <b>${esc(data.title || chatId)}</b>: ${data.messages.length} saved messages${data.paused ? ' (saving is paused)' : ''}.`;
    const group = state.group;
    loadMessages(data.messages, 'telegram-bot');
    state.group = group;
  } catch (e) {
    $('#groupInfo').textContent = e.message;
    showError(e.message);
  }
}

// ---------- time window ----------
function syncRangeInputs() {
  $('#fromInput').value = toLocalInput(state.from);
  $('#toInput').value = toLocalInput(state.to);
  const n = state.messages.filter(inRange).length;
  $('#rangeInfo').innerHTML = state.messages.length
    ? `<b>${n}</b> of ${state.messages.length} messages will be checked`
    : 'No chat loaded yet.';
  $('#analyzeBtn').disabled = n < 2;
  $$('.msg').forEach((el) => {
    const m = state.messages.find((x) => x.id === el.dataset.id);
    el.classList.toggle('out', m ? !inRange(m) : false);
  });
}

function applyChip(range) {
  if (!state.messages.length) return;
  const last = state.messages[state.messages.length - 1].ts;
  const spans = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 };
  state.from = range === 'all' ? state.messages[0].ts : last - spans[range];
  state.to = last;
  $$('#rangeChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.range === range));
  syncRangeInputs();
}

// ---------- chat timeline ----------
function renderTimeline() {
  const el = $('#timeline');
  if (!state.messages.length) {
    el.innerHTML = `<div class="chat-empty"><span class="chat-empty-ic">${icon('chat')}</span>Your chat will show up here once you load one.</div>`;
    $('#timelineCount').textContent = '';
    return;
  }
  const flagged = new Map((state.result?.safety.injections || []).map((f) => [f.id, f]));
  let lastDay = '';
  const parts = [];
  for (const m of state.messages) {
    const day = dayFmt.format(m.ts);
    if (day !== lastDay) {
      parts.push(`<div class="day"><span>${esc(day)}</span></div>`);
      lastDay = day;
    }
    const f = flagged.get(m.id);
    parts.push(`
      <div class="msg${f ? ' flagged' : ''}${inRange(m) ? '' : ' out'}" id="msg-${esc(m.id)}" data-id="${esc(m.id)}">
        <div class="meta">
          <span class="sender" style="--h:${hue(m.sender)}">${esc(m.sender)}</span>
          <span class="time">${esc(timeFmt.format(m.ts))}</span>
          ${m.edited ? '<span class="tag">edited</span>' : ''}
          <span class="mid">${esc(m.id)}</span>
        </div>
        <div class="text">${esc(m.text)}</div>
        ${f ? `<div class="flag-note">${icon('shield')} Tried to instruct the AI. Ignored.</div>` : ''}
        <div class="msg-actions">
          <button data-act="start" title="Start the time window here">⇤ start here</button>
          <button data-act="end" title="End the time window here">end here ⇥</button>
        </div>
      </div>`);
  }
  el.innerHTML = parts.join('');
  $('#timelineCount').textContent = `${state.messages.length} messages`;
}

function highlight(ids, scroll = true) {
  $$('.msg.hl').forEach((e) => e.classList.remove('hl'));
  const els = ids.map((id) => document.getElementById(`msg-${id}`)).filter(Boolean);
  els.forEach((e) => e.classList.add('hl'));
  if (scroll && els[0]) {
    const box = $('#timeline');
    if (box.scrollHeight > box.clientHeight + 4 && getComputedStyle(box).overflowY !== 'visible') {
      box.scrollTo({ top: els[0].offsetTop - box.clientHeight / 3, behavior: 'smooth' });
    }
    if (window.innerWidth < 1100) els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ---------- results ----------
function legend() {
  return `<div class="legend">${Object.entries(STATUS)
    .map(([k, s]) => `<div class="legend-item s-${k}"><b>${icon(s.icon)} ${s.label}</b><span>${s.meaning}</span></div>`)
    .join('')}</div>`;
}

function renderEmptyResults() {
  const loaded = state.messages.length > 1;
  $('#results').innerHTML = `
    <div class="empty">
      ${MASCOT}
      <h2>${loaded ? `${state.messages.length} messages loaded!` : 'Your receipts will print here'}</h2>
      <p>${
        loaded
          ? 'Now press <b>Find the receipts</b> in step 3. Every plan in the chat gets sorted into one of these:'
          : 'Load a chat in step 1. Receipts reads it and sorts every plan into one of these four piles:'
      }</p>
      ${legend()}
    </div>`;
}

function renderLoading() {
  $('#results').innerHTML = `
    <div class="loading">
      <div class="printer"><div class="slot"></div><div class="paper-roll"><span></span><span></span><span></span><span></span></div></div>
      <p>Printing your receipts…</p>
      <p class="sub">Reading every message to see who really agreed to what.</p>
    </div>`;
}

function moneyBlock(d) {
  const c = d.money_calc;
  if (!c) return '';
  const preview = d.status !== 'confirmed' ? '<p class="money-note">Not agreed yet, so this is only a preview.</p>' : '';
  if (c.status === 'incomplete') {
    return `<div class="money incomplete"><div class="money-title">${icon('coin')} Can’t work this out yet</div><p>${esc(c.reason)}</p>${c.warnings.map((w) => `<p class="warn-text">${esc(w)}</p>`).join('')}</div>`;
  }
  const rows = (c.balances.length ? c.balances : c.shares.map((s) => ({ name: s.name, paid: null, share: s.amount, net: null })))
    .map(
      (b) => `<tr><td>${esc(b.name)}</td><td>${b.paid == null ? '–' : money(b.paid, c.currency)}</td><td>${money(b.share, c.currency)}</td>
      <td class="${b.net > 0 ? 'pos' : b.net < 0 ? 'neg' : ''}">${b.net == null ? '–' : (b.net > 0 ? '+' : b.net < 0 ? '−' : '') + money(Math.abs(b.net), c.currency)}</td></tr>`,
    )
    .join('');
  const settle = c.settlements.length
    ? `<ul class="settle">${c.settlements.map((s) => `<li>${icon('arrow')} <b>${esc(s.from)}</b> pays <b>${esc(s.to)}</b> <span class="mono">${money(s.amount, c.currency)}</span></li>`).join('')}</ul>`
    : '';
  return `
    <div class="money">
      <div class="money-title">${icon('coin')} Total ${money(c.total, c.currency)}</div>
      ${preview}
      <table><thead><tr><th>Who</th><th>Paid</th><th>Share</th><th>Balance</th></tr></thead><tbody>${rows}</tbody></table>
      ${settle}
      ${c.warnings.map((w) => `<p class="warn-text">${esc(w)}</p>`).join('')}
      <p class="calc-note">Worked out by code, not by the AI.</p>
    </div>`;
}

function card(d, i) {
  const s = STATUS[d.status];
  const ev = d.evidence
    .map(
      (e) => `
      <button class="ev${e.flagged ? ' ev-flag' : ''}" data-ev="${esc(e.message_id)}" title="Show this message in the chat">
        <span class="ev-who" style="--h:${hue(e.sender)}">${esc(e.sender)}</span>
        <span class="ev-role">${esc(ROLE_LABEL[e.role] || e.role)}</span>
        <span class="ev-quote">“${esc(e.quote)}”</span>
        ${e.quote_verified ? '' : '<span class="ev-id">quote corrected to match the real message</span>'}
      </button>`,
    )
    .join('');
  const facts = [d.owner && `${icon('user')} ${esc(d.owner)}`, d.due && `${icon('calendar')} ${esc(d.due)}`].filter(Boolean);
  return `
    <article class="receipt s-${d.status}" data-idx="${i}" tabindex="0">
      <header>
        <span class="type">${icon(TYPE_ICON[d.type] || 'note')} ${esc(TYPE_LABEL[d.type] || TYPE_LABEL.other)}</span>
        <span class="stamp">${icon(s.icon)} ${esc(s.label)}</span>
      </header>
      <h3>${esc(d.topic)}</h3>
      <p class="summary">${esc(d.summary)}</p>
      ${facts.length ? `<div class="facts">${facts.map((f) => `<span class="fact">${f}</span>`).join('')}</div>` : ''}
      ${moneyBlock(d)}
      <div class="evidence">
        <div class="section-label">Proof · ${d.evidence.length} message${d.evidence.length === 1 ? '' : 's'}</div>
        ${ev || '<p class="hint">No message backs this up.</p>'}
      </div>
      ${d.reasoning ? `<p class="why"><b>Why:</b> ${esc(d.reasoning)}</p>` : ''}
      ${d.corrected_from ? `<p class="corrected">${icon('pencil')} You changed this from “${esc(STATUS[d.corrected_from].label)}”. <button class="link" data-undo="${i}">Undo</button></p>` : ''}
      ${d.guardrail_note ? `<p class="guard">${icon('shield')} The AI said “${esc(d.ai_status)}”, but Receipts double-checked and changed it. ${esc(d.guardrail_note)}</p>` : ''}
      ${
        d.follow_up
          ? `<div class="follow"><div class="section-label">Send this to settle it</div><p>${esc(d.follow_up)}</p><div class="follow-row"><button class="btn small copy" data-copy="${i}">Copy</button></div></div>`
          : ''
      }
      ${
        SHARE_ID || d.corrected_from
          ? ''
          : `<div class="fix"><button class="link tip-btn" data-fix="${i}" aria-describedby="tip-${i}">${icon('thumbdown')} This is wrong<span class="tooltip" role="tooltip" id="tip-${i}">Think the AI got this one wrong? Pick the right status and the card updates. Your fix is marked as yours, so the group knows a person changed it. Only the label is recorded, never your messages.</span></button>
             <div class="fix-options hidden" id="fix-${i}"><span>It should be:</span>${Object.entries(STATUS)
               .filter(([k]) => k !== d.status)
               .map(([k, v]) => `<button class="chip" data-set="${i}:${k}">${icon(v.icon)} ${v.label}</button>`)
               .join('')}</div></div>`
      }
    </article>`;
}

function safetyPanel(r) {
  const s = r.safety;
  const red = s.redactions.reduce((a, x) => a + x.count, 0);
  const items = [
    {
      ok: !s.injections.length,
      title: s.injections.length ? `Caught ${s.injections.length} message${s.injections.length > 1 ? 's' : ''} trying to trick the AI` : 'No one tried to trick the AI',
      body: s.injections.length
        ? s.injections.map((f) => `<button class="link" data-ev="${esc(f.id)}">${esc(f.sender)}</button>: ${esc(f.reasons[0])}`).join('<br>') + '<br>These were ignored and can never count as agreement.'
        : 'Every message was checked before the AI read it.',
    },
    {
      ok: true,
      title: red ? `Hid ${red} personal detail${red > 1 ? 's' : ''} from the AI` : 'No personal details to hide',
      body: red ? s.redactions.map((x) => `${x.count} × ${esc(x.label)}`).join(', ') : 'Phone numbers, emails, card numbers and NRICs are hidden automatically.',
    },
    {
      ok: !s.downgraded.length,
      title: s.downgraded.length ? `Corrected ${s.downgraded.length} AI claim${s.downgraded.length > 1 ? 's' : ''}` : 'Every “confirmed” passed the check',
      body: s.downgraded.length
        ? s.downgraded.map((d) => `<b>${esc(d.topic)}</b>: ${esc(d.reason)}`).join('<br>')
        : 'Confirmed means two different people are on record agreeing.',
    },
    {
      ok: !s.droppedEvidence && !s.unverifiedQuotes,
      title: s.droppedEvidence || s.unverifiedQuotes ? 'Fixed some AI quotes' : 'Every quote matches the chat',
      body:
        s.droppedEvidence || s.unverifiedQuotes
          ? `Removed ${s.droppedEvidence} made-up citation(s) and replaced ${s.unverifiedQuotes} quote(s) with the real message text.`
          : 'Each quote was matched word for word against the real message.',
    },
  ];
  if (s.canaryLeaked) items.unshift({ ok: false, title: 'The AI may have been manipulated', body: 'Treat this result with caution.' });
  const issues = items.filter((x) => !x.ok).length;
  return `
    <details class="safety">
      <summary><span class="safety-head">${icon('shield')} Safety check <span class="badge ${issues ? 'warn' : 'ok'}">${issues ? `${issues} thing${issues > 1 ? 's' : ''} caught` : 'All clear'}</span></span><span class="more">Show details</span></summary>
      <div class="safety-grid">
        ${items.map((x) => `<div class="safety-item ${x.ok ? 'ok' : 'warn'}"><div class="safety-title">${x.title}</div><div class="safety-body">${x.body}</div></div>`).join('')}
      </div>
      ${s.warnings.map((w) => `<p class="warn-text" style="padding:0 16px 12px">${esc(w)}</p>`).join('')}
    </details>`;
}

function naivePanel(r) {
  if (!r.naive) return '';
  return `
    <section class="naive">
      <h3>What a plain AI summary says</h3>
      <p class="hint">Same chat, same AI, but without Receipts’ checks. Spot the plans it claims were agreed when they weren’t.</p>
      ${r.naive.error ? `<p class="warn-text">${esc(r.naive.error)}</p>` : `<pre>${esc(r.naive.text)}</pre>`}
    </section>`;
}

function sendFeedback(d) {
  // Only the topic and the two labels are sent, never chat text.
  fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: d.type, ai_status: d.corrected_from, user_status: d.status }),
  }).catch(() => {});
}

function shareBox() {
  return `
    <div class="sharebox" id="sharebox">
      <div class="share-text">
        <b>${icon('link')} Share with your group</b>
        <p class="hint">Makes a link your friends can open. Personal details stay hidden. The link expires in 30 days.</p>
      </div>
      <div class="share-row">
        <input id="shareTitle" maxlength="80" placeholder="Name it, e.g. IS216 project group" />
        <button class="btn share-btn" id="shareBtn">Create link</button>
      </div>
    </div>`;
}

async function createShare(btn) {
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const s = await api('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: state.result.shareToken,
        title: $('#shareTitle').value,
        includeNaive: $('#compareNaive').checked,
        corrections: state.result.decisions.map((d, i) => (d.corrected_from ? { i, status: d.status } : null)).filter(Boolean),
      }),
    });
    const url = new URL(s.url, location.origin).href;
    const local = /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname);
    $('#sharebox').innerHTML = `
      <div class="share-text">
        <b>${icon('check')} Link ready</b>
        <p class="hint">Anyone with this link can see these receipts and the chat (personal details hidden). Expires ${esc(longDate.format(new Date(s.expiresAt)))}.</p>
        ${local ? '<p class="warn-text">This is a localhost link, so it only opens on this computer. Share links from your deployed site instead.</p>' : ''}
      </div>
      <div class="share-row">
        <input id="shareUrl" value="${esc(url)}" readonly />
        <button class="btn share-btn" id="copyShare">Copy</button>
      </div>
      <div class="share-actions">
        <a class="link" href="${esc(url)}" target="_blank" rel="noopener">Open link</a>
        <button class="link" id="deleteShare" data-id="${esc(s.id)}" data-key="${esc(s.deleteKey)}">Delete this link</button>
      </div>`;
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Create link';
    showError(e.message);
    const box = $('#sharebox .hint');
    if (box) box.innerHTML = `<span class="warn-text">${esc(e.message)}</span>`;
  }
}

async function loadShared() {
  document.body.classList.add('shared');
  $('.setup').classList.add('hidden');
  $('#sharedBanner').classList.remove('hidden');
  renderLoading();
  try {
    const s = await api(`/api/share/${SHARE_ID}`);
    $('#sharedTitle').textContent = s.title;
    $('#sharedMeta').textContent = `Shared ${longDate.format(new Date(s.createdAt))} · link expires ${longDate.format(new Date(s.expiresAt))}`;
    document.title = `${s.title} · Receipts`;
    state.messages = s.messages || [];
    state.from = null;
    state.to = null;
    renderResults(s.result);
  } catch (e) {
    $('#sharedTitle').textContent = 'Shared receipts';
    $('#results').innerHTML = `<div class="empty">${MASCOT}<h2>This link doesn’t work anymore</h2><p>${esc(e.message)}</p><a class="btn primary" style="max-width:260px;margin:0 auto" href="/app">Make your own receipts</a></div>`;
  }
}

function renderResults(r) {
  state.result = r;
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, r.decisions.filter((d) => d.status === k).length]));
  const groups = [
    ['Needs a follow-up', 'not settled yet', r.decisions.filter((d) => d.status === 'unconfirmed' || d.status === 'disputed')],
    ['Confirmed', 'everyone’s on the same page', r.decisions.filter((d) => d.status === 'confirmed')],
    ['Cancelled or replaced', 'no longer happening', r.decisions.filter((d) => d.status === 'cancelled')],
  ];
  $('#results').innerHTML = `
    <div class="tally">
      ${Object.entries(counts)
        .map(([k, n]) => `<div class="tally-item s-${k}"><span class="n">${n}</span><span>${icon(STATUS[k].icon)} ${STATUS[k].label}</span></div>`)
        .join('')}
    </div>
    <p class="meta-line">Checked ${r.stats.messages} messages from ${r.stats.participants.length} people · ${esc(shortFmt.format(r.stats.from))} to ${esc(shortFmt.format(r.stats.to))}</p>
    <p class="tip">${icon('cursor')} Tap any receipt to highlight the messages that prove it in the chat.</p>
    ${!SHARE_ID && r.shareToken ? shareBox() : ''}
    ${safetyPanel(r)}
    ${r.decisions.length ? '' : '<div class="empty"><h2>No plans found</h2><p>Try a wider time window.</p></div>'}
    ${groups
      .filter(([, , list]) => list.length)
      .map(([title, sub, list], gi) => `<h3 class="group-title">${icon(['eye', 'check', 'cancel'][gi])} ${title} <small>${sub}</small></h3><div class="cards">${list.map((d) => card(d, r.decisions.indexOf(d))).join('')}</div>`)
      .join('')}
    ${naivePanel(r)}`;
  renderTimeline();
  markSteps();
}

async function analyze() {
  const selected = state.messages.filter(inRange);
  if (selected.length < 2) return showError('Pick a time window with at least 2 messages.');
  showError('');
  const btn = $('#analyzeBtn');
  btn.disabled = true;
  btn.innerHTML = `${icon('clock')} Reading the chat…`;
  renderLoading();
  if (window.innerWidth < 1100) $('#results').scrollIntoView({ behavior: 'smooth' });
  try {
    const body = {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      compareNaive: $('#compareNaive').checked,
    };
    if (state.group) Object.assign(body, { chatId: state.group.chatId, key: state.group.key, from: state.from, to: state.to == null ? null : state.to + 59_999 });
    else body.messages = selected.map(({ id, sender, text, ts }) => ({ id, sender, text, ts }));
    const r = await api('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    renderResults(r);
  } catch (e) {
    showError(e.message);
    renderEmptyResults();
  } finally {
    btn.disabled = false;
    btn.innerHTML = `${icon('receipt')} Find the receipts`;
  }
}

// ---------- events ----------
function bind() {
  $$('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
      $$('.pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== t.dataset.tab));
    }),
  );

  $('#loadPaste').addEventListener('click', () => loadText($('#pasteBox').value));

  const readFile = (file) => {
    if (!file) return;
    if (file.size > 5_000_000) return showError('That file is over 5 MB. Export a shorter chat or paste part of it.');
    const reader = new FileReader();
    reader.onload = () => loadText(String(reader.result), file.name);
    reader.readAsText(file);
  };
  $('#fileInput').addEventListener('change', (e) => readFile(e.target.files[0]));
  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    readFile(e.dataTransfer.files[0]);
  });

  $('#reloadGroup').addEventListener('click', loadGroup);

  $('#rangeChips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c) applyChip(c.dataset.range);
  });
  const customRange = (key) => (e) => {
    state[key] = fromLocalInput(e.target.value);
    $$('#rangeChips .chip').forEach((c) => c.classList.remove('active'));
    syncRangeInputs();
  };
  $('#fromInput').addEventListener('change', customRange('from'));
  $('#toInput').addEventListener('change', customRange('to'));

  $('#timeline').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const m = state.messages.find((x) => x.id === b.closest('.msg').dataset.id);
    if (b.dataset.act === 'start') state.from = m.ts;
    else state.to = m.ts;
    if (state.from != null && state.to != null && state.from > state.to) [state.from, state.to] = [state.to, state.from];
    $$('#rangeChips .chip').forEach((c) => c.classList.remove('active'));
    syncRangeInputs();
  });

  $('#analyzeBtn').addEventListener('click', analyze);

  $('#lockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#lockInput').value.trim();
    if (!code) return showLock(true, 'Type the access code first.');
    const btn = e.submitter || $('#lockForm button');
    btn.disabled = true;
    try {
      const res = await fetch('/api/unlock', { method: 'POST', headers: { 'x-access-code': code } });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return showLock(true, d.error || 'That access code is wrong.');
      }
      saveCode(code);
      $('#lockInput').value = '';
      showLock(false);
    } catch {
      showLock(true, 'Couldn’t reach the server. Is it running?');
    } finally {
      btn.disabled = false;
    }
  });
  $('#lockInput').addEventListener('input', () => $('#lockError').classList.add('hidden'));

  $('#results').addEventListener('click', async (e) => {
    if (e.target.closest('#sharebox')) {
      e.stopPropagation();
      if (e.target.id === 'shareBtn') return createShare(e.target);
      if (e.target.id === 'copyShare') {
        const input = $('#shareUrl');
        try {
          await navigator.clipboard.writeText(input.value);
          e.target.textContent = 'Copied ✓';
        } catch {
          input.select();
          e.target.textContent = 'Press Cmd+C';
        }
        setTimeout(() => (e.target.textContent = 'Copy'), 1600);
      }
      if (e.target.id === 'deleteShare') {
        const b = e.target;
        try {
          await api(`/api/share/${b.dataset.id}`, { method: 'DELETE', headers: { 'x-delete-key': b.dataset.key } });
          $('#sharebox').innerHTML = `<div class="share-text"><b>${icon('trash')} Link deleted</b><p class="hint">Nobody can open it anymore.</p></div>`;
        } catch (err) {
          showError(err.message);
        }
      }
      return;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      e.stopPropagation();
      const d = state.result.decisions[Number(copy.dataset.copy)];
      try {
        await navigator.clipboard.writeText(d.follow_up);
        copy.textContent = 'Copied ✓';
      } catch {
        copy.textContent = 'Select and copy';
      }
      setTimeout(() => (copy.textContent = 'Copy'), 1600);
      return;
    }
    const fix = e.target.closest('[data-fix]');
    if (fix) {
      e.stopPropagation();
      $(`#fix-${fix.dataset.fix}`).classList.toggle('hidden');
      return;
    }
    const set = e.target.closest('[data-set]');
    if (set) {
      e.stopPropagation();
      const [i, status] = set.dataset.set.split(':');
      const d = state.result.decisions[Number(i)];
      d.corrected_from = d.status;
      d.status = status;
      sendFeedback(d);
      renderResults(state.result);
      return;
    }
    const undo = e.target.closest('[data-undo]');
    if (undo) {
      e.stopPropagation();
      const d = state.result.decisions[Number(undo.dataset.undo)];
      d.status = d.corrected_from;
      delete d.corrected_from;
      renderResults(state.result);
      return;
    }
    const ev = e.target.closest('[data-ev]');
    if (ev) {
      e.stopPropagation();
      $$('.receipt.active').forEach((x) => x.classList.remove('active'));
      highlight([ev.dataset.ev]);
      return;
    }
    const c = e.target.closest('.receipt');
    if (c) {
      $$('.receipt.active').forEach((x) => x.classList.toggle('active', x === c));
      c.classList.add('active');
      highlight(state.result.decisions[Number(c.dataset.idx)].evidence.map((x) => x.message_id));
    }
  });
  $('#results').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('receipt')) e.target.click();
  });
}

async function health() {
  const el = $('#health');
  try {
    const h = await api('/api/health');
    const viaGroupLink = new URLSearchParams(location.search).has('key') || !!SHARE_ID;
    if (h.locked && !viaGroupLink) {
      const ok = accessCode && (await fetch('/api/unlock', { method: 'POST', headers: { 'x-access-code': accessCode } })).ok;
      if (!ok) {
        saveCode('');
        showLock(true);
      }
    }
    el.innerHTML = h.aiReady
      ? `<span class="dot ok"></span>AI ready${h.bot ? ' · Telegram bot on' : ''}`
      : '<span class="dot bad"></span>AI key missing';
    el.title = h.model;
  } catch {
    el.innerHTML = '<span class="dot bad"></span>Server offline';
  }
}

async function init() {
  hydrateIcons();
  bind();
  health();
  renderTimeline();
  if (SHARE_ID) return loadShared();
  renderEmptyResults();
  const params = new URLSearchParams(location.search);
  if (params.get('chat') && params.get('key')) {
    state.group = { chatId: params.get('chat'), key: params.get('key') };
    const tab = $('#groupTab');
    tab.classList.remove('hidden');
    tab.click();
    await loadGroup();
  }
}

init();