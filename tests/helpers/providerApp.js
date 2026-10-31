// Provider contract tests exercise the real handlers in an isolated test app.
// Session/membership protections are exercised on the production app separately.
const server=require('../../server');
function providerTestApp(handlers=server){
 const app=require('express')();app.use(require('express').json({limit:'10mb'}));
 app.post('/api/estimate',handlers.estimateHandler);
 app.post('/api/daily-log',handlers.dailyLogHandler);
 return app;
}
module.exports={...server,app:providerTestApp(),providerTestApp};
