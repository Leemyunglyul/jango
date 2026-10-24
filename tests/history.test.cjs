const { test } = require('node:test');
const assert = require('node:assert/strict');
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
const code = section('function captureHistory()', '/* 모든 계좌의 종목을 하나로 모아 비중 계산 */');

function harness({ today = '2026-10-24', live, investMonths = {}, history } = {}) {
  const ctx = vm.createContext({ structuredClone });
  ctx.liveTotals = live || { total: 1000, totalExReal: 900, investTotal: 600, principal: 500, g: { cash: 400, isa: 600 } };
  vm.runInContext(`
    let S = { settings: { ${history ? `history: ${JSON.stringify(history)}` : ''} }, investMonths: ${JSON.stringify(investMonths)} };
    const UI = { month: '${today.slice(0, 7)}' };
    const GROUPS = [{ id: 'cash' }, { id: 'isa' }, { id: 'overseas' }];
    const todayISO = () => '${today}';
    const ymOf = (d) => d.slice(0, 7);
    const pad2 = (n) => String(n).padStart(2, '0');
    const shiftYM = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); };
    const ymLabel = (ym) => ym.replace('-', '.');
    const won = (n) => String(Math.round(n));
    const shortWon = won;
    const investTotals = () => liveTotals;
    const investmentHoldingSnapshot = () => [];
    const monthItems = (ym) => (S.months && S.months[ym] && S.months[ym].items) || [];
    ${code}
  `, ctx);
  return (src) => vm.runInContext(src, ctx);
}

test('the current month is recorded automatically and only rewritten when values change', () => {
  const run = harness();
  assert.equal(run('captureHistory()'), true);
  assert.deepEqual(JSON.parse(run("JSON.stringify(S.settings.history['2026-10'])")),
    { at: '2026-10-24', total: 1000, totalExReal: 900, invest: 600, principal: 500, g: { cash: 400, isa: 600 } });
  assert.equal(run('captureHistory()'), false);
  run('liveTotals.total = 1200; liveTotals.g.cash = 600;');
  assert.equal(run('captureHistory()'), true);
  assert.equal(run("S.settings.history['2026-10'].total"), 1200);
});

test('past months read the saved investment record first and fall back to the automatic history', () => {
  const run = harness({
    investMonths: { '2026-09': { at: '2026-09-30', invest: 700, principal: 650, total: 1500, totalExReal: 1400, cash: 800, isa: 700, holdings: [{ name: 'QQQ', value: 700 }] } },
    history: { '2026-08': { at: '2026-08-29', total: 1300, totalExReal: 1200, invest: 550, principal: 500, g: { cash: 750, isa: 550 } } },
  });
  const sep = JSON.parse(run("JSON.stringify(wealthAt('2026-09'))"));
  assert.equal(sep.source, 'record');
  assert.equal(sep.total, 1500);
  assert.equal(sep.g.cash, 800);
  assert.equal(sep.holdings.length, 1);
  const aug = JSON.parse(run("JSON.stringify(wealthAt('2026-08'))"));
  assert.equal(aug.source, 'auto');
  assert.equal(aug.total, 1300);
  assert.equal(aug.g.isa, 550);
  assert.equal(aug.holdings, null);
  assert.equal(run("wealthAt('2026-07')"), null);
  assert.equal(run("wealthAt('2026-11')"), null);
  assert.equal(run("wealthAt('2026-10').source"), 'live');
});

test('an old hand-entered record without account totals borrows asset totals from the automatic history', () => {
  const run = harness({
    investMonths: { '2026-09': { invest: 700, principal: 650 } },
    history: { '2026-09': { total: 1500, totalExReal: 1400, invest: 690, principal: 600, g: { cash: 800, isa: 700 } } },
  });
  const w = JSON.parse(run("JSON.stringify(wealthAt('2026-09'))"));
  assert.equal(w.source, 'record');
  assert.equal(w.hasAssets, true);
  assert.equal(w.total, 1500);
  assert.equal(w.invest, 700);
  assert.equal(w.principal, 650);
});

test('the trend strip keeps the recent window fixed and compares the selected month with the month before', () => {
  const values = { '2026-05': 100, '2026-06': 120, '2026-08': 90, '2026-09': 150, '2026-10': 180 };
  const run = harness();
  run(`UI.month = '2026-09';`);
  const markup = run(`trendStrip({ title: 't', get: (m) => (${JSON.stringify(values)})[m] ?? null, color: 'red' })`);
  const months = [...markup.matchAll(/data-goto="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(months, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.match(markup, /data-goto="2026-09" aria-current="true"/);
  assert.match(markup, /\+60 \(▲66\.7%\)/);
  run(`UI.month = '2026-03';`);
  const older = run(`trendStrip({ title: 't', get: () => null, color: 'red' })`);
  assert.deepEqual([...older.matchAll(/data-goto="([^"]+)"/g)].map((m) => m[1]).at(-1), '2026-03');
  assert.match(older, /이 달 기록 없음/);
});

const cols = (markup) => [...markup.matchAll(/data-goto="([^"]+)"[^>]*aria-label="([^ "]+) ([^"]+)"/g)].map((m) => [m[1], m[2], m[3]]);

test('long ranges drop per-bar numbers, label at most six months, and summarize the period in text', () => {
  const run = harness();
  run(`UI.trendRange = '3y';`);
  const markup = run(`trendStrip({ title: 't', get: (m) => m >= '2024-01' ? Number(m.slice(2, 4)) * 100 + Number(m.slice(5)) : null, color: 'red', kind: 'stock' })`);
  const bars = cols(markup);
  assert.equal(bars.length, 36);
  assert.equal(bars[0][0], '2023-11');
  assert.equal(bars.at(-1)[0], '2026-10');
  assert.doesNotMatch(markup, /class="tval/);
  const labels = [...markup.matchAll(/<span class="tm"><span>([^<]*)<\/span>/g)].map((m) => m[1]).filter(Boolean);
  assert.deepEqual(labels, ['24.04', '24.10', '25.04', '25.10', '26.04', '26.10']);
  assert.match(markup, /class="card trend dense"/);
  assert.match(markup, /data-trange="3y" aria-pressed="true"/);
  /* 2024.01(2401) → 2026.10(2610) */
  assert.match(markup, /<em>기간 변화<\/em><b[^>]*>\+209 \(▲8\.7%\)<\/b><small>2024\.01 → 2026\.10<\/small>/);
  assert.match(markup, /<em>최고<\/em><b>2610<\/b><small>2026\.10<\/small>/);
  assert.match(markup, /<em>최저<\/em><b>2401<\/b><small>2024\.01<\/small>/);

  run(`UI.trendRange = '6m';`);
  const short = run(`trendStrip({ title: 't', get: () => 5, color: 'red' })`);
  assert.equal((short.match(/class="tval/g) || []).length, 6);
  assert.match(short, /<em>월평균<\/em><b>5<\/b>/);
});

test('yearly view sums flows, keeps year-end balances, and compares this year with the same months last year', () => {
  const flow = { '2024-03': 100, '2024-11': 50, '2025-02': 70, '2025-10': 30, '2025-12': 500, '2026-01': 40, '2026-09': 60 };
  const run = harness({ investMonths: { '2024-03': {} } });
  run(`UI.trendRange = 'yr';`);
  const markup = run(`trendStrip({ title: 't', get: (m) => (${JSON.stringify(flow)})[m] ?? null, color: 'red' })`);
  assert.deepEqual(cols(markup).map((c) => [c[0], c[2]]), [['2024-12', '150원'], ['2025-12', '600원'], ['2026-10', '100원']]);
  /* 2026년 1~10월(100) vs 2025년 1~10월(100) */
  assert.match(markup, /2026년 1~10월/);
  assert.match(markup, /±0 \(▲0\.0%\)<\/span><span class="mm">작년 같은 기간 대비/);

  const stock = { '2024-06': 1000, '2024-12': 1200, '2025-05': 1500, '2025-12': 1800, '2026-08': 2100 };
  const st = run(`trendStrip({ title: 't', get: (m) => (${JSON.stringify(stock)})[m] ?? null, color: 'red', kind: 'stock' })`);
  assert.deepEqual(cols(st).map((c) => c[2]), ['1200원', '1800원', '2100원']);
  assert.match(st, /\+300 \(▲16\.7%\)<\/span><span class="mm">작년 말 대비/);

  run(`UI.month = '2025-04';`);
  const past = run(`trendStrip({ title: 't', get: (m) => (${JSON.stringify(flow)})[m] ?? null, color: 'red' })`);
  assert.match(past, /data-goto="2025-12" aria-current="true"/);
  assert.match(past, /\+450 \(▲300\.0%\)<\/span><span class="mm">작년 대비/);
});
