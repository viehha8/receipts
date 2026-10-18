// Money maths is done here, in plain code. The AI only extracts who paid what;
// it never does arithmetic. Everything is in integer cents to avoid rounding bugs.

const toCents = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null);
const dollars = (c) => Math.round(c) / 100;
const fmt = (c, cur) => `${cur} ${(c / 100).toFixed(2)}`;
const cleanName = (n) => String(n ?? '').trim().replace(/\s+/g, ' ');

function nameBook() {
  const map = new Map(); // lower-case key -> display name
  return {
    add(n) {
      const name = cleanName(n);
      if (!name) return null;
      const k = name.toLowerCase();
      if (!map.has(k)) map.set(k, name);
      return map.get(k);
    },
    list: () => [...map.values()],
  };
}

export function equalShares(totalCents, names) {
  const base = Math.floor(totalCents / names.length);
  let rem = totalCents - base * names.length;
  return new Map(names.map((n) => [n, base + (rem-- > 0 ? 1 : 0)]));
}

export function settle(balances) {
  const debtors = balances.filter((b) => b.net < 0).map((b) => ({ name: b.name, amt: -b.net })).sort((a, b) => b.amt - a.amt);
  const creditors = balances.filter((b) => b.net > 0).map((b) => ({ name: b.name, amt: b.net })).sort((a, b) => b.amt - a.amt);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const x = Math.min(debtors[i].amt, creditors[j].amt);
    if (x > 0) out.push({ from: debtors[i].name, to: creditors[j].name, amount: x });
    debtors[i].amt -= x;
    creditors[j].amt -= x;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return out;
}

/**
 * @param {object} money  what the AI extracted: { total, currency, payers[{name, amount}], participants[], participant_count, split_method, custom_shares[] }
 * @returns {{status:'ok'|'partial'|'incomplete', currency, total, shares, balances, settlements, warnings, reason?}}
 */
export function computeSplit(money = {}) {
  const currency = /^[A-Z]{3}$/i.test(money?.currency || '') ? money.currency.toUpperCase() : 'SGD';
  const warnings = [];
  const book = nameBook();
  const incomplete = (reason) => ({ status: 'incomplete', currency, reason, total: total == null ? null : dollars(total), shares: [], balances: [], settlements: [], warnings });

  for (const p of money?.participants || []) book.add(p);
  const count = Number.isInteger(money?.participant_count) ? money.participant_count : null;
  const named = book.list().length;
  if (count && count > named && count <= 50) {
    for (let k = named + 1; k <= count; k++) book.add(`Person ${k}`);
    warnings.push(`${count} people were mentioned but only ${named} named, so placeholders were added.`);
  }
  const sharers = book.list().slice(); // people splitting the cost (before payers are added)

  const payers = [];
  for (const p of money?.payers || []) {
    const name = book.add(p?.name);
    if (name) payers.push({ name, amount: toCents(p?.amount) });
  }

  let total = toCents(money?.total);
  let shares;
  const method = money?.split_method;

  if (method === 'custom') {
    const cs = (money?.custom_shares || [])
      .map((s) => ({ name: book.add(s?.name), c: toCents(s?.amount) }))
      .filter((s) => s.name && s.c != null);
    if (!cs.length) return incomplete('A custom split was mentioned but the individual amounts are missing.');
    const sum = cs.reduce((a, s) => a + s.c, 0);
    if (total == null) total = sum;
    else if (sum !== total) warnings.push(`Individual shares add up to ${fmt(sum, currency)}, not the stated total of ${fmt(total, currency)}.`);
    shares = new Map(cs.map((s) => [s.name, s.c]));
  } else if (method === 'equal') {
    if (total == null) {
      if (payers.length && payers.every((p) => p.amount != null)) {
        total = payers.reduce((a, p) => a + p.amount, 0);
        warnings.push('The total was not stated, so the amount paid is used as the total.');
      } else {
        return incomplete('The total amount was never stated in the chat.');
      }
    }
    if (!sharers.length) return incomplete('Nobody was named as sharing this cost.');
    shares = equalShares(total, sharers);
  } else {
    return incomplete('The chat does not say how this cost will be split.');
  }

  if (payers.length === 1 && payers[0].amount == null) payers[0].amount = total;

  const shareList = [...shares].map(([name, c]) => ({ name, amount: dollars(c) }));
  if (payers.some((p) => p.amount == null)) {
    warnings.push('Some payment amounts are missing, so who-owes-whom cannot be worked out yet.');
    return { status: 'partial', currency, total: dollars(total), shares: shareList, balances: [], settlements: [], warnings };
  }
  if (!payers.length) {
    warnings.push('Nobody is recorded as having paid yet, so only each person’s share is shown.');
    return { status: 'partial', currency, total: dollars(total), shares: shareList, balances: [], settlements: [], warnings };
  }

  const paid = new Map();
  for (const p of payers) paid.set(p.name, (paid.get(p.name) || 0) + p.amount);
  const paidSum = [...paid.values()].reduce((a, b) => a + b, 0);
  if (paidSum !== total) {
    warnings.push(`Payments recorded (${fmt(paidSum, currency)}) don't match the total (${fmt(total, currency)}).`);
  }

  const everyone = [...new Set([...shares.keys(), ...paid.keys()])];
  const balancesC = everyone.map((name) => {
    const p = paid.get(name) || 0;
    const s = shares.get(name) || 0;
    return { name, paid: p, share: s, net: p - s };
  });
  const settlements = paidSum === total ? settle(balancesC) : [];

  return {
    status: paidSum === total ? 'ok' : 'partial',
    currency,
    total: dollars(total),
    shares: shareList,
    balances: balancesC.map((b) => ({ name: b.name, paid: dollars(b.paid), share: dollars(b.share), net: dollars(b.net) })),
    settlements: settlements.map((s) => ({ ...s, amount: dollars(s.amount) })),
    warnings,
  };
}
