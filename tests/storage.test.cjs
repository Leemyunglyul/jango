const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const backendDir = path.join(__dirname, '..', 'apps-script');
const backend = fs.readFileSync(path.join(backendDir, fs.readdirSync(backendDir).find((n) => n.endsWith('.gs'))), 'utf8');
function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing source section: ${start}`);
  return source.slice(from, to);
}

/* ── 앱: 무엇을 올리나 ─────────────────────────────────────── */
function app(ver) {
  const ctx = vm.createContext({});
  vm.runInContext(`
    const SYNC = { ver: ${ver} };
    const S = {
      settings: { cats: [], budgets: {}, recurring: [], quick: [], history: { '2026-09': { total: 1 } } },
      rec: {}, assets: [], investMonths: {},
      months: {
        '2026-09': { items: [{ id: 'a', d: '2026-09-02', c: 'food', a: 1, k: 'ex' }] },
        '2026-10': { items: [{ id: 'b', d: '2026-10-02', c: 'food', a: 2, k: 'ex' }] },
      },
    };
    const catById = (id) => ({ name: id });
    function assetRows() { return []; }
    function holdRows() { return []; }
    ${section(html, 'function txRows(', 'function assetRows()')}
    ${section(html, 'function settingsPart()', 'async function pushSheet(')}
  `, ctx);
  return (src) => JSON.parse(vm.runInContext(`JSON.stringify(${src})`, ctx));
}

test('a v7 sheet receives only the edited months and keeps monthly assets out of the settings cell', () => {
  const run = app(7);
  const parts = run(`buildParts(['month:2026-10', 'settings'])`);
  assert.equal(parts.tx, undefined);
  assert.deepEqual(Object.keys(parts.txMonths), ['2026-10']);
  assert.deepEqual(parts.txMonths['2026-10'].map((r) => r.id), ['b']);
  assert.equal(parts.settings.history, undefined);
  assert.deepEqual(parts.history, { '2026-09': { total: 1 } });
  /* 전체 올리기는 여전히 전부 보낸다 */
  assert.deepEqual(run(`buildParts(['month:*'])`).tx.map((r) => r.id), ['a', 'b']);
  /* 달에서 마지막 거래를 지우면 빈 목록을 보내 그 달을 비운다 */
  assert.deepEqual(run(`(S.months['2026-09'].items = [], buildParts(['month:2026-09']).txMonths)`), { '2026-09': [] });
});

test('an older sheet backend still gets the whole ledger and history inside settings', () => {
  const parts = app(6)(`buildParts(['month:2026-10', 'settings'])`);
  assert.deepEqual(parts.tx.map((r) => r.id), ['a', 'b']);
  assert.equal(parts.txMonths, undefined);
  assert.deepEqual(parts.settings.history, { '2026-09': { total: 1 } });
  assert.equal(parts.history, undefined);
});

/* ── Apps Script: 가짜 스프레드시트에서 실제 코드 실행 ───────────── */
function fakeSheet() {
  const rows = []; /* rows[0] = 머리글 */
  const sheet = {
    rows,
    getLastRow: () => rows.length,
    setFrozenRows() {}, setColumnWidth() {},
    getRange(r, c, nr = 1, nc = 1) {
      const range = {
        getValues: () => Array.from({ length: nr }, (_, i) =>
          Array.from({ length: nc }, (_, j) => ((rows[r - 1 + i] || [])[c - 1 + j] ?? ''))),
        setValues(vals) {
          vals.forEach((v, i) => { const row = rows[r - 1 + i] || (rows[r - 1 + i] = []); v.forEach((x, j) => (row[c - 1 + j] = x)); });
          return range;
        },
        clearContent() { for (let i = 0; i < nr; i++) if (rows[r - 1 + i]) rows[r - 1 + i] = rows[r - 1 + i].map(() => ''); return range; },
        setNumberFormat: () => range, setFontWeight: () => range, setBackground: () => range,
        sort() { const part = rows.slice(r - 1, r - 1 + nr).sort((a, b) => String(a[0]).localeCompare(String(b[0]))); rows.splice(r - 1, nr, ...part); return range; },
      };
      return range;
    },
  };
  /* clearContent 뒤 남은 빈 줄은 getLastRow에 안 잡히게 */
  const last = sheet.getLastRow;
  sheet.getLastRow = () => { while (rows.length && rows[rows.length - 1].every((x) => x === '')) rows.pop(); return last(); };
  return sheet;
}
function gas() {
  const sheets = {};
  const ctx = vm.createContext({
    SpreadsheetApp: { getActive: () => ({
      getSheetByName: (n) => sheets[n] || null,
      insertSheet: (n) => (sheets[n] = fakeSheet()),
      getSpreadsheetTimeZone: () => 'Asia/Seoul',
    }) },
    Utilities: {
      formatDate: (d) => d.toISOString().slice(0, 10),
      parseDate: (s) => s, /* 날짜를 문자열 그대로 둔다 — toISO가 앞 10자리를 읽는다 */
    },
  });
  vm.runInContext(backend, ctx);
  return { sheets, run: (src) => vm.runInContext(src, ctx) };
}
const row = (id, d, a) => ({ id, d, k: 'ex', cn: '식비', c: 'food', a, m: '', o: false });

test('the sheet replaces only the uploaded months of transactions and keeps everything else', () => {
  const g = gas();
  g.run(`writeTx(${JSON.stringify([row('a', '2025-01-03', 1), row('b', '2026-09-02', 2), row('c', '2026-10-01', 3), row('d', '2026-10-05', 4)])})`);
  g.run(`writeTxMonths(${JSON.stringify({ '2026-10': [row('e', '2026-10-09', 5)], '2026-08': [row('f', '2026-08-20', 6)] })})`);
  /* 실제 시트처럼 내용을 지운 끝줄은 빼고 읽는다 */
  const ids = () => (g.sheets['거래'].getLastRow(), g.sheets['거래'].rows.slice(1).map((r) => r[7]));
  assert.deepEqual(ids(), ['a', 'f', 'b', 'e']);
  g.run(`writeTxMonths({ '2026-09': [] })`);
  assert.deepEqual(ids(), ['a', 'f', 'e']);
  assert.equal(g.sheets['거래'].rows[3][2], '지출');
});

test('monthly assets get one row per month, update in place, never lose old months, and read back', () => {
  const g = gas();
  const h = (total) => ({ at: '2026-10-24', total, totalExReal: total - 1, invest: 50, principal: 40, g: { cash: 30, isa: 20, debt: -5 } });
  g.run(`writeHistory(${JSON.stringify({ '2026-10': h(100), '2025-01': h(70) })})`);
  g.run(`writeHistory(${JSON.stringify({ '2026-10': h(120) })})`);
  const tab = g.sheets['월별 자산'].rows;
  assert.equal(tab[0][0], '월');
  assert.deepEqual(tab.slice(1).map((r) => [r[0], r[2]]), [['2025-01', 70], ['2026-10', 120]]);
  const back = JSON.parse(g.run('JSON.stringify(readHistory())'));
  assert.deepEqual(back['2026-10'], { at: '2026-10-24', total: 120, totalExReal: 119, invest: 50, principal: 40, g: { cash: 30, isa: 20, debt: -5 } });
  assert.ok(back['2025-01']);
});

test('monthly investment records keep the whole-asset columns after a round trip', () => {
  const g = gas();
  g.run(`writeInvestMonths(${JSON.stringify({ '2026-09': { at: '2026-09-30', invest: 600, principal: 500, total: 3000, totalExReal: 2900, cash: 1500, housing: 900, holdings: [] } })})`);
  const back = JSON.parse(g.run('JSON.stringify(readInvestMonths())'));
  assert.equal(back['2026-09'].total, 3000);
  assert.equal(back['2026-09'].cash, 1500);
  assert.equal(back['2026-09'].housing, 900);
});
