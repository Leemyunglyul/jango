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
const code = [
  section('const daysIn =', 'const ymLabel'),
  section('const catById =', 'function allMonths()'),
  section('function budgetPace(', 'function missingRecurring('),
  section('function sniffDelim(', 'function groupFromLabel('),
  section('function matchCat(', 'function openImport()'),
  section('const Q_SCOPES', 'const LIST_LIMIT'),
].join('\n');

const cats = [
  { id: 'sal', name: '급여', kind: 'in' },
  { id: 'earn', name: '적립·할인·이자', kind: 'in', deduct: true },
  { id: 'food', name: '식비', kind: 'ex' },
  { id: 'fixed', name: '관리비', kind: 'ex' },
  { id: 'invest', name: '투자 납입', kind: 'inv' },
];

function harness({ months = {}, today = '2026-10-10', recurring = [], budgets = {} } = {}) {
  const ctx = vm.createContext({ structuredClone });
  vm.runInContext(`
    let n = 0;
    const uid = () => 'u' + (++n);
    const pad2 = (x) => String(x).padStart(2, '0');
    const ymOf = (d) => d.slice(0, 7);
    const todayISO = () => ${JSON.stringify(today)};
    const dirty = new Set();
    const UI = { month: ymOf(todayISO()), filter: 'all', q: '', qScope: 'month' };
    let S = { settings: { cats: ${JSON.stringify(cats)}, recurring: ${JSON.stringify(recurring)},
      budgets: ${JSON.stringify(budgets)} }, months: ${JSON.stringify(months)} };
    ${code}
  `, ctx);
  const run = (src) => vm.runInContext(src, ctx);
  return { run, json: (src) => JSON.parse(run(`JSON.stringify(${src})`)) };
}

test('spending total subtracts points, discounts and interest from gross spending', () => {
  const { run } = harness({ months: { '2026-08': { items: [
    { id: 1, d: '2026-08-01', c: 'sal', a: 3000000, k: 'in' },
    { id: 2, d: '2026-08-02', c: 'food', a: 100000, k: 'ex' },
    { id: 3, d: '2026-08-03', c: 'food', a: 50000, k: 'ex', o: true },
    { id: 4, d: '2026-08-04', c: 'earn', a: 4962, k: 'in' },
  ] } } });
  const s = run("summarize('2026-08')");
  assert.equal(s.net, 150000 - 4962);
  assert.equal(s.income, 3000000);
  assert.equal(s.once, 50000);
  assert.equal(s.byCat.food, 150000);
});

test('pasted spreadsheet text is split on tabs, CSV files on commas with quoted cells', () => {
  const { json } = harness();
  assert.deepEqual(json(`parseCSV("날짜\\t금액\\n2026-10-01\\t1,000")`), [['날짜', '금액'], ['2026-10-01', '1,000']]);
  assert.deepEqual(json(`parseCSV('a,b\\r\\n"x, ""y""",2')`), [['a', 'b'], ['x, "y"', '2']]);
});

test('a transaction list becomes month items with kinds taken from 구분 and categories', () => {
  const { json } = harness();
  const res = json(`importFlat(parseCSV("날짜,구분,분류,금액,메모,일회성\\n2026.10.01,지출,식비,\\"12,000\\",점심,\\n2026-10-02,수입,급여,3000000,,\\n2026-10-03,투자,ISA 이체,500000,,\\nbad,지출,식비,1,,"))`);
  const items = res.months['2026-10'].items;
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => [i.c, i.k, i.a]), [['food', 'ex', 12000], ['sal', 'in', 3000000], ['invest', 'inv', 500000]]);
  assert.equal(items[0].m, '점심');
});

test('a monthly pivot sheet becomes one item per row and month, skipping summary rows', () => {
  const { json } = harness();
  const res = json(`importPivot(parseCSV("항목\\t8월\\t9월(~9.5)\\n식비\\t100000\\t20000\\n수입\\t3000000\\t\\n관리비\\t98930\\t"), 2026)`);
  assert.deepEqual(Object.keys(res.months).sort(), ['2026-08', '2026-09']);
  assert.deepEqual(res.months['2026-08'].items.map((i) => [i.c, i.a]), [['food', 100000], ['fixed', 98930]]);
  assert.equal(res.months['2026-09'].items.length, 1);
});

test('importing into a month skips records that are already there, counting repeats', () => {
  const { json } = harness();
  const existing = [
    { id: 'a', d: '2026-10-01', c: 'food', a: 5000, m: '커피' },
    { id: 'b', d: '2026-10-01', c: 'food', a: 5000, m: '커피' },
  ];
  const incoming = [
    { id: 'x', d: '2026-10-01', c: 'food', a: 5000, m: '커피 ' },
    { id: 'y', d: '2026-10-01', c: 'food', a: 5000, m: '커피' },
    { id: 'z', d: '2026-10-01', c: 'food', a: 5000, m: '커피' },
    { id: 'w', d: '2026-10-02', c: 'food', a: 7000, m: '' },
  ];
  const r = json(`mergeImportItems(${JSON.stringify(existing)}, ${JSON.stringify(incoming)})`);
  assert.equal(r.skipped, 2);
  assert.equal(r.added, 2);
  assert.deepEqual(r.items.map((i) => i.id), ['a', 'b', 'z', 'w']);
});

test('search matches memo, category and amount words across the chosen range', () => {
  const months = {
    '2026-10': { items: [{ id: '1', d: '2026-10-03', c: 'food', a: 16400, m: '다이소', k: 'ex' }] },
    '2026-09': { items: [{ id: '2', d: '2026-09-03', c: 'food', a: 3000, m: '다이소 컵', k: 'ex' }] },
    '2026-07': { items: [{ id: '3', d: '2026-07-03', c: 'fixed', a: 98930, m: '', k: 'ex' }] },
    '2025-12': { items: [{ id: '4', d: '2025-12-03', c: 'food', a: 1000, m: '다이소', k: 'ex' }] },
  };
  const { run, json } = harness({ months });
  run(`UI.q = '다이소'`);
  assert.deepEqual(json('listItems().map(i => i.id)'), ['1']);
  run(`UI.qScope = '3m'`);
  assert.deepEqual(json('listItems().map(i => i.id)'), ['1', '2']);
  run(`UI.qScope = 'all'`);
  assert.deepEqual(json('listItems().map(i => i.id)'), ['1', '2', '4']);
  run(`UI.q = '관리비 98,930'`);
  assert.deepEqual(json('listItems().map(i => i.id)'), ['3']);
  run(`UI.q = '식비 컵'`);
  assert.deepEqual(json('listItems().map(i => i.id)'), ['2']);
});

test('budget pace projects month end and the day the budget runs out', () => {
  const months = { '2026-10': { items: [
    { id: '1', d: '2026-10-02', c: 'food', a: 30000, k: 'ex' },
    { id: '2', d: '2026-10-08', c: 'food', a: 20000, k: 'ex', o: true },
  ] } };
  const { json } = harness({ months, today: '2026-10-10', budgets: { food: 100000 } });
  const p = json(`budgetPace('2026-10', 'food', 100000)`);
  // 일회성 2만 원은 빼고 하루 3천 원 → 남은 21일 6.3만 원
  assert.equal(p.used, 50000);
  assert.equal(p.projected, 50000 + 3000 * 21);
  assert.equal(p.overDay, 10 + Math.ceil(50000 / 3000));
  assert.equal(json(`budgetWarnings('2026-10').length`), 1);
  assert.equal(json(`budgetPace('2026-09', 'food', 100000)`), null);
});

test('a fixed-cost category counts the rest of its recurring bill, not a daily pace', () => {
  const months = { '2026-10': { items: [] } };
  const { json } = harness({ months, today: '2026-10-10', recurring: [{ cat: 'fixed', amount: 100000 }] });
  const p = json(`budgetPace('2026-10', 'fixed', 90000)`);
  assert.equal(p.projected, 100000);
  assert.equal(p.overDay, null);
});
