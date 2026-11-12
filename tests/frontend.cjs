const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const elements = {};
const context = {
  document: {getElementById: id => elements[id] ||= {}, querySelectorAll: () => []},
  localStorage: {getItem: () => null}, fetch: () => new Promise(() => {}), setInterval() {}, Date
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/app.js', 'utf8'), context);
const evaluate = code => vm.runInContext(code, context);
assert.equal(evaluate("storagePercent({used:'9GB',limit:'10GB'})"), '90%');
assert.equal(evaluate("storagePercent({used:'50G',sharedLimit:'1000G'})"), '5%');
assert.equal(evaluate("storagePercent({used:'32G',sharedLimit:'1T'})"), '3.1%');
assert.equal(evaluate("storagePercent({used:'1G'})"), '');
assert.equal(evaluate("supportedGpu('gpu-a40')"), true);
assert.equal(evaluate("supportedGpu('gpu-h200')"), true);
assert.equal(evaluate("supportedGpu('gpu-p100')"), false);
assert.equal(evaluate("supportedGpu('compute')"), false);
context.reports = [{command:'hyakstorage', output:'Usage report for /scratch/lab\n│ Total: │ 100G / 1000G │ 1000 / 10000 files │\n│ My usage: │ 50G │ 500 files │'}];
assert.equal(evaluate('parseStorage(reports).personal[0].used'), '50G');
assert.equal(evaluate('parseStorage(reports).shared[0].used'), '100G');
context.reports = [{command:'hyakstorage', output:'│ /gpfs/projects/lab │\n│ Fileset │ - │ 500G │ 1T │ 49% │ 500k │\n│ User │ researcher │ 32G │ - │ 3% │ 200k │'}];
assert.equal(evaluate('parseStorage(reports).personal[0].sharedLimit'), '1T');
assert.equal(evaluate('parseStorage(reports).personal[0].limit'), null);
assert(evaluate('storageMarkup({reports}).includes("shared account quota")'));
context.activity = {jobs:[
  {user:'alice',id:'1',name:'train <phase>',state:'RUNNING',account:'gpu-a40-weirdlab',partition:'gpu-a40',nodelist:'g1',scope:'account',gpu_types:{A40:2}},
  {user:'alice',id:'2',name:'checkpoint job',state:'RUNNING',account:'ckpt-weirdlab',partition:'ckpt-all',nodelist:'g2',scope:'checkpoint',gpu_types:{L40S:1}},
  {user:'bob',id:'3',name:'old GPU',state:'RUNNING',scope:'account',gpu_types:{P100:4}},
  {user:'carol',id:'4',name:'multi-node',state:'SUSPENDED',account:'weirdlab',partition:'gpu',nodelist:'g[3-4]',scope:'account',gpu_types:{H200:8}},
]};
const markup=evaluate("weirdlabMarkup(activity,'alice',new Set(['klone:alice']))");
assert(markup.includes('<strong>2</strong> people'));
assert(markup.includes('<strong>10</strong> account GPUs'));
assert(markup.includes('<strong>1</strong> checkpoint GPUs'));
assert(markup.includes('data-user="klone:alice" open'));
assert(markup.includes('train &lt;phase&gt;'));
assert(markup.includes('YOU'));
assert(!markup.includes('old GPU'));
assert(evaluate("weirdlabMarkup({jobs:[]},'alice')").includes('No active Weirdlab jobs'));
assert(evaluate("weirdlabMarkup({error:'no access'},'alice')").includes('GPU activity refresh delayed'));
context.activity.error='query timed out';
context.activity.collected_at=new Date().toISOString();
const stale=evaluate("weirdlabMarkup(activity,'alice')");
assert(stale.includes('GPU activity refresh delayed'));
assert(stale.includes('Showing the last successful reading'));
assert(stale.includes('train &lt;phase&gt;'));
console.log('Frontend checks passed.');
