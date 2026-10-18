import crypto from 'node:crypto';
import { Bot, InlineKeyboard, webhookCallback } from 'grammy';
import * as store from './store.js';
const DAYS = () => store.RETENTION_DAYS();
import { analyzeChat } from './analyze.js';
import { parseWindow } from './timewindow.js';

const TZ = () => process.env.TZ_NAME || 'Asia/Singapore';
const isGroup = (ctx) => ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const baseUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

const CONSENT = () => `👋 <b>Hi, I'm Receipts.</b> I help this group remember what it actually agreed on.

From now on I save <b>text messages</b> in this group. They are only analysed when someone types /receipts.
• Phone numbers, emails, card numbers and NRICs are masked before anything is sent to the AI.
• Saved messages are deleted automatically after ${DAYS()} days.
• /pause stops saving, /resume starts again.
• /forgetme deletes your own saved messages. Admins can /forget to wipe everything.
• I can't see anything sent before I joined.

If I don't seem to see messages, make me an admin (or turn off privacy mode in @BotFather and re-add me).`;

const HELP = `🧾 <b>Receipts</b>: who actually agreed to what.

<b>In a group</b>
/receipts: analyse the last 24 hours
/receipts 2h · /receipts 30m · /receipts today · /receipts all
/dashboard: open the full breakdown with evidence
/pause · /resume: stop or restart saving messages
/forgetme: delete your saved messages
/forget: delete everything (admins only)
/privacy: what I store

<b>No group?</b> Open ${baseUrl()}/app and paste or upload a WhatsApp/Telegram export.`;

function displayName(u) {
  if (!u) return 'Unknown';
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Unknown';
}

function msgLink(chat, tgId) {
  if (!tgId) return null;
  if (chat.username) return `https://t.me/${chat.username}/${tgId}`;
  const s = String(chat.id);
  return s.startsWith('-100') ? `https://t.me/c/${s.slice(4)}/${tgId}` : null;
}

const tgIdOf = (id) => (/^t\d+$/.test(id) ? Number(id.slice(1)) : null);

function moneyLine(calc) {
  if (!calc) return '';
  if (calc.status === 'incomplete') return `\n   💸 Can't split yet: ${h(calc.reason)}`;
  if (calc.settlements.length) {
    return '\n   💸 ' + calc.settlements.map((s) => `${h(s.from)} → ${h(s.to)} $${s.amount.toFixed(2)}`).join(', ');
  }
  if (calc.shares.length) return '\n   💸 Shares: ' + calc.shares.map((s) => `${h(s.name)} $${s.amount.toFixed(2)}`).join(', ');
  return '';
}

export function formatReply(result, label, chat) {
  const lines = [`🧾 <b>Receipts</b> · ${h(label)} · ${result.stats.messages} messages`, ''];
  const groups = [
    ['confirmed', '✅ CONFIRMED'],
    ['unconfirmed', '⏳ NOT CONFIRMED YET'],
    ['disputed', '⚔️ DISPUTED'],
    ['cancelled', '🚫 CANCELLED'],
  ];
  for (const [status, title] of groups) {
    const items = result.decisions.filter((d) => d.status === status);
    if (!items.length) continue;
    lines.push(`<b>${title}</b>`);
    for (const d of items) {
      let line = `• <b>${h(d.topic)}</b>: ${h(d.summary)}`;
      if (d.owner) line += ` 👤 ${h(d.owner)}`;
      if (d.due) line += ` 🗓 ${h(d.due)}`;
      const last = d.evidence[d.evidence.length - 1];
      const link = last && msgLink(chat, tgIdOf(last.message_id));
      if (link) line += ` <a href="${link}">[receipt]</a>`;
      line += moneyLine(d.money_calc);
      if (d.guardrail_note) line += `\n   🛡 ${h(d.guardrail_note)}`;
      lines.push(line);
    }
    lines.push('');
  }
  if (!result.decisions.length) lines.push('No decisions found in this window.', '');

  const s = result.safety;
  const safety = [];
  if (s.injections.length) safety.push(`${s.injections.length} message(s) looked like instructions to the AI and were ignored`);
  const red = s.redactions.reduce((a, r) => a + r.count, 0);
  if (red) safety.push(`${red} personal detail(s) masked before AI`);
  if (s.downgraded.length) safety.push(`${s.downgraded.length} claim(s) downgraded for lack of evidence`);
  if (safety.length) lines.push(`🛡 ${safety.join(' · ')}`);
  lines.push('Full breakdown with evidence: /dashboard');

  let text = lines.join('\n');
  if (text.length > 4000) text = text.slice(0, 3990) + '…';
  return text;
}

export function createBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  const bot = new Bot(token);
  const runs = new Map(); // runId -> { chatId, items: [{ text, replyTo, posted }] }

  const remember = (run) => {
    const id = crypto.randomBytes(4).toString('hex');
    runs.set(id, run);
    if (runs.size > 100) runs.delete(runs.keys().next().value);
    return id;
  };

  bot.command(['start', 'help'], (ctx) => ctx.reply(HELP, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }));

  bot.command('privacy', (ctx) =>
    ctx.reply(
      'I store: sender display name, message text and time, for text messages in groups I am in. I do not store photos, files or phone numbers of members. Data is only sent to the AI when someone runs /receipts, with phone numbers, emails, card numbers and NRICs masked first. Saved messages are deleted automatically after ' + DAYS() + ' days. /forgetme or /forget deletes them sooner.',
    ),
  );

  async function runReceipts(ctx) {
    const win = parseWindow(ctx.match, Date.now(), TZ());
    if (!win) return ctx.reply('Try /receipts 2h, /receipts 30m, /receipts today or /receipts all.');
    const chat = store.getChat(ctx.chat.id, ctx.chat.title, ctx.chat.username);
    const msgs = store.publicMessages(chat).filter((m) => m.ts >= win.from);
    if (msgs.length < 2) {
      return ctx.reply(
        `I only have ${msgs.length} saved message(s) for the ${win.label}. I can only see messages sent after I joined${chat.paused ? ', and saving is paused (/resume)' : ''}. Try /receipts all.`,
      );
    }
    await ctx.replyWithChatAction('typing').catch(() => {});
    const typing = setInterval(() => ctx.replyWithChatAction('typing').catch(() => {}), 4500);
    try {
      const result = await analyzeChat(msgs, { timeZone: TZ() });
      const followUps = result.decisions
        .filter((d) => (d.status === 'unconfirmed' || d.status === 'disputed') && d.follow_up)
        .slice(0, 4)
        .map((d) => ({ topic: d.topic, text: d.follow_up, replyTo: tgIdOf(d.evidence[d.evidence.length - 1]?.message_id || '') }));
      const kb = new InlineKeyboard();
      if (followUps.length) {
        const runId = remember({ chatId: ctx.chat.id, items: followUps });
        followUps.forEach((f, i) => kb.text(`📣 Ask: ${trunc(f.topic, 30)}`, `fu:${runId}:${i}`).row());
      }
      await ctx.reply(formatReply(result, win.label, chat), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: followUps.length ? kb : undefined,
      });
    } catch (e) {
      console.error('receipts failed:', e);
      await ctx.reply(`Sorry, I couldn't analyse that: ${e.message}`);
    } finally {
      clearInterval(typing);
    }
  }

  bot.command('receipts', (ctx) => {
    if (!isGroup(ctx)) return ctx.reply('Add me to a group chat first. Or use the dashboard: ' + baseUrl() + '/app');
    // Don't block the update (webhooks time out after a few seconds); reply when done.
    runReceipts(ctx).catch((e) => console.error(e));
  });

  bot.command('dashboard', (ctx) => {
    if (!isGroup(ctx)) return ctx.reply(`Dashboard: ${baseUrl()}/app`);
    const chat = store.getChat(ctx.chat.id, ctx.chat.title, ctx.chat.username);
    const url = `${baseUrl()}/app?chat=${encodeURIComponent(chat.id)}&key=${chat.key}`;
    return ctx.reply(`📊 Dashboard for this group:\n${url}\n\nAnyone with this link can see the messages I've saved here. /forget resets it.`, {
      link_preview_options: { is_disabled: true },
    });
  });

  bot.command('pause', (ctx) => {
    if (!isGroup(ctx)) return;
    store.setPaused(ctx.chat.id, true);
    return ctx.reply('⏸ Paused. I won’t save new messages until someone types /resume.');
  });

  bot.command('resume', (ctx) => {
    if (!isGroup(ctx)) return;
    store.setPaused(ctx.chat.id, false);
    return ctx.reply('▶️ Saving messages again. /pause to stop.');
  });

  bot.command('forgetme', (ctx) => {
    if (!isGroup(ctx) || !ctx.from) return;
    const n = store.forgetUser(ctx.chat.id, ctx.from.id);
    return ctx.reply(`🗑 Deleted ${n} of your saved message(s).`);
  });

  bot.command('forget', async (ctx) => {
    if (!isGroup(ctx) || !ctx.from) return;
    const member = await ctx.getChatMember(ctx.from.id).catch(() => null);
    const isAdmin = ['creator', 'administrator'].includes(member?.status);
    if (!isAdmin) return ctx.reply('Only group admins can wipe everything. Use /forgetme to delete your own messages.');
    const n = store.forgetChat(ctx.chat.id);
    return ctx.reply(`🗑 Deleted all ${n} saved message(s). Old dashboard links no longer work.`);
  });

  bot.callbackQuery(/^fu:([0-9a-f]+):(\d+)$/, async (ctx) => {
    const run = runs.get(ctx.match[1]);
    const item = run?.items[Number(ctx.match[2])];
    if (!run || !item) return ctx.answerCallbackQuery({ text: 'This suggestion expired. Run /receipts again.', show_alert: true });
    if (item.posted) return ctx.answerCallbackQuery({ text: 'Already posted.' });
    item.posted = true;
    await ctx.api.sendMessage(run.chatId, `📣 ${item.text}`, item.replyTo ? { reply_parameters: { message_id: item.replyTo, allow_sending_without_reply: true } } : {});
    return ctx.answerCallbackQuery({ text: 'Posted to the group' });
  });

  bot.on('my_chat_member', async (ctx) => {
    const { old_chat_member: o, new_chat_member: n } = ctx.myChatMember;
    const joined = ['left', 'kicked'].includes(o.status) && ['member', 'administrator'].includes(n.status);
    if (joined && isGroup(ctx)) {
      store.getChat(ctx.chat.id, ctx.chat.title, ctx.chat.username);
      await ctx.reply(CONSENT(), { parse_mode: 'HTML' }).catch(() => {});
    }
  });

  bot.on('message:text', (ctx) => {
    if (!isGroup(ctx)) return ctx.reply(HELP, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
    const chat = store.getChat(ctx.chat.id, ctx.chat.title, ctx.chat.username);
    if (chat.paused) return;
    store.addMessage(ctx.chat.id, {
      tgMessageId: ctx.message.message_id,
      userId: ctx.from?.id,
      sender: displayName(ctx.from),
      text,
      ts: ctx.message.date * 1000,
    });
  });

  bot.on('edited_message:text', (ctx) => {
    if (isGroup(ctx)) store.editMessage(ctx.chat.id, ctx.editedMessage.message_id, ctx.editedMessage.text);
  });

  bot.catch((err) => console.error('Bot error:', err.error || err));
  return bot;
}

const ALLOWED = ['message', 'edited_message', 'callback_query', 'my_chat_member'];
const COMMANDS = [
  { command: 'receipts', description: 'Find decisions (e.g. /receipts 2h)' },
  { command: 'dashboard', description: 'Open the full breakdown' },
  { command: 'pause', description: 'Stop saving messages' },
  { command: 'resume', description: 'Start saving again' },
  { command: 'forgetme', description: 'Delete my saved messages' },
  { command: 'forget', description: 'Delete everything (admins)' },
  { command: 'privacy', description: 'What Receipts stores' },
  { command: 'help', description: 'How to use Receipts' },
];

/** Attaches the bot to the Express app (webhook) or starts long polling. */
export async function startBot(app) {
  const bot = createBot();
  if (!bot) {
    console.log('ℹ️  TELEGRAM_BOT_TOKEN not set: running dashboard only.');
    return null;
  }
  await bot.init();
  await bot.api.setMyCommands(COMMANDS).catch((e) => console.warn('setMyCommands failed:', e.message));

  if ((process.env.BOT_MODE || 'polling') === 'webhook') {
    if (!process.env.PUBLIC_URL?.startsWith('https://')) throw new Error('BOT_MODE=webhook needs PUBLIC_URL set to your https:// address.');
    const secret = crypto.createHash('sha256').update(process.env.TELEGRAM_BOT_TOKEN).digest('hex').slice(0, 32);
    const route = `/telegram/${secret}`;
    app.post(route, webhookCallback(bot, 'express', { secretToken: secret, timeoutMilliseconds: 25_000, onTimeout: 'return' }));
    await bot.api.setWebhook(`${baseUrl()}${route}`, { secret_token: secret, allowed_updates: ALLOWED });
    console.log(`🤖 @${bot.botInfo.username} running with webhook`);
  } else {
    bot.start({ allowed_updates: ALLOWED, onStart: (info) => console.log(`🤖 @${info.username} running with polling`) }).catch((e) =>
      console.error('Bot polling stopped:', e.message),
    );
  }
  return bot;
}