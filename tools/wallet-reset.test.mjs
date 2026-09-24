// Integration tests always run a copied server with its own data/backups/exports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { agentWalletTotals, paymentHistory, latestWalletReset } from '../client/src/wallet.js';
import { agentWalletBreakdown } from '../client/src/dashboardStats.js';
const root = path.resolve(import.meta.dirname, '..');
// Synthetic demo business (no real data): tools/fixtures/business/{data,backups/month-close,exports}.
const livePath = path.join(root, 'tools/fixtures/business/data/stockpilot.json');
const original = fs.readFileSync(livePath);
const live = JSON.parse(original);

async function isolated(t, initial) {
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'tmp/wallet-test-'));
  fs.cpSync(path.join(root, 'server'), path.join(dir, 'server'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'));
  const file = path.join(dir, 'data/stockpilot.json');
  if (initial) fs.writeFileSync(file, JSON.stringify(initial, null, 2));
  const listener = net.createServer();
  await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port;
  await new Promise(r => listener.close(r));
  const child = spawn(process.execPath, [path.join(dir, 'server/index.mjs')], {
    env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', b => logs += b);
  child.stderr.on('data', b => logs += b);
  t.after(async () => {
    if (child.exitCode === null) await new Promise(r => { child.once('exit', r); child.kill(); });
    assert(fs.readFileSync(livePath).equals(original), 'Tests must not change live data');
  });
  const request = async (route, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await request('/state')).status === 200; } catch {}
    if (ready) break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert(ready, logs);
  const ok = async (...args) => { const r = await request(...args); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  return { dir, file, request, ok, read: () => JSON.parse(fs.readFileSync(file)) };
}

// Wallet Reset baseline + permanent payment history. Every test runs its own copied server with fresh temporary data.

async function setup(t) {
  const app = await isolated(t);
  const company = await app.ok('/companies', 'POST', { name: 'Wallet Test Co' });
  const agent = await app.ok('/agents', 'POST', { name: 'Wallet Agent', companyId: company.id });
  const product = await app.ok('/products', 'POST', { sku: 'WT-1', name: 'Wallet Product', costPrice: 100, stock: 50 });
  await app.ok('/product-master', 'POST', { companyId: company.id, marketplace: 'Amazon', code: 'WT-1', sku: 'WT-SKU', name: 'Wallet Product' });
  const account = (await app.ok('/state')).accounts.find(a => a.agentId === agent.id && a.marketplace === 'Amazon');
  let n = 0;
  const sell = async (qty = 1, saleAmount = 250) => (await app.ok('/sales', 'POST', [{ agentId: agent.id, accountId: account.id, productId: product.id, marketplaceSku: 'WT-SKU', qty, saleAmount, orderId: `408-0000000-00000${++n}`, source: 'ollama-label' }]))[0];
  const pay = (amount, note = 'test') => app.ok('/payments', 'POST', { agentId: agent.id, amount, note });
  const reset = () => app.ok(`/agents/${agent.id}/reset-wallet`, 'POST', { confirm: true });
  // Server and client must always agree: server dueByAgent == client wallet formula == details breakdown.
  const view = async () => {
    const s = await app.ok('/state');
    const w = agentWalletTotals(s.ledger, agent.id, s.walletResets);
    const bd = agentWalletBreakdown(s, agent.id, latestWalletReset(s.walletResets, agent.id));
    assert.equal(s.dueByAgent[agent.id], w.pending, 'agent list balance (server) = wallet details balance (client)');
    assert.equal(bd.stockCostDue, w.due, 'product/marketplace breakdown adds up to Stock Cost Due');
    return { s, w, bd, history: paymentHistory(s, agent.id) };
  };
  return { app, agent, sell, pay, reset, view };
}

test('payments: each payment is its own permanent history entry with date, time, type, amount and note', async t => {
  const { sell, pay, view } = await setup(t);
  await sell(3);                          // due 300
  await pay(100, 'UPI part 1');
  await pay(50, 'September settlement');
  const { w, history, s } = await view();
  assert.deepEqual(w, { due: 300, paid: 150, pending: 150 });
  const payments = history.filter(h => h.type === 'Payment Sent');
  assert.equal(payments.length, 2, 'second payment must not overwrite the first');
  assert.deepEqual(payments.map(p => [p.amount, p.note]), [[50, 'September settlement'], [100, 'UPI part 1']]);
  for (const p of payments) { assert.match(p.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/); }
  const d = new Date(); const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(payments[0].date, local, 'payment date is the local date');
  assert.equal(s.ledger.filter(l => l.type === 'PAYMENT').length, 2);
});

test('reset needs confirmation, gives a ₹0 baseline, deletes nothing, and later transactions count from the reset', async t => {
  const { app, agent, sell, pay, reset, view } = await setup(t);
  await sell(2);                          // due 200
  await pay(80, 'before reset');
  const before = await view();
  const beforeLedger = before.s.ledger.map(l => l.id);
  const beforeSales = before.s.todaySales.map(s => s.id);
  assert.equal(before.w.pending, 120);

  assert.equal((await app.request(`/agents/${agent.id}/reset-wallet`, 'POST', {})).status, 400, 'reset without confirmation is refused');
  assert.equal((await view()).w.pending, 120);

  const r = await reset();
  assert.equal(r.reset, true);
  const after = await view();
  assert.deepEqual(after.w, { due: 0, paid: 0, pending: 0 });
  assert.deepEqual(after.bd.totals.sales, 0); assert.deepEqual(after.bd.byProduct, []);
  // Nothing deleted: every earlier ledger entry and sale is still there.
  for (const id of beforeLedger) assert(after.s.ledger.some(l => l.id === id), 'ledger entry kept');
  for (const id of beforeSales) assert(after.s.todaySales.some(s => s.id === id), 'sale kept');
  assert.equal(after.s.agents.length, 1); assert.equal(after.s.accounts.length, 3); assert.equal(after.s.products.length, 1);
  const rec = after.s.walletResets[0];
  assert.equal(rec.agentId, agent.id); assert.match(rec.resetAt, /T/); assert.equal(rec.balanceBefore, 120); assert.equal(rec.dueBefore, 200); assert.equal(rec.creditBefore, 80);
  // History still shows the old payment AND the reset.
  assert.deepEqual(after.history.map(h => h.type), ['Wallet Reset', 'Payment Sent']);
  assert.equal(after.history[1].note, 'before reset');

  // New activity after the reset counts from the fresh baseline.
  await sell(1);                          // +100
  await pay(40, 'after reset');
  const later = await view();
  assert.deepEqual(later.w, { due: 100, paid: 40, pending: 60 });
  assert.equal(later.bd.totals.qty, 1, 'breakdown shows only the current period');
  assert.deepEqual(later.history.map(h => h.type), ['Payment Sent', 'Wallet Reset', 'Payment Sent']);
});

test('multiple resets; a reset clears a hidden negative credit too; refund across the reset baseline', async t => {
  const { app, agent, sell, pay, reset, view } = await setup(t);
  const s1 = await sell(1, 300);           // due 100
  await reset();
  assert.equal((await view()).w.pending, 0);
  // Refund of a PRE-reset sale after the reset: its reversal (-300, full sale amount - existing rule) is a new event.
  await app.ok('/refunds', 'POST', { saleId: s1.id });
  let v = await view();
  assert.deepEqual(v.w, { due: -300, paid: 0, pending: 0 });
  await sell(1);                           // +100 -> still absorbed by the refund credit (-200)
  v = await view();
  assert.equal(v.w.pending, 0);
  await reset();                           // second reset: fresh ₹0 baseline again (negative credit does not carry over)
  await sell(1);                           // +100
  v = await view();
  assert.deepEqual(v.w, { due: 100, paid: 0, pending: 100 });
  assert.equal(v.s.walletResets.length, 2);
  assert.equal(v.history.filter(h => h.type === 'Wallet Reset').length, 2);
  await pay(100, 'clear');
  assert.equal((await view()).w.pending, 0);
  assert.equal((await app.request('/payments', 'POST', { agentId: agent.id, amount: 1 })).status, 400, 'no payment beyond the current balance');
  // Refund of a POST-reset sale reduces the current wallet as before.
  const s4 = await sell(1, 150);           // +100
  await app.ok('/refunds', 'POST', { saleId: s4.id });  // -150
  v = await view();
  assert.equal(v.s.refunds.length, 2, 'refund history kept');
});

test('payments stay in history after Month Close archives them; reset state survives a server restart', async t => {
  const { app, agent, sell, pay, reset, view } = await setup(t);
  await sell(2);
  await pay(100, 'before month close');
  await app.ok('/month-close', 'POST', { label: 'Sep' });
  let v = await view();
  assert.equal(v.s.ledger.filter(l => l.type === 'PAYMENT').length, 0, 'Month Close moves payments into the archive (unchanged)');
  assert.deepEqual(v.history.map(h => [h.type, h.amount, h.archived]), [['Payment Sent', 100, true]], 'archived payment still visible');
  await reset();
  const saved = app.read();
  assert.equal(saved.walletResets.length, 1, 'reset stored in the data file');
  v = await view();
  assert.deepEqual(v.history.map(h => h.type), ['Wallet Reset', 'Payment Sent']);
});

test('older data without walletResets loads unchanged and gets an empty list', async t => {
  const legacy = { meta: { version: 1 }, agents: [{ id: 'a1', name: 'Old', companyId: 'c1', active: true }], companies: [{ id: 'c1', name: 'Old Co' }], accounts: [], products: [], productMaster: [], todaySales: [], salesHistory: [],
    ledger: [{ id: 'l1', agentId: 'a1', type: 'SALE', amount: 500, date: '2026-09-01' }, { id: 'l2', agentId: 'a1', type: 'SETTLEMENT', amount: 200, date: '2026-09-02', note: 'Wallet reset settlement' }, { id: 'l3', agentId: 'a1', type: 'PAYMENT', amount: 100, date: '2026-09-03', note: 'old' }],
    stockMovements: [], refunds: [], monthCloseArchive: [] };
  const app = await isolated(t, legacy);
  const s = await app.ok('/state');
  assert.deepEqual(s.walletResets, []);
  assert.deepEqual(agentWalletTotals(s.ledger, 'a1', s.walletResets), { due: 500, paid: 300, pending: 200 }, 'legacy SETTLEMENT still counts as credit');
  assert.equal(s.dueByAgent.a1, 200);
  assert.deepEqual(paymentHistory(s, 'a1').map(h => h.type), ['Payment Sent', 'Wallet Settlement (old reset)']);
  assert.equal(s.ledger.length, 3);
});
