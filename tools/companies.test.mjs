// Integration tests always run a copied server with its own data/backups/exports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { dashboardStats } from '../client/src/dashboardStats.js';
const root = path.resolve(import.meta.dirname, '..');
// Synthetic demo business (no real data): tools/fixtures/business/{data,backups/month-close,exports}.
const livePath = path.join(root, 'tools/fixtures/business/data/stockpilot.json');
const original = fs.readFileSync(livePath);
const live = JSON.parse(original);

async function isolated(t, initial) {
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'tmp/company-test-'));
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

test('fresh installation has no personal companies; one company and arbitrary additional companies work', async t => {
  const app = await isolated(t);
  const fresh = await app.ok('/state');
  assert.deepEqual(fresh.companies, []);
  assert.deepEqual(fresh.accounts, []);
  const first = await app.ok('/companies', 'POST', { name: 'ABC Traders' });
  assert(first.id.startsWith('co_'));
  const a = await app.ok('/agents', 'POST', { name: 'First Agent', companyId: first.id });
  assert.equal(a.companyId, first.id);
  assert.equal((await app.ok('/state')).accounts.filter(x => x.agentId === a.id).length, 3);
  for (let i = 0; i < 5; i++) await app.ok('/companies', 'POST', { name: `User Company ${i}` });
  assert.equal((await app.ok('/state')).companies.length, 6);
  assert.equal((await app.request('/companies', 'POST', { name: ' abc traders ' })).status, 400);
  assert.equal((await app.request('/companies', 'POST', { name: '  ' })).status, 400);
});

test('existing IDs/relationships survive load; fourth company can trade, rename, archive; unused company deletes', async t => {
  const app = await isolated(t, live);
  const before = await app.ok('/state');
  for (const [key, value] of Object.entries(live)) assert.deepEqual(before[key], value, `Existing ${key} changed on load`);
  const company = await app.ok('/companies', 'POST', { name: 'Fourth Test Company' });
  const agent = await app.ok('/agents', 'POST', { name: 'Fourth Test Agent', companyId: company.id });
  const state = await app.ok('/state');
  const product = state.products.find(p => p.active !== false && p.stock > 0);
  assert(product, 'Copy must have a stocked product');
  const account = state.accounts.find(a => a.agentId === agent.id && a.marketplace === 'Amazon');
  const mapping = await app.ok('/product-master', 'POST', { companyId: company.id, marketplace: 'Amazon', code: product.sku, sku: 'FOURTH-TEST-SKU', name: product.name });
  const row = { agentId: agent.id, accountId: account.id, productId: product.id, qty: 1, saleAmount: 321, orderId: 'COMPANY-TEST-ORDER', source: 'manual' };
  await app.ok('/sales', 'POST', [row]);
  const preRename = app.read();
  const renamed = await app.ok(`/companies/${company.id}`, 'PUT', { name: 'Renamed Fourth Company' });
  assert.equal(renamed.id, company.id);
  for (const key of Object.keys(preRename).filter(k => k !== 'companies')) assert.deepEqual(app.read()[key], preRename[key], `Rename altered ${key}`);
  const removed = await app.ok(`/companies/${company.id}`, 'DELETE');
  assert.equal(removed.deactivated, true);
  const archived = await app.ok('/state');
  assert.equal(archived.companies.find(c => c.id === company.id).active, false);
  assert.equal(archived.agents.find(a => a.id === agent.id).companyId, company.id);
  assert.equal(archived.productMaster.find(m => m.id === mapping.id).companyId, company.id);
  const sale = archived.todaySales.find(s => s.orderId === row.orderId);
  assert.equal(sale.companyId, company.id);
  const dash = dashboardStats(archived, sale.date.slice(0, 7));
  assert.equal(dash.companies.find(c => c.id === company.id).name, renamed.name);
  assert(dash.companies.find(c => c.id === company.id).sales >= 321);
  const bytes = fs.readFileSync(app.file);
  for (const [route, body] of [
    ['/sales', [row]],
    ['/payments', {agentId: agent.id, amount: 1}],
    ['/agents', { name: 'Blocked Agent', companyId: company.id }],
    ['/agents', { name: 'Blocked Legacy Agent', companyName: renamed.name }],
    [`/agents/${agent.id}/company`, { companyId: company.id }],
    ['/product-master', { companyId: company.id, marketplace: 'Amazon', code: product.sku, sku: 'BLOCKED', name: product.name }],
    [`/product-master/${mapping.id}/product`, {productId:product.id, updateName:true}]
  ]) assert.equal((await app.request(route, 'POST', body)).status, 400, route);
  assert(fs.readFileSync(app.file).equals(bytes), 'Rejected operations must not save');
  const unused = await app.ok('/companies', 'POST', { name: 'Unused Test Company' });
  assert.equal((await app.ok(`/companies/${unused.id}`, 'DELETE')).deleted, true);
  assert(!app.read().companies.some(c => c.id === unused.id));
  for (const c of live.companies) assert.deepEqual(app.read().companies.find(x => x.id === c.id), c);

  // Existing Month Close rules still work, and a failed snapshot never resets data.
  const snapshotDir = path.join(app.dir, 'backups/month-close');
  fs.writeFileSync(snapshotDir, 'force archive failure');
  const beforeClose = fs.readFileSync(app.file);
  assert.equal((await app.request('/month-close', 'POST', {})).status, 400);
  assert(fs.readFileSync(app.file).equals(beforeClose));
  fs.unlinkSync(snapshotDir);
  const closed = await app.ok('/month-close', 'POST', { label: 'Company compatibility test' });
  const snapshot = JSON.parse(fs.readFileSync(path.join(app.dir, closed.file)));
  assert.deepEqual(snapshot.sales, [...JSON.parse(beforeClose).todaySales, ...JSON.parse(beforeClose).salesHistory]);
  assert.equal(app.read().todaySales.length, 0);
  assert.equal(app.read().salesHistory.length, 0);
});

test('references in archives and other nested records prevent hard deletion', async t => {
  const app = await isolated(t);
  for (const key of ['monthCloseArchive', 'refunds', 'ledger', 'accounts', 'productMaster', 'salesHistory', 'todaySales', 'stockMovements', 'correctionLog']) {
    const c = await app.ok('/companies', 'POST', { name: `Referenced by ${key}` });
    const db = app.read();
    (db[key] ||= []).push({ id: `test-${key}`, nested: { companyId: c.id } });
    fs.writeFileSync(app.file, JSON.stringify(db));
    assert.equal((await app.ok(`/companies/${c.id}`, 'DELETE')).deactivated, true, key);
    assert.deepEqual(app.read()[key], db[key]);
  }
});
