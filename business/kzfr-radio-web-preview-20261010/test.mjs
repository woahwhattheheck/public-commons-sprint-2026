import test from 'node:test';
import assert from 'node:assert/strict';
import {demoArchiveEntries, filterDemoArchives, humanDate} from './data.mjs';
const now=new Date('2026-10-10T16:00:00Z');
test('archive filter follows the RFP program/date/category discoverability contract',()=>{
  assert.equal(filterDemoArchives(demoArchiveEntries,{now}).length,6);
  assert.deepEqual(filterDemoArchives(demoArchiveEntries,{query:'Chico',now}).map(x=>x.id),['sample-02']);
  assert.deepEqual(filterDemoArchives(demoArchiveEntries,{category:'music',now}).map(x=>x.id),['sample-01','sample-04']);
  assert.deepEqual(filterDemoArchives(demoArchiveEntries,{category:'news',date:'week',now}).map(x=>x.id),['sample-03']);
  assert.deepEqual(filterDemoArchives(demoArchiveEntries,{date:'month',now}).map(x=>x.id),['sample-01','sample-02','sample-03','sample-04','sample-05']);
  assert.deepEqual(filterDemoArchives(demoArchiveEntries,{date:'week',query:'x-no-match',now}),[]);
  assert.equal(humanDate('2026-10-09'),'Oct 9, 2026');
});
