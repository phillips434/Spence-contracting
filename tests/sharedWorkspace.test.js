const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
function source(name) {
  const start = html.indexOf('function ' + name + '(');
  const end = html.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start, 'Missing function ' + name);
  return html.slice(start, end);
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(uid = 'office') {
  const records = { projects: new Map(), estimates: new Map() };
  const profiles = { office: { plan: 'team', ownerUid: 'company-owner' }, 'company-owner': { plan: 'owner' } };
  const values = { efClient: 'Office customer', efType: 'Kitchen', efProjectClass: 'residential', efMarkup: '20', efTax: '0', efStatus: 'Draft', fClient: 'Office customer', fType: 'Kitchen', fBudget: '1000', fSpent: '0' };
  const nodes = {};
  const collection = name => ({
    doc: id => ({
      get: async () => ({ exists: !!profiles[id], data: () => profiles[id] || {} }),
      set: async record => records[name].set(id, JSON.parse(JSON.stringify(record)))
    }),
    orderBy: () => ({ onSnapshot: callback => {
      const map = records[name];
      callback({ empty: !map.size, forEach: fn => map.forEach((record, id) => fn({ id, data: () => record })) });
      return () => {};
    } })
  });
  const c = { currentUser: { uid }, DD: {}, projects: [], estimates: [], editEstId: null, editId: null, currentId: null,
    currentEstId: null, selColor: 0, COLORS: ['blue'], mainTabMode: 'estimates', unsubProjects: null, unsubEstimates: null,
    document: { getElementById: id => nodes[id] || (nodes[id] = { value: values[id] || '', classList: { remove() {}, contains: () => false } }) },
    db: { collection }, col: collection('projects'), eCol: collection('estimates'),
    nextEstNumber: () => 'EST-TEAM', nextJobNumber: () => 'JOB-TEAM', T() {}, pushNotification() {},
    openEstDetail() {}, openDetail() {}, renderAll() {}, renderEstCards() {}, setSS() {},
    alert(message) { throw Error(message); }, setTimeout: fn => { fn(); return 0; }, console
  };
  c.ger = () => c.estimates.find(e => e.id === c.currentEstId);
  c.gpr = () => c.projects.find(p => p.id === c.currentId);
  vm.createContext(c);
  for (const name of ['normalizeProjectClass', 'resolveCurrentOwnerUid', 'withSharedOwnerMetadata', 'saveEstimate', 'saveProject', '_startSyncWithOwner']) vm.runInContext(source(name), c);
  return { c, records, nodes };
}
describe('shared company workspace save and visibility', () => {
  for (const kind of ['estimate', 'project']) {
    it('office-created ' + kind + ' saves under the company and is visible to owner and office', async () => {
      const { c, records } = fixture();
      c[kind === 'estimate' ? 'saveEstimate' : 'saveProject']();
      await flush();
      const saved = Array.from(records[kind + 's'].values())[0];
      assert.ok(saved, 'Expected an actual saved record');
      assert.strictEqual(saved.userId, 'company-owner');
      assert.strictEqual(saved.ownerUid, 'company-owner');
      assert.strictEqual(saved.createdByUid, 'office');
      assert.strictEqual(saved.updatedByUid, 'office');
      records[kind + 's'].set('unrelated', { id: 'unrelated', userId: 'another-company', createdAt: 1 });
      for (const uid of ['company-owner', 'office']) {
        c.currentUser = { uid };
        c._startSyncWithOwner('company-owner', true);
        assert.strictEqual(c[kind + 's'].length, 1, 'Expected shared visibility without another company');
        assert.strictEqual(c[kind + 's'][0].id, saved.id);
      }
    });
    it('owner-created ' + kind + ' is visible to office without changing its owner', async () => {
      const { c, records } = fixture('company-owner');
      c[kind === 'estimate' ? 'saveEstimate' : 'saveProject'](); await flush();
      const saved = Array.from(records[kind + 's'].values())[0];
      assert.strictEqual(saved.ownerUid, 'company-owner');
      c.currentUser = { uid: 'office' }; c._startSyncWithOwner('company-owner', true);
      assert.strictEqual(c[kind + 's'][0].id, saved.id);
    });
  }
  it('office edits preserve company ownership and original creator', async () => {
    const { c } = fixture();
    const original = { id: 'existing', userId: 'company-owner', ownerUid: 'company-owner', createdByUid: 'company-owner', createdAt: 123 };
    const result = await c.withSharedOwnerMetadata(original);
    assert.strictEqual(result.ownerUid, 'company-owner');
    assert.strictEqual(result.createdByUid, 'company-owner');
    assert.strictEqual(result.updatedByUid, 'office');
    assert.strictEqual(result.createdAt, 123);
    assert.strictEqual(original.updatedByUid, undefined, 'Metadata must not mutate input');
  });
});
