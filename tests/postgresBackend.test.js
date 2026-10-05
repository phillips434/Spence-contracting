const assert = require('assert');
const { dataBackendEnabled, migrationAuthorized } = require('../lib/postgresBackend');

describe('PostgreSQL backend migration guard', function(){
  const original = process.env.CD_DATA_BACKEND;
  afterEach(function(){
    if(original === undefined) delete process.env.CD_DATA_BACKEND;
    else process.env.CD_DATA_BACKEND = original;
  });

  it('uses PostgreSQL by default', function(){
    delete process.env.CD_DATA_BACKEND;
    assert.strictEqual(dataBackendEnabled(), true);
  });

  it('uses PostgreSQL with explicit configuration', function(){
    process.env.CD_DATA_BACKEND = 'postgres';
    assert.strictEqual(dataBackendEnabled(), true);
  });

  it('never falls back to a retired database', function(){
    process.env.CD_DATA_BACKEND = 'firestore';
    assert.strictEqual(dataBackendEnabled(), true);
  });
});

describe('PostgreSQL migration endpoint guard', function(){
  const oldMode=process.env.CD_MIGRATION_MODE,oldSecret=process.env.CD_MIGRATION_SECRET;
  afterEach(function(){
    if(oldMode===undefined)delete process.env.CD_MIGRATION_MODE;else process.env.CD_MIGRATION_MODE=oldMode;
    if(oldSecret===undefined)delete process.env.CD_MIGRATION_SECRET;else process.env.CD_MIGRATION_SECRET=oldSecret;
  });
  function req(secret){return {get:function(name){return name==='x-cd-migration-secret'?secret:undefined;}};}
  it('is disabled by default',function(){delete process.env.CD_MIGRATION_MODE;delete process.env.CD_MIGRATION_SECRET;assert.strictEqual(migrationAuthorized(req('anything')),false);});
  it('rejects short or missing secrets',function(){process.env.CD_MIGRATION_MODE='enabled';process.env.CD_MIGRATION_SECRET='short';assert.strictEqual(migrationAuthorized(req('short')),false);});
  it('requires exact secret when explicitly enabled',function(){process.env.CD_MIGRATION_MODE='enabled';process.env.CD_MIGRATION_SECRET='123456789012345678901234';assert.strictEqual(migrationAuthorized(req('wrong')),false);assert.strictEqual(migrationAuthorized(req('123456789012345678901234')),true);});
});

