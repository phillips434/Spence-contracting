const {execFileSync}=require('node:child_process');
describe('marketing firm findings PostgreSQL integration',function(){this.timeout(30000);it('enforces the financial and authorization rules on actual database routes',()=>{execFileSync(process.execPath,[require.resolve('./fixtures/qa-financial-integration.js')],{timeout:25000,stdio:'pipe'});});});
