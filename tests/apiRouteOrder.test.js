const assert = require('assert');
const { app } = require('../server');

describe('production API route ordering', function () {
  let server;
  let origin;
  before(function (done) {
    server = app.listen(0, '127.0.0.1', function () {
      origin = 'http://127.0.0.1:' + server.address().port;
      done();
    });
  });
  after(function (done) { server.close(done); });

  for (const kind of ['projects', 'estimates']) {
    it('returns JSON authentication errors for ' + kind + ' before the SPA fallback', async function () {
      const response = await fetch(origin + '/api/data/' + kind);
      assert.strictEqual(response.status, 401);
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.deepStrictEqual(await response.json(), { ok: false, error: 'Authentication required' });
    });
  }
  it('continues serving the app for client-side routes', async function () {
    const response = await fetch(origin + '/projects');
    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /Contractor Desk/);
  });
});
