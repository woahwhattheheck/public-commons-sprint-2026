#!/usr/bin/env node
// MIT. Read-only authenticated or public *original facilitator* Bazaar capture.
// Intentionally no payment, verification, settlement, wallet or origin calls.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {performance} from 'node:perf_hooks';

const args=process.argv.slice(2);
const option=n=>{const i=args.indexOf(n);return i<0?null:args[i+1]};
const need=n=>{const s=option(n);if(!s)throw Error('Required '+n);return s};
const sha=b=>createHash('sha256').update(b).digest('hex');
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
const word=(s)=>String(s).replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,72);
const rowsOf=body=>Array.isArray(body)?body:body?.items??body?.resources??body?.data?.items??body?.data?.resources;

async function main(){
  const original=new URL(need('--url'));
  if(original.protocol!=='https:')throw Error('Only HTTPS facilitator discovery endpoints');
  if(!original.pathname.endsWith('/discovery/resources'))throw Error('Only original /discovery/resources, never payment or origin endpoints');
  const id=word(need('--id')),dir=resolve(need('--out'));
  const permission=need('--permission');
  if(!['public-read','authorized-operator'].includes(permission))throw Error('--permission must state legitimate capture authority');
  const envname=option('--bearer-env');
  const token=envname?process.env[envname]:null;
  if(envname&&!token)throw Error('Bearer environment variable missing');
  const pageLimit=Number(option('--page-size')||100);
  if(!Number.isSafeInteger(pageLimit)||pageLimit<1||pageLimit>100)throw Error('page-size 1..100 per x402 native spec');
  await mkdir(dir,{recursive:true});
  const sources=[],statuses=[],pageTimes=[];
  let offset=0,expectedTotal=null;
  while(true){
    const url=new URL(original);
    url.searchParams.set('offset',String(offset));
    url.searchParams.set('limit',String(pageLimit));
    let raw=null,res=null,started,err=null;
    for(let attempt=0;attempt<4;attempt++){
      started=performance.now();
      try{
        const headers={'accept':'application/json'};
        if(token)headers.authorization='Bearer '+token;
        res=await fetch(url,{method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(30000)});
        if([429,502,503,504].includes(res.status)&&attempt<3){
          // Respect server Retry-After when a parsable reasonable finite delay is sent.
          const retry=Number(res.headers.get('retry-after')||0);
          await res.body?.cancel();
          await wait(Number.isFinite(retry)&&retry>0?Math.min(120000,retry*1000):1000*2**attempt);
          continue;
        }
        if(res.status!==200)throw Error('Original facilitator HTTP '+res.status+' at offset '+offset);
        if(new URL(res.url).origin!==original.origin)throw Error('Cross-origin redirect refused');
        raw=Buffer.from(await res.arrayBuffer());
        pageTimes.push(performance.now()-started);
        break;
      }catch(e){err=e;if(attempt===3)throw e;await wait(1000*2**attempt);}
    }
    if(!raw)throw Error('No native GET bytes: '+String(err||'unknown'));
    const parsed=JSON.parse(raw.toString('utf8'));
    const items=rowsOf(parsed);
    if(!Array.isArray(items))throw Error('Capture is not a native array/items/resources response');
    if(parsed?.pagination?.total!==undefined&&expectedTotal===null){
      expectedTotal=Number(parsed.pagination.total);
      if(!Number.isSafeInteger(expectedTotal)||expectedTotal<0)throw Error('Bad native pagination.total');
    }
    const stamp=new Date().toISOString(),filename=id+'-'+String(offset).padStart(8,'0')+'.json';
    await writeFile(join(dir,filename),raw);
    sources.push({id:id+'-'+offset,url:url.href,captured_at:stamp,method:'GET',status:200,
      permission,file:filename,sha256:sha(raw)});
    statuses.push({offset,rows:items.length,sha256:sha(raw),elapsed_ms:pageTimes.at(-1)});
    if(!items.length)break;
    offset+=items.length;
    if(expectedTotal!==null&&offset>=expectedTotal)break;
    if(items.length<pageLimit&&expectedTotal===null)break;
    // Full ingestion: no hidden max-pages or fixed sample cap.
  }
  const manifest={schema:'SCF-SF41/capture-v1',generated_at:new Date().toISOString(),
    endpoint:original.origin+original.pathname,claimed_permission:permission,
    page_size:pageLimit,expected_total:expectedTotal,rows_captured:offset,
    sources,read_only:true,does_not_prove_paid_settlement:true};
  const manifestText=JSON.stringify(manifest,null,2)+'\n';
  await writeFile(join(dir,'sources.json'),manifestText);
  await writeFile(join(dir,'capture-report.json'),JSON.stringify({statuses,sources:statuses.length,rows:offset,
    source_manifest_sha256:sha(Buffer.from(manifestText))},null,2)+'\n');
  process.stdout.write(JSON.stringify({manifest:join(dir,'sources.json'),source_pages:sources.length,
    rows:offset,manifest_sha256:sha(Buffer.from(manifestText))},null,2)+'\n');
}
main().catch(e=>{process.stderr.write('Capture failed: '+String(e.message||e)+'\n');process.exitCode=1;});
