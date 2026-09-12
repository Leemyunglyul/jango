const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function section(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return html.slice(from, to);
}
const syncCode = [
  section('function loadLocal()', '/* ══════════ 화면 테마'),
  section('const NEED_SCRIPT_VERSION', 'function quoteSymbols'),
  section('function settingsPart()', 'async function connectDB()'),
  section('const resumeSync =', 'if ("serviceWorker"'),
].join('\n');

function harness(saved) {
  const storage = new Map(saved ? [['jango.v1', saved]] : []);
  const timers = new Map();
  const events = {};
  const calls = [];
  const chip = { dataset: {}, setAttribute() {} };
  let timerId = 0;
  const ctx = vm.createContext({
    structuredClone, AbortController, console: { warn() {} },
    navigator: { onLine: true },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      getElementById: () => chip,
      visibilityState: 'visible',
      addEventListener: (name, fn) => { events[name] = fn; },
    },
    window: { addEventListener: (name, fn) => { events[name] = fn; } },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(`
    const LSKEY = 'jango.v1';
    const SEED_SETTINGS = { quick: [] };
    let DB = null;
    function seed() {
      return { rev: 0, settings: { cats: [{ id: 'food' }], budgets: {}, recurring: [], quick: [] },
        assets: [], months: {}, investMonths: {}, rec: {} };
    }
    let S = seed();
    function migrate() { return false; }
    function recalcInvestmentMonths() {}
    function render() {}
    function txRows() { return Object.values(S.months).flatMap(m => m.items); }
    function assetRows() { return S.assets; }
    function holdRows() { return []; }
    ${syncCode}
    ${section('S = loadLocal();', 'if (!S.settings.quick)')}
    SYNC.url = 'https://example.invalid/sheet';
    SYNC.ready = true;
  `, ctx);
  ctx.gasCall = async (payload) => {
    calls.push(structuredClone(payload));
    return { ok: true, rev: payload.rev, version: 6 };
  };
  const run = (code) => vm.runInContext(code, ctx);
  return {
    ctx, storage, timers, calls, events, chip, run,
    json: (code) => JSON.parse(run(`JSON.stringify(${code})`)),
    tick(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `Expected timer with delay ${delay}; got ${[...timers.values()].map(t => t.delay)}`);
      timers.delete(entry[0]);
      return entry[1].fn();
    },
  };
}

test('every inline script parses', () => {
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))
    new vm.Script(script);
});

test('net worth baseline is included in sheet settings and restored on download', async () => {
  const h = harness();
  h.run(`S.settings.wealthBaseline = { at: '2026-09-01', total: 190000000, totalExReal: 30000000 }; persist('settings');`);
  await h.tick(1000);
  assert.equal(h.calls[0].parts.settings.wealthBaseline.total, 190000000);
  h.ctx.remoteSettings = h.calls[0].parts.settings;
  h.run(`S.settings.wealthBaseline = null; adoptRemote({ settings: remoteSettings }, 2);`);
  assert.equal(h.run('S.settings.wealthBaseline.totalExReal'), 30000000);
});

test('successive edits persist immediately and upload as one batch after one second', async () => {
  const h = harness();
  h.run(`S.months['2026-09'] = { items: [{ amount: 100 }] }; persist('month:2026-09');
    S.assets = [{ value: 200 }]; persist('assets');`);
  assert.equal(h.timers.size, 1);
  assert.equal(h.run('SYNC.state'), 'pending');
  assert.deepEqual(JSON.parse(h.storage.get('jango.v1'))._pendingSync, ['month:2026-09', 'assets']);
  await h.tick(1000);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].parts.tx[0].amount, 100);
  assert.equal(h.calls[0].parts.assets[0].value, 200);
  assert.equal(h.run('SYNC.state'), 'ok');
  assert.deepEqual(JSON.parse(h.storage.get('jango.v1'))._pendingSync, []);
});

test('edits made while a request is in flight are sent next without rolling back rev', async () => {
  const h = harness();
  let reply;
  h.ctx.gasCall = (payload) => {
    h.calls.push(structuredClone(payload));
    return new Promise(resolve => { reply = resolve; });
  };
  h.run(`S.assets = [{ value: 100 }]; persist('assets');`);
  const first = h.tick(1000);
  h.run(`S.assets[0].value = 300; persist('assets'); persist('settings');`);
  await h.tick(1000); // This timer used to be silently lost while busy.
  assert.equal(h.calls.length, 1);
  assert.equal(JSON.parse(h.storage.get('jango.v1')).assets[0].value, 300);
  reply({ ok: true, rev: 1 });
  assert.equal(await first, false);
  assert.equal(h.run('S.rev'), 3);
  const second = h.tick(0);
  assert.equal(h.calls[1].parts.assets[0].value, 300);
  assert.ok(h.calls[1].parts.settings);
  reply({ ok: true, rev: 3 });
  assert.equal(await second, true);
  assert.equal(h.run('dirty.size + sheetInFlight.size'), 0);
});

test('failed uploads retain their queue and retry without another edit', async () => {
  const h = harness();
  h.ctx.gasCall = async () => { throw new Error('network failure'); };
  h.run(`persist('settings')`);
  assert.equal(await h.tick(1000), false);
  assert.equal(h.run('SYNC.state'), 'err');
  assert.equal(h.run('pushMessage(false).includes("올렸어요")'), false);
  assert.deepEqual(JSON.parse(h.storage.get('jango.v1'))._pendingSync, ['settings']);
  h.ctx.gasCall = async () => ({ ok: true, rev: 1 });
  assert.equal(await h.tick(3000), true);
  assert.equal(h.run('SYNC.state'), 'ok');
});

test('offline edits upload on reconnection without further user changes', async () => {
  const h = harness();
  h.ctx.navigator.onLine = false;
  h.run(`persist('assets')`);
  await h.tick(1000);
  assert.equal(h.calls.length, 0);
  assert.equal(h.run('SYNC.state'), 'offline');
  h.ctx.navigator.onLine = true;
  h.events.online();
  await h.tick(0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.run('dirty.size'), 0);
});

test('restart restores even in-flight monthly edits and protects them from higher remote rev', async () => {
  const h = harness();
  h.ctx.gasCall = () => new Promise(() => {});
  h.run(`S.investMonths['2026-09'] = { contrib: 500 }; persist('investMonth:2026-09');`);
  h.tick(1000);
  h.events.pagehide();
  const restarted = harness(h.storage.get('jango.v1'));
  restarted.run('SYNC.ready = false');
  const remote = restarted.json('seed()');
  remote.investMonths = { '2026-08': { contrib: 100 }, '2026-09': { contrib: 0 } };
  restarted.ctx.gasCall = async (payload) => {
    restarted.calls.push(structuredClone(payload));
    return { ok: true, version: 6, rev: 99, data: remote };
  };
  await restarted.run('syncBoot()');
  assert.equal(restarted.run(`S.investMonths['2026-09'].contrib`), 500);
  assert.equal(restarted.run(`S.investMonths['2026-08'].contrib`), 100);
  await restarted.tick(0);
  const save = restarted.calls.find(c => c.action === 'save');
  assert.deepEqual(save.parts.investMonths, { '2026-09': { contrib: 500 } });
  assert.equal(restarted.run('SYNC.state'), 'ok');
});

test('edits during initial download are preserved and upload waits for download completion', async () => {
  const h = harness();
  h.run('SYNC.ready = false');
  let reply;
  const remote = h.json('seed()');
  h.ctx.gasCall = async (payload) => {
    h.calls.push(structuredClone(payload));
    if (payload.action === 'load') return new Promise(resolve => { reply = resolve; });
    return { ok: true, version: 6, rev: payload.rev };
  };
  const boot = h.run('syncBoot()');
  await Promise.resolve();
  h.run(`S.assets = [{ value: 800 }]; persist('assets');`);
  await h.tick(1000);
  assert.equal(h.calls.some(c => c.action === 'save'), false);
  reply({ ok: true, rev: 50, data: remote });
  await boot;
  assert.equal(h.run('S.assets[0].value'), 800);
  await h.tick(0);
  assert.equal(h.calls.find(c => c.action === 'save').parts.assets[0].value, 800);
});

test('clean startup still downloads direct sheet edits with the same revision', async () => {
  const h = harness();
  const remote = h.json('seed()');
  remote.settings.budgets = { food: 999 };
  h.ctx.gasCall = async () => ({ ok: true, version: 6, rev: 0, data: remote });
  await h.run('syncBoot()');
  assert.equal(h.run('S.settings.budgets.food'), 999);
  assert.equal(h.timers.size, 0);
});

test('failed boot retries download before uploading local changes', async () => {
  const h = harness();
  h.run(`SYNC.ready = false; persist('assets');`);
  h.ctx.gasCall = async () => { throw new Error('unavailable'); };
  await h.tick(1000);
  assert.equal(h.run('SYNC.ready'), false);
  h.ctx.gasCall = async (payload) => {
    h.calls.push(structuredClone(payload));
    return { ok: true, version: 6, rev: 0, data: h.json('seed()') };
  };
  await h.tick(3000);
  assert.deepEqual(h.calls.map(c => c.action), ['ping', 'load']);
  await h.tick(0);
  assert.equal(h.calls[2].action, 'save');
});

test('manual full upload includes pending months without re-uploading untouched history', async () => {
  const h = harness();
  h.run(`S.investMonths = { '2026-08': { contrib: 1 }, '2026-09': { contrib: 2 } };
    persist('investMonth:2026-09');`);
  await h.run('pushSheet(true)');
  assert.deepEqual(h.calls[0].parts.investMonths, { '2026-09': { contrib: 2 } });
  assert.ok(h.calls[0].parts.settings);
  assert.ok(h.calls[0].parts.assets);
  assert.ok(h.calls[0].parts.tx);
});

test('manual upload during an active request is queued and never reports completion early', async () => {
  const h = harness();
  let reply;
  h.ctx.gasCall = () => new Promise(resolve => { reply = resolve; });
  h.run(`persist('assets')`);
  const first = h.tick(1000);
  assert.equal(await h.run('pushSheet(true)'), false);
  reply({ ok: true, rev: 1 });
  await first;
  assert.ok([...h.timers.values()].some(timer => timer.delay === 0));
  assert.deepEqual(h.json('[...dirty]'), ['month:*', 'settings', 'assets']);
});

test('request timeout releases a stuck upload and keeps it available for retry', async () => {
  const h = harness();
  vm.runInContext(section('async function gasCall(', 'function quoteSymbols'), h.ctx);
  h.ctx.fetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('timeout')));
  });
  h.run(`persist('settings')`);
  const request = h.tick(1000);
  h.tick(45000);
  assert.equal(await request, false);
  assert.equal(h.run('SYNC.busy'), false);
  assert.deepEqual(h.json('[...dirty]'), ['settings']);
  assert.ok([...h.timers.values()].some(timer => timer.delay === 3000));
});
