#!/usr/bin/env node
// MIT. Read-only authenticated or public *original facilitator* Bazaar capture.
// Intentionally no payment, verification, settlement, wallet or origin calls.
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

const args=process.argv.slice(2);
const option=n=>{const i=args.indexOf(n);return i<0?null:args[i+1]};
const need=n=>{const s=option(n);if(!s)throw Error('Required '+n);return s};
const sha=b=>createHash('sha256').update(b).digest('hex');
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
const word=s=>String(s).replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,72);
const rowsOf=body=>Array.isArray(body)?body:body?.items??body?.resources??body?.data?.items??body?.data?.resources;
const PAGE_LIMIT_BYTES=16*1024*1024;

// A per-response memory cap, never a cap on total provider rows or pages.
export async function readBoundedPage(res,maxBytes=PAGE_LIMIT_BYTES){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('Invalid page byte limit');
  const declared=res.headers?.get('content-length');
  if(declared!==null&&declared!==undefined&&Number.isFinite(Number(declared))&&Number(declared)>maxBytes)
    throw Error('Native page exceeds byte limit');
  if(!res.body?.getReader)throw Error('Native GET has no readable body');
  const reader=res.body.getReader();let bytes=0;const chunks=[];
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes)throw Error('Native page exceeds byte limit');
      chunks.push(value);
    }
    return Buffer.concat(chunks.map(chunk=>Buffer.from(chunk)),bytes);
  }catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally{reader.releaseLock();}
}

// Validate pagination metadata against the *requested* native offset. Some
// providers omit total; those require one explicit empty terminal page.
// Never count a short page as end-of-corpus by itself.
export function checkNativePage(body,{offset,pageLimit,expectedTotal=null}={}){
  const items=rowsOf(body);
  if(!Array.isArray(items))throw Error('Capture is not a native array/items/resources response');
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(pageLimit)||pageLimit<1||pageLimit>100)
    throw Error('Invalid capture offset or requested limit');
  if(body?.x402Version!==undefined&&body.x402Version!==2)throw Error('Non-v2 discovery response');
  if(items.length>pageLimit)throw Error('Native page exceeds requested limit');
  const pagination=body?.pagination;
  if(pagination!==undefined&&pagination!==null){
    if(typeof pagination!=='object'||Array.isArray(pagination))throw Error('Malformed native pagination');
    for(const key of ['offset','limit','total']){
      if(pagination[key]!==undefined&&(!Number.isSafeInteger(pagination[key])||pagination[key]<0))
        throw Error('Malformed native pagination '+key);
    }
    if(pagination.offset!==undefined&&pagination.offset!==offset)
      throw Error('Native page offset mismatch at '+offset);
    if(pagination.limit!==undefined&&(pagination.limit<1||pagination.limit>100||items.length>pagination.limit))
      throw Error('Native page limit mismatch at '+offset);
  }
  const nextTotal=pagination?.total??expectedTotal;
  if(expectedTotal!==null&&pagination?.total!==undefined&&pagination.total!==expectedTotal)
    throw Error('Native total changed while capturing at '+offset);
  if(nextTotal!==null&&offset+items.length>nextTotal)
    throw Error('Native rows exceed declared total at '+offset);
  if(items.length===0&&nextTotal!==null&&offset<nextTotal)
    throw Error('Native pagination truncated at '+offset+' of '+nextTotal);
  return {
    items,
    total:nextTotal,
    nextOffset:offset+items.length,
    complete:nextTotal===null?items.length===0:offset+items.length===nextTotal,
    coverage:nextTotal===null?'EXPLICIT_EMPTY_PAGE':'DECLARED_TOTAL_MATCHED',
  };
}

async function main(){
  const original=new URL(need('--url'));
  if(original.protocol!=='https:'||original.username||original.password||original.hash||original.search)
    throw Error('Only HTTPS facilitator URLs without credentials, hash, or query');
  if(!original.pathname.endsWith('/discovery/resources'))throw Error('Only original /discovery/resources, never payment or origin endpoints');
  const id=word(need('--id')),dir=resolve(need('--out'));
  if(!id)throw Error('Nonempty capture id required');
  const permission=need('--permission');
  if(!['public-read','authorized-operator'].includes(permission))throw Error('--permission must state legitimate capture authority');
  const envname=option('--bearer-env');
  const token=envname?process.env[envname]:null;
  if(envname&&!token)throw Error('Bearer environment variable missing');
  const pageLimit=Number(option('--page-size')||100);
  if(!Number.isSafeInteger(pageLimit)||pageLimit<1||pageLimit>100)throw Error('page-size 1..100 per x402 native spec');
  await mkdir(dir,{recursive:true});
  const sources=[],statuses=[],pageTimes=[],seenPages=new Map();
  let offset=0,expectedTotal=null,coverage=null;
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
          const retry=Number(res.headers.get('retry-after')||0);
          await res.body?.cancel();
          await wait(Number.isFinite(retry)&&retry>0?Math.min(120000,retry*1000):1000*2**attempt);
          continue;
        }
        if(res.status!==200){await res.body?.cancel();throw Error('Original facilitator HTTP '+res.status+' at offset '+offset);}
        if(new URL(res.url).origin!==original.origin)throw Error('Cross-origin redirect refused');
        raw=await readBoundedPage(res);
        pageTimes.push(performance.now()-started);
        break;
      }catch(e){err=e;if(attempt===3)throw e;await wait(1000*2**attempt);}
    }
    if(!raw)throw Error('No native GET bytes: '+String(err||'unknown'));
    const pageHash=sha(raw);
    if(seenPages.has(pageHash))throw Error('Repeated native response bytes at offsets '+seenPages.get(pageHash)+' and '+offset);
    seenPages.set(pageHash,offset);
    const parsed=JSON.parse(raw.toString('utf8'));
    const page=checkNativePage(parsed,{offset,pageLimit,expectedTotal});
    expectedTotal=page.total;
    const stamp=new Date().toISOString(),filename=id+'-'+String(offset).padStart(8,'0')+'.json';
    // Never overwrite original preserved native bytes with a later run.
    await writeFile(join(dir,filename),raw,{flag:'wx'});
    sources.push({id:id+'-'+offset,url:url.href,captured_at:stamp,method:'GET',status:200,
      permission,file:filename,sha256:pageHash});
    statuses.push({offset,rows:page.items.length,sha256:pageHash,elapsed_ms:pageTimes.at(-1)});
    offset=page.nextOffset;
    if(page.complete){coverage=page.coverage;break;}
  }
  const manifest={schema:'SCF-SF41/capture-v1',generated_at:new Date().toISOString(),
    endpoint:original.origin+original.pathname,claimed_permission:permission,
    page_size:pageLimit,expected_total:expectedTotal,rows_captured:offset,
    pagination_coverage:coverage,sources,read_only:true,does_not_prove_paid_settlement:true};
  const manifestText=JSON.stringify(manifest,null,2)+'\n';
  await writeFile(join(dir,'sources.json'),manifestText,{flag:'wx'});
  await writeFile(join(dir,'capture-report.json'),JSON.stringify({statuses,sources:statuses.length,rows:offset,
    source_manifest_sha256:sha(Buffer.from(manifestText))},null,2)+'\n',{flag:'wx'});
  process.stdout.write(JSON.stringify({manifest:join(dir,'sources.json'),source_pages:sources.length,
    rows:offset,manifest_sha256:sha(Buffer.from(manifestText))},null,2)+'\n');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(e=>{process.stderr.write('Capture failed: '+String(e.message||e)+'\n');process.exitCode=1;});
