const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('function investmentPrincipalBasis('), html.indexOf('/* ============================== 가져오기'));

function harness(months = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { value: '', setAttribute() {}, focus() {} });
    return elements.get(id);
  };
  const saved = [];
  const ctx = vm.createContext({
    S: { investMonths: structuredClone(months), assets: [] }, SYNC: {}, GROUPS: [],
    $: element, todayISO: () => '2026-09-27', ymOf: d => d.slice(0, 7),
    ymLabel: ym => ym, won: String, esc: String,
    daysIn: () => 30, pad2: n => String(n).padStart(2, '0'),
    investTotals: () => ({ contrib: 0, principal: 99999 }),
    buildInvestmentRecord: (ym, input) => ({ principal: 99999, invest: 5000, holdings: [], ...input }),
    openSheet: (markup, after) => {
      element('#im_m').value = markup.match(/id="im_m"[^>]*value="([^"]*)"/)[1];
      after();
    },
    recalcInvestmentMonths() {}, persist: (...keys) => saved.push(keys),
    closeSheet() {}, render() {}, toast() {},
  });
  vm.runInContext(source, ctx);
  return { ctx, element, saved, run: code => vm.runInContext(code, ctx) };
}

test('new month carries the latest earlier principal and updates as cash flows change', async () => {
  const h = harness({ '2026-08': { principal: 1000 }, '2026-10': { principal: 8000 } });
  h.run('openInvestmentMonthSheet()');
  assert.equal(h.element('#im_p').value, 1000);
  assert.equal(h.element('#im_p').readOnly, true);
  h.element('#im_c').value = '200'; h.element('#im_c').oninput();
  h.element('#im_w').value = '50'; h.element('#im_w').oninput();
  assert.equal(h.element('#im_p').value, 1150);
  await h.element('#im_save').onclick();
  assert.equal(h.ctx.S.investMonths['2026-09'].principal, 1150);
  assert.equal(h.ctx.S.investMonths['2026-08'].principal, 1000);
  assert.deepEqual(h.saved[0], ['investMonth:2026-09', 'assets']);
});

test('editing a saved current month preserves corrected principal and applies only the cash-flow difference', async () => {
  const h = harness({ '2026-09': { principal: 1200, contrib: 250, withdrawal: 50 } });
  h.run("openInvestmentMonthSheet('2026-09')");
  assert.equal(h.element('#im_p').value, 1200);
  h.element('#im_c').value = '350'; h.element('#im_c').oninput();
  assert.equal(h.element('#im_p').value, 1300);
  await h.element('#im_save').onclick();
  h.run("openInvestmentMonthSheet('2026-09')");
  assert.equal(h.element('#im_p').value, 1300);
});

test('manual corrections survive input changes and become the next month basis', async () => {
  const h = harness();
  h.run("openInvestmentMonthSheet('2026-08')");
  h.element('#im_p_toggle').onclick();
  assert.equal(h.element('#im_p').readOnly, false);
  h.element('#im_p').value = '6000';
  h.element('#im_c').value = '500'; h.element('#im_c').oninput();
  assert.equal(h.element('#im_p').value, '6000');
  await h.element('#im_save').onclick();
  h.run('openInvestmentMonthSheet()');
  assert.equal(h.element('#im_p').value, 6000);
});

test('automatic mode can be restored and month changes reset the calculation basis', () => {
  const h = harness({ '2026-07': { principal: 1000 }, '2026-08': { principal: 2000 } });
  h.run('openInvestmentMonthSheet()');
  h.element('#im_p_toggle').onclick(); h.element('#im_p').value = '9999';
  h.element('#im_p_toggle').onclick();
  assert.equal(h.element('#im_p').value, 2000);
  h.element('#im_m').value = '2026-06'; h.element('#im_m').onchange();
  assert.equal(h.element('#im_p').value, 0);
  assert.match(h.element('#im_p_hint').textContent, /첫 기록/);
  h.element('#im_c').value = '300'; h.element('#im_c').oninput();
  assert.equal(h.element('#im_p').value, 300);
  h.element('#im_w').value = '500'; h.element('#im_w').oninput();
  assert.equal(h.element('#im_p').value, 0);
});

test('moving a month excludes the removed source month from the carried principal', () => {
  const h = harness({ '2026-07': { principal: 1000 }, '2026-08': { principal: 2000 } });
  h.run("openInvestmentMonthSheet('2026-08')");
  h.element('#im_m').value = '2026-09'; h.element('#im_m').onchange();
  assert.equal(h.element('#im_p').value, 1000);
});
