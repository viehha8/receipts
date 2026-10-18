// Guardrails that run in plain code, before and after the AI.
//  1. redactMessages  – masks personal data before anything leaves the server
//  2. scanInjection   – flags chat messages that try to give the AI instructions
//  3. validateDecisions – checks every AI claim against the real messages and
//     downgrades anything "confirmed" that the evidence does not support

export const STATUSES = ['confirmed', 'unconfirmed', 'disputed', 'cancelled'];
export const TYPES = ['task', 'deadline', 'meeting', 'location', 'purchase', 'money_split', 'other'];
export const ROLES = ['proposal', 'commitment', 'agreement', 'objection', 'change', 'info'];

// Order matters: card numbers before phone numbers.
const REDACTIONS = [
  { key: 'nric', label: 'NRIC/FIN', re: /\b[STFGM]\d{7}[A-Z]\b/gi, tag: '[NRIC]' },
  { key: 'email', label: 'email', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, tag: '[EMAIL]' },
  { key: 'card', label: 'card number', re: /\b(?:\d[ -]?){13,19}\b/g, tag: '[CARD]' },
  { key: 'phone', label: 'phone number', re: /(?:\+65[ -]?)?\b[3689]\d{3}[ -]?\d{4}\b/g, tag: '[PHONE]' },
];

export function redactText(text, counts = {}) {
  let out = String(text ?? '');
  for (const r of REDACTIONS) {
    out = out.replace(r.re, () => {
      counts[r.key] = (counts[r.key] || 0) + 1;
      return r.tag;
    });
  }
  return out;
}

export function redactMessages(messages) {
  const counts = {};
  const out = messages.map((m) => ({ ...m, text: redactText(m.text, counts) }));
  const labels = Object.fromEntries(REDACTIONS.map((r) => [r.key, r.label]));
  return {
    messages: out,
    redactions: Object.entries(counts).map(([key, count]) => ({ key, label: labels[key], count })),
  };
}

const INJECTION_PATTERNS = [
  [/\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|earlier|all|your|the)\b.{0,20}\b(instructions?|rules?|prompts?|messages?|guidelines?)\b/i, 'Tries to override the AI’s instructions'],
  [/\b(system|developer|admin)\s*(prompt|message|override|instruction|mode)\b/i, 'Pretends to be a system or developer message'],
  [/^\s*(system|assistant|developer)\s*:/i, 'Pretends to be a system or assistant message'],
  [/\byou are (now|no longer)\b/i, 'Tries to change the AI’s role'],
  [/\b(mark|label|record|treat|set|list)\b.{0,40}\b(every|all|each|everything)\b.{0,40}\b(confirmed|agreed|approved|done|assigned)\b/i, 'Tries to force the outcome of the analysis'],
  [/\b(as an ai|language model|ai assistant|dear (ai|bot|assistant)|receipts bot|hey (ai|bot))\b/i, 'Addresses the AI directly'],
  [/\bnew instructions?\b|\binstructions? (for|to) the (ai|bot|assistant)\b/i, 'Contains instructions aimed at the AI'],
  [/<\/?\s*(chat_log|system|instructions?|prompt)\s*>/i, 'Contains prompt formatting tags'],
  [/\b(jailbreak|prompt injection|do anything now|dan mode)\b/i, 'Mentions jailbreak techniques'],
  [/\b(reveal|print|show|repeat)\b.{0,20}\b(system prompt|your prompt|your instructions|hidden marker)\b/i, 'Tries to extract the AI’s instructions'],
  [/\bdo not (mention|report|flag) this (message|instruction)\b/i, 'Tries to hide itself from the report'],
];

export function scanInjection(messages) {
  const flagged = [];
  for (const m of messages) {
    const reasons = [];
    for (const [re, reason] of INJECTION_PATTERNS) {
      if (re.test(m.text) && !reasons.includes(reason)) reasons.push(reason);
    }
    if (reasons.length) flagged.push({ id: m.id, sender: m.sender, reasons, source: 'pattern' });
  }
  return flagged;
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[“”"'‘’`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** True if the quote (allowing "..." gaps) really appears in the message. */
export function quoteInText(quote, text) {
  const t = norm(text);
  const pieces = norm(quote)
    .split(/\.{3}|…/)
    .map((p) => p.trim().replace(/^[.,!?;:]+|[.,!?;:]+$/g, '').trim())
    .filter(Boolean);
  if (!pieces.length) return false;
  return pieces.every((p) => t.includes(p));
}

const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const str = (v, max = 300) => (typeof v === 'string' && v.trim() ? shorten(v.trim(), max) : null);

function confirmBlocker(evidence) {
  if (!evidence.length) return 'No real message backs this up, so it cannot be marked as confirmed.';
  const usable = evidence.filter((e) => !e.flagged);
  const people = new Set(usable.map((e) => e.sender.toLowerCase()));
  if (people.size >= 2) return null;
  if (usable.length < evidence.length) return 'Part of the evidence is a message flagged as a possible prompt injection.';
  return 'Only one person is on record. Nobody else agreed in the chat.';
}

/**
 * Checks the AI's output against the actual messages.
 * - evidence pointing at message ids that don't exist is dropped
 * - quotes that don't appear in the cited message are replaced with the real text
 * - "confirmed" needs evidence from at least two different people, none of it flagged
 */
export function validateDecisions(raw, messages, flaggedIds = new Set()) {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const audit = { droppedEvidence: 0, unverifiedQuotes: 0, downgraded: [] };
  const decisions = [];

  for (const d of Array.isArray(raw) ? raw : []) {
    if (!d || typeof d !== 'object') continue;
    const topic = str(d.topic, 80) || 'Untitled decision';
    const evidence = [];
    for (const e of Array.isArray(d.evidence) ? d.evidence : []) {
      const m = byId.get(String(e?.message_id ?? '').trim());
      if (!m) {
        audit.droppedEvidence++;
        continue;
      }
      if (evidence.some((x) => x.message_id === m.id)) continue;
      const verified = quoteInText(e?.quote, m.text);
      if (!verified) audit.unverifiedQuotes++;
      evidence.push({
        message_id: m.id,
        sender: m.sender,
        ts: m.ts,
        role: ROLES.includes(e?.role) ? e.role : 'info',
        quote: verified ? shorten(String(e.quote).trim(), 160) : shorten(m.text, 160),
        quote_verified: verified,
        flagged: flaggedIds.has(m.id),
      });
    }
    evidence.sort((a, b) => a.ts - b.ts);

    const aiStatus = STATUSES.includes(d.status) ? d.status : 'unconfirmed';
    let status = aiStatus;
    let guardrailNote = null;
    if (status === 'confirmed') {
      const reason = confirmBlocker(evidence);
      if (reason) {
        status = 'unconfirmed';
        guardrailNote = reason;
        audit.downgraded.push({ topic, from: 'confirmed', to: 'unconfirmed', reason });
      }
    } else if (status !== 'unconfirmed' && !evidence.length) {
      guardrailNote = 'No real message backs this up.';
      audit.downgraded.push({ topic, from: status, to: 'unconfirmed', reason: guardrailNote });
      status = 'unconfirmed';
    }

    let followUp = status === 'confirmed' ? null : str(d.follow_up, 280);
    if (!followUp && (status === 'unconfirmed' || status === 'disputed')) followUp = `Quick check: can we confirm "${topic}"?`;

    decisions.push({
      topic,
      type: TYPES.includes(d.type) ? d.type : 'other',
      status,
      ai_status: aiStatus,
      summary: str(d.summary, 300) || topic,
      owner: str(d.owner, 60),
      due: str(d.due, 60),
      reasoning: str(d.reasoning, 500),
      follow_up: followUp,
      guardrail_note: guardrailNote,
      evidence,
      money: d.type === 'money_split' && d.money && typeof d.money === 'object' ? d.money : null,
    });
  }

  const order = { disputed: 0, unconfirmed: 1, confirmed: 2, cancelled: 3 };
  decisions.sort((a, b) => order[a.status] - order[b.status] || (a.evidence[0]?.ts ?? 0) - (b.evidence[0]?.ts ?? 0));
  return { decisions, audit };
}
