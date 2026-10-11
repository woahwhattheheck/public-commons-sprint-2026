// MIT. One focused native SQLite/source lifecycle exercise; no HTTP/facilitator simulation.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { createSqliteQuerySource } from './source.mjs';
const dir = await mkdtemp(join(tmpdir(), 'sf30-sqlite-'));
const database = join(dir, 'catalog.sqlite');
const db = new DatabaseSync(database);
db.exec('CREATE TABLE products(id INTEGER PRIMARY KEY,title TEXT,region TEXT,price_cents INTEGER,private_note TEXT); CREATE INDEX product_lookup ON products(region,id); BEGIN');
const insert = db.prepare('INSERT INTO products VALUES(?,?,?,?,?)');
for (let i = 1; i <= 100000; i++) insert.run(i, i===1?'東京 🛰️':`Product ${i}`, i%2?'north':'south', 499, 'DO_NOT_SELL_PRIVATE');
insert.run(9007199254740993n, 'Exact integer', 'north', 9223372036854775807n, 'DO_NOT_SELL_PRIVATE'); db.exec('COMMIT'); db.close();
const digest = () => readFile(database).then(b => createHash('sha256').update(b).digest('hex'));
const original = await digest();
const template = JSON.parse(await readFile(new URL('./example-source.json', import.meta.url),'utf8'));
const queries = {
 ...template.queries,
 slow: {sql:'WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 1000000000) SELECT sum(n) AS total FROM seq',columns:['total'],timeoutMs:100},
 large: {sql:"SELECT printf('%20000s','x') AS text",columns:['text'],maxBytes:1024},
 types: {sql:"SELECT $flag AS flag, $ratio AS ratio, $nullable AS nullable, x'00ff' AS data",columns:['flag','ratio','nullable','data'],parameters:{flag:{type:'boolean'},ratio:{type:'number',minimum:0,maximum:10},nullable:{type:'string',nullable:true}}},
};
let source;
try {
 const boot = performance.now(); source = await createSqliteQuerySource({database,queries,maxPending:4});
 console.log('startup_ms', +(performance.now()-boot).toFixed(2));
 const catalog = source.route('catalog');
 assert.equal(catalog.admit({method:'GET',query:{}}).status,422);
 assert.equal(catalog.admit({method:'GET',query:{region:['north','south']}}).status,422);
 assert.equal(catalog.admit({method:'GET',query:{region:'north',surprise:'PRIVATE_VALUE'}}).body.field,null);
 const t=performance.now(); const r=await source.query('catalog',{region:'north'});
 assert.equal(r.rows[0].title,'東京 🛰️'); assert.equal(r.rowCount,100); assert.equal(r.truncated,true);
 assert(!JSON.stringify(r).includes('private_note')); assert(!JSON.stringify(r).includes('DO_NOT_SELL_PRIVATE'));
 console.log('indexed_100001_rows_ms',+(performance.now()-t).toFixed(2),'page_rows',r.rowCount,'truncated',r.truncated);
 const last=await source.query('catalog',{region:'north',after_id:'100000'});assert.equal(last.rows[0].id,'9007199254740993');assert.equal(last.rows[0].price_cents,'9223372036854775807');
 const injection=await source.query('catalog',{region:"north' OR 1=1 --"});assert.equal(injection.rowCount,0);
 const types=await source.query('types',{flag:'false',ratio:'1.5',nullable:null});assert.deepEqual(types.rows[0],{flag:'0',ratio:1.5,nullable:null,data:{$base64:'AP8='}});
 const direct=await catalog.handler({method:'GET',query:{region:'north',after_id:'100000'}});assert.equal(direct.status,200);assert.equal(direct.body.rows[0].id,'9007199254740993');
 assert.equal((await catalog.handler({method:'GET',query:{region:'north',after_id:'1 OR 1=1'}})).status,422);
 await assert.rejects(source.query('large',{}),{code:'QUERY_RESULT_TOO_LARGE'});
 let ticks=0;const timer=setInterval(()=>ticks++,5);
 const slowStart=performance.now();await assert.rejects(source.query('slow',{}),{code:'QUERY_TIMEOUT'});clearInterval(timer);
 assert(ticks>=5);assert(performance.now()-slowStart<1000);
 assert.equal((await source.query('catalog',{region:'south'})).rowCount,100);
 const controller=new AbortController();const aborting=source.query('slow',{}, {signal:controller.signal});setTimeout(()=>controller.abort(),20);await assert.rejects(aborting,{code:'QUERY_ABORTED'});
 assert.equal((await source.query('catalog',{region:'north'})).rowCount,100);
 const jobs=Array.from({length:4},()=>source.query('slow',{}).catch(e=>e.code));
 await assert.rejects(source.query('catalog',{region:'north'}),{code:'SOURCE_BUSY'});
 assert.equal(catalog.admit({method:'GET',query:{region:'north'}}).status,429);await Promise.all(jobs);
 await source.close();await source.close();await assert.rejects(source.query('catalog',{region:'north'}),{code:'SOURCE_CLOSED'});
 assert.equal(await digest(),original);
 await assert.rejects(createSqliteQuerySource({database,queries:{write:{sql:'DELETE FROM products RETURNING id',columns:['id']}}}),{code:'QUERY_PREPARE_FAILED'});
 await assert.rejects(createSqliteQuerySource({database,queries:{missing:{sql:'SELECT $region AS id',columns:['id']}}}),/Declared parameters/);
 await assert.rejects(createSqliteQuerySource({database,queries:{secret:{sql:'SELECT id FROM products',columns:['nonexistent']}}}),{code:'QUERY_PREPARE_FAILED'});
 console.log(JSON.stringify({result:'PASS',databaseRows:100001,unchangedSha256:original,eventLoopTicksDuringQuery:ticks,flow:'indexed query → exact integers/Unicode/projection → typed admission → overload → timeout/abort → worker restart → close'}));
} finally {await source?.close();await rm(dir,{recursive:true,force:true});}
