// Focused behavioral checks for source-native retrieval; no provider or money side effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeQuery, tokenize, rankBazaarEntries } from '../src/ranking.mjs';
const entry=(name, desc='', tags=[], toolName='')=>({
 resource:{url:'https://example.org/'+name,serviceName:name,description:desc,tags},
 extensions:{bazaar:{info:{input:{type:'mcp',toolName,inputSchema:{type:'object',properties:{location:{description:'city or geographic location'}}}}}}}
});
const corpus=[
 ['weather',entry('Weather Forecast','Hourly rainfall and temperature estimates',['climate','forecast'])],
 ['stocks',entry('Market Price','Equity market quotes and financials',['stocks','finance'])],
 ['alerts',entry('Storm Alerts','Dangerous weather warning and storm forecasts',['weather','alerts'])],
 ['payments',entry('Payments API','Stellar blockchain settlement and USDC paywall',['payment','stellar'])],
];
test('safe natural-language tokenization and meaningful query terms',()=>{
 assert.deepEqual(analyzeQuery('Please find me a WEATHER forecast for cities'),['weather','forecast','cities']);
 assert.deepEqual(tokenize('Météo—USDC'),['meteo','usdc']);
 assert.throws(()=>analyzeQuery('  '),RangeError);
 assert.throws(()=>analyzeQuery('!&?'),RangeError);
});
test('source fields and phrase boost favor a specific service, without mutating originals',()=>{
 const original=JSON.stringify(corpus);
 const ranked=rankBazaarEntries(corpus,'Find me a weather forecast');
 assert.equal(ranked[0].key,'weather');
 assert.ok(ranked.some(x=>x.key==='alerts'));
 assert.equal(JSON.stringify(corpus),original);
});
test('typos recover canonical names, but unrelated entries abstain',()=>{
 assert.equal(rankBazaarEntries(corpus,'weathr')[0].key,'weather');
 assert.deepEqual(rankBazaarEntries(corpus,'zoopidop'),[]);
});
test('no implicit network/payment filtering and deterministic ties',()=>{
 const r1=rankBazaarEntries([...corpus].reverse(),'weather');
 const r2=rankBazaarEntries(corpus,'weather');
 assert.deepEqual(r1.map(r=>r.key),r2.map(r=>r.key));
 assert.ok(r1.every(r=>Number.isFinite(r.score)&&r.score>0));
});
