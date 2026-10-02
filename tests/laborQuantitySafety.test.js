const assert = require('assert');
const { buildAuthoritativeLaborFact, applyAuthoritativeLaborInvariant } = require('../server');
describe('labor quantity safety', () => {
  it('preserves material quantities when distributing labor across trade rows', () => {
    const parsed = { lineItems: [
      { qty: 400, unit: 'ft', laborHours: 24 },
      { qty: 8, unit: 'ea', laborHours: 8 }
    ] };
    applyAuthoritativeLaborInvariant(parsed, { isResolved: true, totalHours: 16 });
    assert.deepStrictEqual(parsed.lineItems.map(li => li.qty), [400, 8]);
    assert.strictEqual(parsed.lineItems.reduce((sum, li) => sum + li.laborHours, 0), 16);
  });
  it('recognizes decimal hour durations and hour abbreviations', () => {
    assert.strictEqual(buildAuthoritativeLaborFact('2 workers for 2.5 hrs', []).totalHours, 5);
  });
});
