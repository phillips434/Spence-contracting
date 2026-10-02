const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
const start = html.indexOf('function openAdd(){');
const end = html.indexOf('function openSettings(){', start);
const helpers=['rememberProjectSnapshot','projectFieldEqual','persistProjectChanges'].map(name=>{
  const a=html.indexOf('function '+name+'('),b=html.indexOf('\nfunction ',a+1);
  return html.slice(a,b);
}).join('\n');
const source = helpers+'\n'+html.slice(start, end);
const fields = ['fClient', 'fClientPhone', 'fClientEmail', 'fJobNum', 'fPO', 'fType', 'fAddress', 'fPm', 'fStart', 'fEnd', 'fBudget', 'fSpent', 'fNotes', 'fStatus'];

test.beforeEach(async ({ page }) => {
  await page.setContent(fields.map(id => `<input id="${id}">`).join('') + '<div id="addPageTitle"></div><div id="addPage"></div>');
  await page.evaluate(source => {
    window.projects = [];
    window.editId = null;
    window.currentId = null;
    window.currentUser = { uid: 'test-owner' };
    window.COLORS = ['blue'];
    window.selColor = 0;
    window.DD = {};
    window.populateStatus = () => {};
    window.renderCP = () => {};
    window.nextJobNumber = () => 'JOB-NEW';
    window.gpr = () => projects.find(p => p.id === currentId);
    window.withSharedOwnerMetadata = async p => p;
    window.col = { doc: () => ({ set: async record => { window.savedRecord = record; } }) };
    window.T = window.pushNotification = () => {};
    window.openDetail = id => { window.openedProject = projects.find(p => p.id === id); };
    (0, eval)(source);
  }, source);
});

test('new project clears contact, job number and PO from the previous edit', async ({ page }) => {
  await page.evaluate(() => {
    ['fClientPhone', 'fClientEmail', 'fJobNum', 'fPO'].forEach(id => document.getElementById(id).value = 'previous client');
    openAdd();
  });
  for (const id of ['fClientPhone', 'fClientEmail', 'fJobNum', 'fPO']) await expect(page.locator('#' + id)).toHaveValue('');
});

test('saved new project is available immediately without waiting for a database snapshot', async ({ page }) => {
  await page.locator('#fClient').fill('New client');
  await page.locator('#fType').fill('Kitchen');
  await page.evaluate(() => saveProject());
  await expect.poll(() => page.evaluate(() => window.openedProject?.client)).toBe('New client');
  expect(await page.evaluate(() => projects.length)).toBe(1);
});

test('editing a project preserves selections and updates the cache without duplicates', async ({ page }) => {
  await page.evaluate(() => {
    projects.push({ id: 'existing', client: 'Old name', type: 'Kitchen', choices: [{ category: 'Tile', item: 'Porcelain' }] });
    currentId = 'existing';
    openEditProject();
  });
  await page.locator('#fClient').fill('Updated client');
  await page.evaluate(() => saveProject());
  await expect.poll(() => page.evaluate(() => projects[0].client)).toBe('Updated client');
  expect(await page.evaluate(() => projects.length)).toBe(1);
  expect(await page.evaluate(() => projects[0].choices[0].item)).toBe('Porcelain');
});
