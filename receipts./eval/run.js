// Runs the labelled test chats through the real pipeline and reports accuracy.
// Usage: npm run eval            (needs GEMINI_API_KEY in .env)
// Writes eval/RESULTS.md, which you can paste into your Devpost write-up.
import 'dotenv/config';
import fs from 'node:fs';
import { parseChat } from '../src/shared/parsers.js';
import { analyzeChat } from '../src/analyze.js';

const cases = JSON.parse(fs.readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const findDecision = (r, keywords) =>
  r.decisions.filter((d) => {
    const hay = `${d.topic} ${d.summary} ${d.owner || ''} ${d.due || ''}`.toLowerCase();
    return keywords.some((k) => hay.includes(k.toLowerCase()));
  });

const rows = [];
let pass = 0;
let total = 0;

for (const c of cases) {
  process.stdout.write(`• ${c.name} … `);
  let r;
  try {
    r = await analyzeChat(parseChat(c.chat.join('\n')).messages, { timeZone: 'Asia/Singapore' });
  } catch (e) {
    console.log(`ERROR ${e.message}`);
    for (const _ of c.expect) rows.push([c.name, 'error', '–', '✗']);
    total += c.expect.length;
    continue;
  }
  const results = [];
  for (const exp of c.expect) {
    total++;
    const matches = findDecision(r, exp.keywords);
    const ok = matches.some((d) => exp.status.includes(d.status) && (!exp.type || d.type === exp.type));
    if (ok) pass++;
    const got = matches.map((d) => `${d.status}${exp.type ? `/${d.type}` : ''}`).join(', ') || 'not found';
    rows.push([c.name, `${exp.keywords[0]} → ${exp.status.join(' or ')}${exp.type ? ` (${exp.type})` : ''}`, got, ok ? '✓' : '✗']);
    results.push(ok);
  }
  if (c.expectMoney) {
    total++;
    const d = findDecision(r, c.expectMoney.keywords).find((x) => x.money_calc);
    const owed = d?.money_calc?.settlements.filter((s) => s.to.toLowerCase() === c.expectMoney.to.toLowerCase()).reduce((a, s) => a + s.amount, 0) ?? null;
    const ok = owed !== null && Math.abs(owed - c.expectMoney.total) < 0.01;
    if (ok) pass++;
    rows.push([c.name, `owed to ${c.expectMoney.to} = $${c.expectMoney.total}`, owed === null ? 'no calculation' : `$${owed}`, ok ? '✓' : '✗']);
    results.push(ok);
  }
  if (c.expectMoneyNotOk) {
    total++;
    const d = findDecision(r, c.expectMoneyNotOk.keywords)[0];
    const ok = !d?.money_calc || d.money_calc.status !== 'ok';
    if (ok) pass++;
    rows.push([c.name, 'no invented amount', d?.money_calc ? d.money_calc.status : 'no calculation', ok ? '✓' : '✗']);
    results.push(ok);
  }
  if (c.expectInjection) {
    total++;
    const ok = r.safety.injections.length > 0;
    if (ok) pass++;
    rows.push([c.name, 'injection flagged', ok ? r.safety.injections.map((f) => f.source).join(', ') : 'missed', ok ? '✓' : '✗']);
    results.push(ok);
  }
  console.log(results.every(Boolean) ? 'pass' : 'FAIL');
  await sleep(800);
}

const pct = total ? Math.round((pass / total) * 100) : 0;
const md = [
  `# Receipts evaluation`,
  '',
  `Model: \`${process.env.GEMINI_MODEL || 'gemini-flash-latest'}\` · Run: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  '',
  `**${pass} / ${total} checks passed (${pct}%)** across ${cases.length} labelled chats.`,
  '',
  '| Case | Expected | Got | |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.map((x) => String(x).replace(/\|/g, '/')).join(' | ')} |`),
  '',
].join('\n');
fs.writeFileSync(new URL('./RESULTS.md', import.meta.url), md);
console.log(`\n${pass}/${total} checks passed (${pct}%). Table saved to eval/RESULTS.md`);
