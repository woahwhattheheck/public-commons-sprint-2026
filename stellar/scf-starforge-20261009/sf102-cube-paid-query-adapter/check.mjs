// MIT. One focused local acceptance for the changed operator-bound query compiler.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileCubeCatalog,renderCubeQuery} from './cube-template.mjs';
const config = JSON.parse(readFileSync(new URL('./cube-adapter.json',import.meta.url),'utf8'));
const catalog = compileCubeCatalog(config);
const request = (report,query={}) => ({method:'GET',url:new URL('http://127.0.0.1/reports/'+report),query});
assert.equal(catalog.size,2);
assert.equal(renderCubeQuery(catalog,request('hourly-count')).measures[0],'logs.count');
assert.deepEqual(renderCubeQuery(catalog,request('date-window',{start:'2026-10-01',end:'2026-10-10'}))
  .timeDimensions[0].dateRange,['2026-10-01','2026-10-10']);
for (const value of [
  request('missing'),request('hourly-count',{query:'arbitrary'}),
  request('date-window',{start:'2026-10-01',end:'2026-10-10',extra:'bad'}),
  request('date-window',{start:'2026-10-10',end:'2026-10-01'}),
  request('date-window',{start:'2026-02-30',end:'2026-03-01'}),
  request('date-window',{start:['2026-10-01','2026-10-02'],end:'2026-10-10'}),
  request('date-window',{start:'2026-09-01',end:'2026-10-10'}),
]) assert.throws(()=>renderCubeQuery(catalog,value));
const invalid = structuredClone(config);
invalid.reports['hourly-count'].query.measures = ['not-a-cube-member'];
assert.throws(()=>compileCubeCatalog(invalid));
console.log('SF102 focused original template acceptance: PASS');
