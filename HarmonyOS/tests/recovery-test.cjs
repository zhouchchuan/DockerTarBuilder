const fs = require('fs'), vm = require('vm'), assert = require('node:assert/strict');
const ts = require(process.argv[2]);
const context = { exports: {} }; vm.createContext(context);
vm.runInContext(ts.transpileModule(fs.readFileSync('entry/src/main/ets/model/Recovery.ets','utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
}).outputText, context);
const Recovery = context.exports.Recovery;
const r = new Recovery(); r.begin('https://example.test/a',false);
assert.equal(r.failure(r.url,-3,true),-1,'cancelled navigation must be silent');
assert.equal(r.failure(r.url,-105,false),-1,'subresource failure must be silent');
assert.equal(r.failure('https://example.test/old',-105,true),-1,'stale URL ignored');
assert.equal(r.failure(r.url,-105,true),2000);
assert.equal(r.failure(r.url,-105,true),-1,'duplicate callback ignored');
assert.equal(r.visible(r.url),false,'error page must not clear failure');
r.begin(r.url,true); assert.equal(r.failure(r.url,-118,true),5000);
r.begin(r.url,true); assert.equal(r.failure(r.url,-106,true),0,'bounded retries');
r.begin(r.url,false); r.method='POST'; assert.equal(r.failure(r.url,-118,true),0,'never replay POST');
r.begin(r.url,false); r.method='GET'; assert.equal(r.failure(r.url,-200,true),0,'never retry TLS errors');
r.begin(r.url,false); assert.equal(r.visible(r.url),true);
assert.equal(r.failure(r.url,-105,true),-1,'committed page survives late failure');
console.log('PASS 12 navigation recovery assertions');
