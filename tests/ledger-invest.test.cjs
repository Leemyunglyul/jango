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
  section('const catById =', 'function allMonths()'),
  section('function normalizeLedgerKinds()', 'function seed()'),
].join('\n');

function harness(cats, months = {}) {
  const ctx = vm.createContext({ structuredClone });
  vm.runInContext(`
    let n = 0;
    const uid = () => 'u' + (++n);
    let S = { settings: { cats: ${JSON.stringify(cats)}, recurring: [] }, months: ${JSON.stringify(months)} };
    ${code}
  `, ctx);
  return (src) => vm.runInContext(src, ctx);
}

const salary = { id: 's', d: '2026-10-01', c: 'sal', a: 3000000, k: 'in' };
const spend = { id: 'f', d: '2026-10-02', c: 'food', a: 400000, k: 'ex' };
const baseCats = [
  { id: 'sal', name: '급여', kind: 'in' },
  { id: 'earn', name: '적립·할인·이자', kind: 'in', deduct: true },
  { id: 'food', name: '식비', kind: 'ex' },
];

test('money moved to investments is neither income nor spending, but leaves the month balance', () => {
  const run = harness([...baseCats, { id: 'invest', name: '투자 납입', kind: 'inv' }], {
    '2026-10': { items: [salary, spend, { id: 'i', d: '2026-10-03', c: 'invest', a: 1000000, k: 'inv' }] },
  });
  const s = run("summarize('2026-10')");
  assert.equal(s.income, 3000000);
  assert.equal(s.net, 400000);
  assert.equal(s.invest, 1000000);
  assert.equal(s.saved, 2600000);
  assert.equal(s.left, 1600000);
});

test('an old income category named 투자 becomes an investment category and its records stop counting as income', () => {
  const run = harness([...baseCats, { id: 'cX', name: '투자', kind: 'in' }], {
    '2026-10': { items: [salary, { id: 'i', d: '2026-10-03', c: 'cX', a: 1000000, k: 'in' }] },
  });
  assert.equal(run("summarize('2026-10')").income, 4000000);
  const keys = run('normalizeLedgerKinds()');
  assert.deepEqual([...keys].sort(), ['month:2026-10', 'settings']);
  assert.equal(run("S.settings.cats.find(c => c.id === 'cX').kind"), 'inv');
  assert.equal(run("S.settings.cats.filter(c => c.kind === 'inv').length"), 1);
  const s = run("summarize('2026-10')");
  assert.equal(s.income, 3000000);
  assert.equal(s.invest, 1000000);
  assert.deepEqual([...run('normalizeLedgerKinds()')], []);
});

test('data without any investment category gets a default one; return-like income names are left alone', () => {
  const run = harness([...baseCats, { id: 'div', name: '투자수익·배당', kind: 'in' }]);
  run('normalizeLedgerKinds()');
  assert.equal(run("S.settings.cats.find(c => c.id === 'div').kind"), 'in');
  assert.deepEqual(JSON.parse(run("JSON.stringify(S.settings.cats.filter(c => c.kind === 'inv'))")),
    [{ id: 'invest', name: '투자 납입', kind: 'inv' }]);
});

test('records written by an older sheet script as 지출 are restored to investments from their category', () => {
  const run = harness([...baseCats, { id: 'invest', name: '투자 납입', kind: 'inv' }], {
    '2026-10': { items: [{ id: 'i', d: '2026-10-03', c: 'invest', a: 500000, k: 'ex', o: false }] },
  });
  assert.deepEqual([...run('normalizeLedgerKinds()')], ['month:2026-10']);
  assert.equal(run("S.months['2026-10'].items[0].k"), 'inv');
  assert.equal(run("summarize('2026-10').net"), 0);
});
