#!/usr/bin/env node
/** Local trusted-operator workflow over the original SF60 journal. No network. */
import { constants } from 'node:fs';
import { open, mkdir, rm, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { DurableCatalogTransaction, BATCH_SCHEMA, MAX_BATCH_BYTES, MAX_BATCH_OPERATIONS } from './journal.mjs';

const INPUT_SCHEMA = 'stellar-forge.catalog-batch-input/v1';
const AUTH_SCHEMA = 'stellar-forge.catalog-operator-authorities/v1';
const PLAN_SCHEMA = 'stellar-forge.catalog-import-plan/v1';
const fields = ['allowedOrigins','allowedRecipients','allowedNetworks','allowedSchemes'];
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = v => createHash('sha256').update(v).digest('hex');
const fail = code => {throw new Error(code);};
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function load(path,limit) {
  if (typeof path !== 'string' || !path) fail('FILE_ARGUMENT_REQUIRED');
  const file = await open(resolve(path),constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const meta = await file.stat();
    if (!meta.isFile() || meta.size > limit) fail('INPUT_FILE_LIMIT');
    const parts=[]; let bytes=0;
    while (bytes <= limit) {
      const buffer=Buffer.alloc(Math.min(65536,limit+1-bytes));
      const {bytesRead}=await file.read(buffer,0,buffer.length,null);
      if (!bytesRead) break;
      bytes+=bytesRead; parts.push(buffer.subarray(0,bytesRead));
    }
    if (bytes > limit) fail('INPUT_FILE_LIMIT');
    const raw=Buffer.concat(parts);
    let document;
    try {document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
    catch {fail('INPUT_JSON_INVALID');}
    return {document,sha256:hash(raw)};
  } finally {await file.close();}
}

/** Bind source rows to a SEPARATE authenticated operator authority file. */
export function bindOperations(input,authorities) {
  if (!plain(input) || input.schema !== INPUT_SCHEMA || !Array.isArray(input.operations) ||
      !input.operations.length || input.operations.length > MAX_BATCH_OPERATIONS) fail('INPUT_SCHEMA_INVALID');
  if (!plain(authorities) || authorities.schema !== AUTH_SCHEMA || !Array.isArray(authorities.sellers) ||
      !authorities.sellers.length || authorities.sellers.length > MAX_BATCH_OPERATIONS) fail('AUTHORITY_SCHEMA_INVALID');
  const bySeller=new Map();
  for (const raw of authorities.sellers) {
    if (!plain(raw) || typeof raw.sellerId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(raw.sellerId) ||
        typeof raw.signer !== 'string' || raw.signer.length < 3 || raw.signer.length > 256 || bySeller.has(raw.sellerId)) fail('AUTHORITY_SELLER_INVALID');
    const authority={sellerId:raw.sellerId,signer:raw.signer};
    for (const key of fields) {
      if (!Array.isArray(raw[key]) || !raw[key].length || raw[key].length > 64 ||
          raw[key].some(x=>typeof x !== 'string' || !x || x.length > 256)) fail('AUTHORITY_POLICY_INVALID');
      authority[key]=new Set(raw[key]);
    }
    bySeller.set(raw.sellerId,authority);
  }
  return input.operations.map((row,index)=>{
    if (!plain(row) || !['upsert','retire'].includes(row.kind) || Object.hasOwn(row,'authority') ||
        Object.hasOwn(row,'signer')) fail(`INPUT_ROW_${index}_INVALID`);
    const sellerId=row.kind === 'upsert' ? row.candidate?.sellerId : row.sellerId;
    const authority=bySeller.get(sellerId);
    if (!authority) fail(`INPUT_ROW_${index}_AUTHORITY_MISSING`);
    return row.kind === 'upsert' ? {kind:'upsert',candidate:row.candidate,provenance:row.provenance,authority}
      : {kind:'retire',catalogKey:row.catalogKey,sellerId,sequence:row.sequence,
        provenance:row.provenance,reason:row.reason,signer:authority.signer};
  });
}

function terms(snapshot) {
  if (!snapshot) return '<span class="muted">Not in catalog</span>';
  return `<strong>${esc(snapshot.state)} · sequence ${snapshot.sequence}</strong><div>${esc(snapshot.resourceURL)}</div>`+
    snapshot.accepts.map(a=>`<div class="term">${esc(a.amount)} atomic · ${esc(a.asset)} · ${esc(a.network)}<br>${esc(a.scheme)} → ${esc(a.payTo)}</div>`).join('');
}
export function renderReview(plan) {
  const r=plan.review;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Catalog import review</title><style>
:root{font:15px/1.5 system-ui,sans-serif;color:#222;background:#f4f4f4}body{max-width:1200px;margin:32px auto;padding:0 20px}
h1{font-size:28px;margin-bottom:0}h2{font-size:17px;margin:0}header,section{background:#fff;border:1px solid #ccc;padding:20px;margin:16px 0}
.muted,small{color:#555}.stats{display:flex;gap:36px;flex-wrap:wrap}.stats b{font-size:24px;display:block}code{overflow-wrap:anywhere;font-size:12px}
article{border-top:1px solid #ddd;padding:18px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}.pair>div{min-width:0;overflow-wrap:anywhere}.pair small{display:block;margin-bottom:6px}
.term{margin-top:8px;padding-top:6px;border-top:1px dotted #ccc}.key{font-family:monospace;overflow-wrap:anywhere}summary{cursor:pointer}
@media(max-width:680px){.pair{grid-template-columns:1fr}body{margin:16px auto;padding:0 12px}header,section{padding:14px}}
@media print{body{margin:0;background:#fff}article{break-inside:avoid}}</style>
<header><small>STELLAR FORGE / CATALOG OPERATIONS</small><h1>Review catalog changes</h1><p>Prepared locally. The journal has not been changed by this review. Apply using the same input, operator authorities and reviewed catalog head.</p>
<div class="stats"><div><b>${r.requested}</b>requested</div><div><b>${r.applied}</b>changes</div><div><b>${r.replayed}</b>exact replays</div><div><b>${r.activeResources}</b>resulting active resources</div></div></header>
<section><h2>Source and catalog binding</h2><p>Base head<br><code>${esc(r.baseHead)}</code></p><p>Result head<br><code>${esc(r.nextHead)}</code></p><details><summary>Input fingerprints and plan</summary><p>Input <code>${esc(plan.inputSha256)}</code></p><p>Authorities <code>${esc(plan.authoritiesSha256)}</code></p><p>Plan <code>${esc(r.planId)}</code></p></details>
<p class="muted">The operator must already have authenticated each seller and its source. This import does not verify signatures or settle payments. Atomic amounts below are advertised terms, not revenue.</p></section>
<section><h2>Changes in transaction order</h2>${r.changes.map(c=>`<article><strong>${c.index+1}. ${esc(c.kind)} / ${esc(c.decision)}</strong><p class="key">${esc(c.catalogKey)}</p><div class="pair"><div><small>BEFORE</small>${terms(c.before)}</div><div><small>AFTER</small>${terms(c.after)}</div></div></article>`).join('')}</section></html>`;
}
async function createFile(path,data) {
  const file=await open(path,'wx',0o600);
  try {await file.writeFile(data);await file.sync();} finally {await file.close();}
}
async function codeDigest() {
  // Bind a preview to the implementation that will apply it, not a version label.
  const paths=['./journal.mjs','./bulk-import.mjs','../../../scf46-stellar-bazaar/src/catalog.mjs',
    '../../../scf46-stellar-bazaar/src/ranking.mjs','../../../scf46-stellar-bazaar/src/pricing.mjs',
    '../../../stellar-forge/catalog-trust/catalog-trust.mjs','../../../stellar-forge/catalog-lifecycle/lifecycle.mjs',
    '../../../stellar-forge/route-identity/identity.mjs'];
  const entries=[];
  for(const path of paths) entries.push([path,hash(await readFile(new URL(path,import.meta.url)))]);
  // The query-index extension is optional on older compatible catalog releases.
  const indexPath='../../../scf46-stellar-bazaar/src/query-index.mjs';
  try {entries.push([indexPath,hash(await readFile(new URL(indexPath,import.meta.url)))]);}
  catch(error){if(error.code!=='ENOENT')throw error;}
  return hash(JSON.stringify(entries));
}
const help=`SF60 catalog bulk import (Node 22+, trusted local operator)
  preview --directory PRIVATE_DB --input batch.json --authorities trusted.json --out NEW_REVIEW_DIR
  apply   --directory PRIVATE_DB --input batch.json --authorities trusted.json --plan REVIEW_DIR/plan.json
  status  --directory PRIVATE_DB [--plan REVIEW_DIR/plan.json]
  list    --directory PRIVATE_DB [--limit 100 --offset 0 --network stellar:testnet]
  search  --directory PRIVATE_DB --query WORDS [--limit 20 --cursor CURSOR --network stellar:testnet]
Do not pass wallet secrets. Keep the DB, inputs, authorities and review outside web roots.
See BULK_IMPORT.md for input schemas and operating procedure. No network or hosted CI is used.`;

export async function main(argv=process.argv.slice(2)) {
  const {values:v,positionals}=parseArgs({args:argv,allowPositionals:true,strict:true,options:{
    directory:{type:'string'},input:{type:'string'},authorities:{type:'string'},out:{type:'string'},plan:{type:'string'},
    query:{type:'string'},limit:{type:'string'},offset:{type:'string'},cursor:{type:'string'},network:{type:'string'},help:{type:'boolean'}}});
  if(v.help || !positionals.length){console.log(help);return;}
  const [command]=positionals;
  if(positionals.length!==1 || !['preview','apply','status','list','search'].includes(command) || !v.directory) fail('COMMAND_ARGUMENTS_INVALID');
  let requests,source,authorities,plan,implementation;
  if(command==='preview' || command==='apply') {
    source=await load(v.input,MAX_BATCH_BYTES);authorities=await load(v.authorities,1024*1024);
    requests=bindOperations(source.document,authorities.document);implementation=await codeDigest();
    if(command==='preview' && !v.out) fail('OUTPUT_DIRECTORY_REQUIRED');
    if(command==='apply' && !v.plan) fail('REVIEWED_PLAN_REQUIRED');
  }
  if(v.plan) {
    plan=(await load(v.plan,32*1024*1024)).document;
    if(plan?.schema!==PLAN_SCHEMA || plan.review?.schema!==BATCH_SCHEMA) fail('PLAN_SCHEMA_INVALID');
  }
  if(command==='apply' && (plan.inputSha256!==source.sha256 || plan.authoritiesSha256!==authorities.sha256 ||
      plan.implementationSha256!==implementation)) fail('PLAN_SOURCE_CHANGED_PREVIEW_AGAIN');
  const db=await DurableCatalogTransaction.open(v.directory);
  try {
    if(command==='preview') {
      const review=await db.previewBatch(requests);
      plan={schema:PLAN_SCHEMA,inputSha256:source.sha256,authoritiesSha256:authorities.sha256,implementationSha256:implementation,review};
      const out=resolve(v.out);await mkdir(out,{mode:0o700});
      try {
        await createFile(join(out,'plan.json'),JSON.stringify(plan,null,2)+'\n');
        await createFile(join(out,'review.html'),renderReview(plan));
      } catch(error){await rm(out,{recursive:true,force:true});throw error;}
      console.log(JSON.stringify({decision:'preview',head:db.head,changes:review.applied,replays:review.replayed,plan:join(out,'plan.json'),review:join(out,'review.html')}));
    } else if(command==='apply') {
      const result=await db.commitBatch(requests,{expectedHead:plan.review.baseHead,expectedPlan:plan.review.planId});
      console.log(JSON.stringify({decision:result.decision,head:result.head,operations:result.operationsAfter,changes:result.applied,replays:result.replayed}));
    } else if(command==='status') {
      console.log(JSON.stringify({head:db.head,operations:db.count,activeResources:db.list().pagination.total,
        ...(plan?{reviewState:db.head===plan.review.baseHead?'at_reviewed_head':db.head===plan.review.nextHead?'at_planned_result':'changed_since_review'}:{})}));
    } else {
      const params=new URLSearchParams();
      for(const k of ['query','limit','offset','cursor','network']) if(v[k]!==undefined)params.set(k,v[k]);
      console.log(JSON.stringify(command==='search'?db.search(params):db.list(params)));
    }
  } finally {await db.close();}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{
    const message=/^[A-Z0-9_]{1,180}$/.test(error?.message??'')?error.message:
      /^[A-Z0-9_]{1,80}$/.test(error?.code??'')?error.code:'CATALOG_OPERATOR_ERROR';
    console.error(JSON.stringify({error:message,...(Number.isInteger(error.operationIndex)?{operationIndex:error.operationIndex}:{})}));
    process.exitCode=1;
  });
}
