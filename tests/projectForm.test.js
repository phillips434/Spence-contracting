const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const source = html.slice(html.indexOf('function openAdd(){'), html.indexOf('function openSettings(){'));
function fixture() {
  const ids = ['fClient', 'fClientPhone', 'fClientEmail', 'fJobNum', 'fPO', 'fType', 'fAddress', 'fPm', 'fStart', 'fEnd', 'fBudget', 'fSpent', 'fNotes', 'fStatus', 'addPageTitle', 'addPage'];
  const nodes = Object.fromEntries(ids.map(id => [id, { value: '', classList: { add() {}, remove() {} } }]));
  const c = { projects: [], currentUser: { uid: 'owner' }, editId: null, currentId: null, selColor: 0, COLORS: ['blue'], DD: {},
    document: { getElementById: id => nodes[id] }, populateStatus() {}, renderCP() {}, nextJobNumber: () => 'JOB-NEW',
    withSharedOwnerMetadata: async p => p, T() {}, pushNotification() {}, alert() { throw Error('Unexpected alert'); },
    col: { doc: () => ({ set: async () => {} }) } };
  c.gpr = () => c.projects.find(p => p.id === c.currentId);
  c.openDetail = id => { c.openedProject = c.projects.find(p => p.id === id); };
  vm.createContext(c);
  for(const name of ['rememberProjectSnapshot','persistProjectChanges']){
    const start=html.indexOf('function '+name+'('),end=html.indexOf('\nfunction ',start+1);
    vm.runInContext(html.slice(start,end),c);
  }
  vm.runInContext(source, c);
  return { c, nodes };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
describe('project form persistence', () => {
  it('clears previous client contact, job and PO fields for a new project', () => {
    const { c, nodes } = fixture();
    const fields = ['fClientPhone', 'fClientEmail', 'fJobNum', 'fPO'];
    fields.forEach(id => nodes[id].value = 'Previous client');
    c.openAdd();
    fields.forEach(id => assert.strictEqual(nodes[id].value, ''));
  });
  it('makes a saved new project available before a Firestore snapshot arrives', async () => {
    const { c, nodes } = fixture();
    nodes.fClient.value = 'New client'; nodes.fType.value = 'Kitchen';
    c.saveProject(); await flush();
    assert.strictEqual(c.openedProject.client, 'New client');
    assert.strictEqual(c.projects.length, 1);
  });
  it('preserves selections when editing and updates the existing cached record', async () => {
    const { c, nodes } = fixture();
    c.projects.push({ id: 'existing', client: 'Old name', type: 'Kitchen', choices: [{ category: 'Tile', item: 'Porcelain' }] });
    c.currentId = 'existing'; c.openEditProject(); nodes.fClient.value = 'Updated client';
    c.saveProject(); await flush();
    assert.strictEqual(c.projects.length, 1);
    assert.strictEqual(c.projects[0].client, 'Updated client');
    assert.strictEqual(c.projects[0].choices[0].item, 'Porcelain');
  });
});
