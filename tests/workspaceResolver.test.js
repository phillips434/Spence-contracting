const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('resolveWorkspaceUidForSession', () => {
  it('returns the owner uid for team users and the user uid for owners', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const start = html.indexOf('function resolveWorkspaceUidForSession(uid){');
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
