const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function context(months = {}) {
  const c = vm.createContext({ S: { investMonths: months }, Date });
  const start = html.indexOf('function netWorthGrowth(');
  const end = html.indexOf('function wealthGrowthHtml(', start);
  vm.runInContext(`const todayISO = () => '2026-09-12'; const ymOf = d => d.slice(0,7); const pad2 = n => String(n).padStart(2,'0');` + html.slice(start, end), c);
  return c;
}
test('net worth growth includes savings and measures the saved baseline', () => {
  const c = context();
  assert.equal(vm.runInContext('netWorthGrowth(214000000,190000000).delta', c), 24000000);
  assert.equal(vm.runInContext('netWorthGrowth(214000000,190000000).rate', c), 24000000 / 190000000);
  assert.equal(vm.runInContext('netWorthGrowth(54000000,30000000).rate', c), .8);
});
test('missing, zero, and negative baselines do not produce misleading percentages', () => {
  const c = context();
  for (const base of ['null', 'undefined', '0', '-100'])
    assert.equal(vm.runInContext(`netWorthGrowth(100,${base}).rate`, c), null);
  assert.equal(vm.runInContext('netWorthGrowth(100,-100).delta', c), 200);
});
test('investment performance removes cash contributions and withdrawals', () => {
  const c = context({ '2026-08': { invest: 1000 }, '2026-09': { invest: 1300, contrib: 200, withdrawal: 50 } });
  const result = vm.runInContext('latestInvestmentPerformance()', c);
  assert.equal(result.gain, 150);
  assert.equal(result.rate, 150 / 1075);
  const contributionOnly = context({ '2026-08': { invest: 1000 }, '2026-09': { invest: 1200, contrib: 200 } });
  assert.equal(vm.runInContext('latestInvestmentPerformance().rate', contributionOnly), 0);
});
test('investment return requires consecutive saved months and a positive denominator', () => {
  for (const months of [
    { '2026-09': { invest: 1000 } },
    { '2026-07': { invest: 1000 }, '2026-09': { invest: 1200 } },
    { '2026-08': { invest: 0 }, '2026-09': { invest: 100 } },
  ]) assert.equal(vm.runInContext('latestInvestmentPerformance()', context(months)), null);
});
