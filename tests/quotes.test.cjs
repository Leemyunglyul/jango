const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const backendDir = path.join(__dirname, '..', 'apps-script');
const backend = fs.readFileSync(path.join(backendDir, fs.readdirSync(backendDir).find(n => n.endsWith('.gs'))), 'utf8');
function section(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}
function harness() {
  const context = vm.createContext({ structuredClone, Map, Date });
  vm.runInContext(`
    let S = { v: 5, assets: [], months: { '2026-09': { items: [{ amount: 123 }] } }, investMonths: {} };
    const SYNC = { url: 'test', stale: false };
    const saves = [];
    const notices = [];
    function persist(...keys) { saves.push(keys); }
    function render() {}
    function toast(message) { notices.push(message); }
    function esc(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
    function won(value) { return String(value); }
    ${section(html, 'const BUILTIN_QUOTE_SYMBOLS', 'function seed()')}
    ${section(html, 'function quoteSymbols', 'function txRows()')}
    ${section(html, 'function quoteMetaHtml', 'function holdListHtml')}
  `, context);
  return { context, run: (code) => vm.runInContext(code, context) };
}

test('KODEX names match regardless of spacing, case, and legacy TR suffix', () => {
  const h = harness();
  for (const name of ['KODEX 미국 나스닥100', 'KODEX 미국나스닥100', 'kodex 미국나스닥100', 'Kodex 미국나스닥100TR', 'KODEX 미국나스닥100(TR)'])
    assert.equal(h.run(`inferQuoteSymbol(${JSON.stringify(name)})`), 'KRX:379810');
  for (const name of ['KODEX 미국 S&P500', 'kodex 미국S&P500', 'KODEX 미국S&P500TR'])
    assert.equal(h.run(`inferQuoteSymbol(${JSON.stringify(name)})`), 'KRX:379800');
});

test('hedged, leveraged, and covered-call products are not mistaken for the base ETF', () => {
  const h = harness();
  for (const name of ['KODEX 미국나스닥100(H)', 'KODEX 미국나스닥100레버리지', 'KODEX 미국S&P500데일리커버드콜OTM'])
    assert.equal(h.run(`inferQuoteSymbol(${JSON.stringify(name)})`), '');
});

test('common Korean ticker formats resolve to the domestic quote route', () => {
  const h = harness();
  for (const code of ['379810', 'A379810', '379810.KS', ' krx : 379810 ', 'KOSPI:379810', "'379810", '３７９８１０', 'KODEX 미국나스닥100'])
    assert.equal(h.run(`normalizeQuoteSymbol(${JSON.stringify(code)})`), 'KRX:379810');
  assert.equal(h.run(`normalizeQuoteSymbol('247540.KQ')`), 'KOSDAQ:247540');
  assert.equal(h.run(`normalizeQuoteSymbol('005930')`), 'KRX:005930');
  assert.equal(h.run(`normalizeQuoteSymbol('qqq')`), 'NASDAQ:QQQ');
  assert.equal(h.run(`normalizeQuoteSymbol('NYSEARCA:VOO')`), 'NYSEARCA:VOO');
});

test('already migrated portfolios repair missing codes without changing holdings or historical data', () => {
  const h = harness();
  h.run(`S.assets = [{ group: 'isa', holdings: [
    { name: 'KODEX 미국나스닥100', symbol: '', qty: 42, price: 100, avg: 70 },
    { name: 'KODEX 미국S&P500', symbol: '379800', qty: 28, price: 200 },
    { name: 'KODEX 미국나스닥100', symbol: 'KRX:999999', qty: 1, price: 300 }
  ] }]; S.investMonths = { '2026-08': { holdings: [{ symbol: '' }], contrib: 500 } };`);
  const before = JSON.parse(h.run('JSON.stringify(S)'));
  assert.equal(h.run('migrate()'), true);
  const after = JSON.parse(h.run('JSON.stringify(S)'));
  assert.equal(after.assets[0].holdings[0].symbol, 'KRX:379810');
  assert.equal(after.assets[0].holdings[1].symbol, 'KRX:379800');
  assert.equal(after.assets[0].holdings[2].symbol, 'KRX:999999');
  for (let i = 0; i < 3; i++) {
    const { symbol: oldCode, ...oldHolding } = before.assets[0].holdings[i];
    const { symbol: newCode, ...newHolding } = after.assets[0].holdings[i];
    assert.deepEqual(newHolding, oldHolding);
  }
  assert.deepEqual(after.months, before.months);
  assert.deepEqual(after.investMonths, before.investMonths);
  assert.equal(h.run('migrate()'), false);
});

test('refresh repairs existing ISA codes, updates prices, and schedules upload', async () => {
  const h = harness();
  h.run(`S.assets = [{ holdings: [
    { name: 'Kodex 미국나스닥100', qty: 42, price: 1 },
    { name: 'KODEX 미국S&P500', symbol: '379800', qty: 28, price: 2 }
  ] }];`);
  let requested;
  h.context.gasCall = async (payload) => {
    requested = [...payload.symbols];
    return { quotes: [
      { symbol: 'KRX:379810', ok: true, price: 26015, marketPrice: 26015, currency: 'KRW', fxRate: 1 },
      { symbol: 'KRX:379800', ok: true, price: 23130, marketPrice: 23130, currency: 'KRW', fxRate: 1 },
    ] };
  };
  const result = await h.run('refreshQuotes()');
  assert.deepEqual(requested, ['KRX:379810', 'KRX:379800']);
  assert.equal(result.updated, 2);
  assert.equal(h.run('S.assets[0].holdings[0].price'), 26015);
  assert.equal(h.run('S.assets[0].holdings[1].price'), 23130);
  assert.equal(h.run('saves.length > 0'), true);
});

test('quote failure keeps the previous price and shows provider error rather than claiming the code is wrong', async () => {
  const h = harness();
  h.run(`S.assets = [{ holdings: [{ name: 'KODEX 미국나스닥100', symbol: 'KRX:379810', price: 25000 }] }];`);
  h.context.gasCall = async () => ({ quotes: [{ symbol: 'KRX:379810', ok: false, error: '국내 시세를 받지 못했습니다.' }] });
  const result = await h.run('refreshQuotes()');
  assert.equal(result.failed, 1);
  assert.equal(h.run('S.assets[0].holdings[0].price'), 25000);
  assert.match(h.run('quoteMetaHtml(S.assets[0].holdings[0])'), /국내 시세를 받지 못했습니다/);
  h.context.gasCall = async () => ({ quotes: [{ symbol: 'KRX:379810', ok: true, price: 26000 }] });
  await h.run('refreshQuotes()');
  assert.equal(h.run('quoteIssues.size'), 0);
});

test('existing Apps Script routes both KODEX ETF codes to Naver and parses ETF responses', () => {
  const urls = [];
  const context = vm.createContext({
    UrlFetchApp: { fetchAll: (requests) => {
      urls.push(...requests.map(r => r.url));
      return ['26,015', '23,130'].map((price, i) => ({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ stockEndType: 'etf', closePrice: price, localTradedAt: `2026-09-11T16:10:2${i + 1}+09:00` }),
      }));
    } },
  });
  vm.runInContext(section(backend, 'function readMarketQuotes', 'function readGoogleFinance'), context);
  vm.runInContext('function readGoogleFinance(symbols) { if (symbols.length) throw new Error("KODEX must not use GOOGLEFINANCE"); return []; }', context);
  const quotes = vm.runInContext(`readMarketQuotes(['KRX:379810', 'KRX:379800'])`, context);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].endsWith('/379810/basic'));
  assert.equal(quotes[0].price, 26015);
  assert.equal(quotes[1].price, 23130);
  assert.ok(quotes.every(q => q.ok && q.currency === 'KRW' && q.fxRate === 1));
});
