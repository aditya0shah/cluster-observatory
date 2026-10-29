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
console.log('Frontend checks passed.');
