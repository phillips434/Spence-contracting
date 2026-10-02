const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('resolveWorkspaceUidForSession', () => {
  it('keeps the established owner workspace despite an erroneous team profile', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const uid = 'L5XUqfnWrrgbAk18X36XcHDJxnz1';
    const context = { currentUser: { uid }, Promise, db: { collection() { throw new Error('Owner must not follow the team profile'); } } };
    for (const name of ['resolveCurrentOwnerUid', 'resolveWorkspaceUidForSession']) {
      const start = html.indexOf('function ' + name + '(');
      const end = html.indexOf('\nfunction ', start + 1);
      vm.runInNewContext(html.slice(start, end), context);
    }
    assert.strictEqual(await context.resolveCurrentOwnerUid(), uid);
    assert.strictEqual(await context.resolveWorkspaceUidForSession(uid, true), uid);
  });
  it('allocates above visible existing estimate numbers when settings counter is stale', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const start = html.indexOf('function nextEstNumber(');
    const end = html.indexOf('\nfunction ', start + 1);
    const context = { DD: { nextEstNum: 2 }, estimates: [{ estNum: 'EST-0160' }, { estNum: 'EST-0043' }], saveSettingsSilent: async () => {} };
    vm.runInNewContext(html.slice(start, end), context);
    assert.strictEqual(context.nextEstNumber(), 'EST-0161');
    assert.strictEqual(context.nextEstNumber(), 'EST-0162');
  });
  it('does not allocate a number before the initial estimates snapshot is ready', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const start = html.indexOf('function nextEstNumber(');
    const end = html.indexOf('\nfunction ', start + 1);
    let message;
    const context = { estimatesSyncReady: false, DD: { nextEstNum: 1 }, estimates: [], T: value => { message = value; }, saveSettingsSilent: async () => {} };
    vm.runInNewContext(html.slice(start, end), context);
    assert.strictEqual(context.nextEstNumber(), null);
    assert.strictEqual(context.DD.nextEstNum, 1);
    assert.match(message, /still syncing/);
    context.estimatesSyncReady = true;
    context.estimates = [{ estNum: 'EST-0160' }];
    assert.strictEqual(context.nextEstNumber(), 'EST-0161');
  });
  it('returns the owner uid for team users and the user uid for owners', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const start = html.indexOf('function resolveWorkspaceUidForSession(');
    const end = html.indexOf('function normalizeInviteEmail', start);
    const source = html.slice(start, end);

    const userProfiles = {
      employee: { plan: 'team', ownerUid: 'owner-123' },
      owner: { plan: 'owner', ownerUid: null }
    };

    const context = {
      currentUser: { uid: 'employee' },
      db: {
        collection: (collectionName) => ({
          doc: (id) => ({
            get: () => Promise.resolve({
              exists: true,
              data: () => userProfiles[id] || {}
            })
          })
        })
      },
      Promise
    };

    vm.runInNewContext(source + '\nthis.resolveWorkspaceUidForSession = resolveWorkspaceUidForSession;', context);

    const teamWorkspaceUid = await context.resolveWorkspaceUidForSession('employee');
    const ownerWorkspaceUid = await context.resolveWorkspaceUidForSession('owner');

    assert.strictEqual(teamWorkspaceUid, 'owner-123');
    assert.strictEqual(ownerWorkspaceUid, 'owner');
  });
});
