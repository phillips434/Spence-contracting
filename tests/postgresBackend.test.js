const assert = require('assert');
const { dataBackendEnabled } = require('../lib/postgresBackend');

describe('PostgreSQL backend migration guard', function(){
  const original = process.env.CD_DATA_BACKEND;
  afterEach(function(){
    if(original === undefined) delete process.env.CD_DATA_BACKEND;
    else process.env.CD_DATA_BACKEND = original;
  });

  it('keeps Firestore active by default', function(){
    delete process.env.CD_DATA_BACKEND;
    assert.strictEqual(dataBackendEnabled(), false);
  });

  it('requires an explicit postgres switch', function(){
    process.env.CD_DATA_BACKEND = 'postgres';
    assert.strictEqual(dataBackendEnabled(), true);
  });

  it('does not enable postgres for other values', function(){
    process.env.CD_DATA_BACKEND = 'firestore';
    assert.strictEqual(dataBackendEnabled(), false);
  });
});
