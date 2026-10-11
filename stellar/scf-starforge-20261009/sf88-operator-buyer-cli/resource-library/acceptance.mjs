// MIT — One complete local source/file/review/restart journey; no hosted workflow.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openLibrary } from './library.mjs';
import { serveLibrary } from './server.mjs';
import { digest } from './files.mjs';

export async function fixtures(root) {
  const files=join(root,'files');await mkdir(files,{mode:0o700});
  const jobs=[];
  async function add(intent,name,bytes,{status='SAVED',missing=false}={}) {
    const path=join(files,name);
    if(!missing)await writeFile(path,bytes,{mode:0o600});
    jobs.push({schema:'stellar-forge.sf88.buyer-inbox.v1',id:digest(intent),configSha256:digest('config:'+intent),
      createdAt:'2026-10-11T20:00:00Z',state:'ATTEMPT_RECORDED',
      operation:{intentId:intent,method:'GET',url:'https://merchant.example/data/'+name+'?token=hidden-secret#callback',
        expect:{scheme:'exact',network:'fixture-network',asset:'fixture-asset',payTo:'fixture-recipient',maxAtomic:'900719925474099312345'}},
      outcome:{mode:'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT',intentId:intent,status:'LOCAL_RESPONSE_FIXTURE',httpStatus:200,
        responseFile:{status,path,bytes:bytes.length,sha256:digest(bytes),contentType:name.endsWith('.json')?'application/json':'text/plain'}}});
  }
  const json=Buffer.from('{"dataset":"regional inventory","revision":900719925474099312345,"note":"<script>globalThis.executed=true</script>","category":"copper conduit"}\n');
  await add('inventory-json','inventory.json',json);
  await add('orders-csv','orders.csv',Buffer.from('part,description,units\nC-01,copper conduit,26\nS-02,steel bracket,40\n'));
  await add('binary-output','drawing.bin',Buffer.from([0,255,1,3,7,10]));
  await add('large-text','manual.txt',Buffer.from('copper conduit\n'+'λ'.repeat(5000)+'suffix-not-indexed'));
  await add('incomplete','interrupted.bin',Buffer.from('unfinished payload'),{status:'FAILED'});
  await add('missing-output','missing.txt',Buffer.from('missing original bytes'),{missing:true});
  const snapshot=join(root,'inbox-list.json');await writeFile(snapshot,JSON.stringify(jobs),{mode:0o600});
  return {files,jobs,snapshot,json};
}
async function cli(...args) {
  const child=spawn(process.execPath,[new URL('./cli.mjs',import.meta.url).pathname,...args],{stdio:['ignore','pipe','pipe']});
  let out='',error='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>error+=b);
  const [code]=await once(child,'close');assert.equal(code,0,error);return out;
}
async function run() {
  const root=await mkdtemp(join(tmpdir(),'sf-resource-'));
  let library,host;
  try {
    const f=await fixtures(root),state=join(root,'library');
    library=await openLibrary({state,kind:'snapshot',source:f.snapshot,roots:[f.files],indexBytes:1024});
    const scan=await library.scan();assert.deepEqual(scan.counts,{VERIFIED:4,INCOMPLETE:1,UNAVAILABLE:1});
    const results=library.search({q:'copper conduit'});assert.equal(results.total,3);
    const inventory=results.items.find(r=>r.name==='inventory.json');
    assert.equal(inventory.paymentTerms.maxAtomic,'900719925474099312345');
    assert.equal((await library.preview(inventory.id)).text,f.json.toString());
    assert.equal(library.search({q:'suffix-not-indexed'}).total,0);
    const large=library.search({q:'manual'}).items[0];assert.equal(large.verification.coverage,'PREFIX');
    assert.equal((await library.preview(large.id)).indexedBytes,1023);
    assert.equal((await library.preview(library.search({q:'drawing'}).items[0].id)).coverage,'BINARY');
    const note={expectedRevision:0,operationId:'review-1',note:'Use the conduit inventory in the supplier review.',tags:['supplier','inventory'],starred:true};
    const first=library.saveAnnotation(inventory.id,note);
    const second=library.saveAnnotation(inventory.id,{...note,operationId:'review-2',expectedRevision:1,note:'Confirmed source revision; compare orders next.'});
    assert.equal(second.revision,2);assert.deepEqual(library.saveAnnotation(inventory.id,note),first);
    assert.throws(()=>library.saveAnnotation(inventory.id,{...note,operationId:'stale-write'}),{code:'ANNOTATION_REVISION_CONFLICT'});
    assert.throws(()=>library.saveAnnotation(inventory.id,{...note,note:'changed'}),{code:'OPERATION_ID_CONFLICT'});
    assert.equal(library.search({starred:true}).total,1);library.select(inventory.id);
    const exported=library.exportReview();assert.equal(exported.annotations.length,2);
    assert(!JSON.stringify(exported).includes('hidden-secret'));
    await library.close();library=await openLibrary({state});
    assert.equal(library.status().selection,inventory.id);assert.equal(library.resource(inventory.id).annotation.revision,2);
    const download=await library.download(inventory.id);
    const copied=[];for await(const part of download.file.createReadStream({start:0,autoClose:false}))copied.push(part);
    await download.dispose();assert.deepEqual(Buffer.concat(copied),f.json);
    // Same-size mutation cannot become a preview or a verified download.
    await writeFile(join(f.files,'inventory.json'),Buffer.alloc(f.json.length,120));
    await assert.rejects(library.preview(inventory.id),{code:'FILE_DIGEST_CHANGED'});
    await library.scan();assert.equal(library.resource(inventory.id).status,'UNAVAILABLE');
    await writeFile(join(f.files,'inventory.json'),f.json);await library.scan();
    const oldGeneration=library.status().scan.generation;
    const stop=new AbortController();
    await assert.rejects(library.scan({signal:stop.signal,onProgress:()=>stop.abort(new Error('user stop'))}));
    assert.equal(library.status().scan.generation,oldGeneration);
    // An actual killed process leaves a staged generation; the next process
    // reclaims its dead-owner lease while retaining the previously published index.
    const child=spawn(process.execPath,['--input-type=module','-e',`
      import {openLibrary} from ${JSON.stringify(new URL('./library.mjs',import.meta.url).href)};
      import {writeSync} from 'node:fs';
      const library=await openLibrary({state:${JSON.stringify(state)}});
      await library.scan({onProgress(){writeSync(1,'STAGED\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}});
    `],{stdio:['ignore','pipe','pipe']});
    await once(child.stdout,'data');child.kill('SIGKILL');await once(child,'close');
    assert.equal(library.status().scan.generation,oldGeneration);
    await library.scan();assert.equal(library.resource(inventory.id).annotation.revision,2);
    // Paths remain tied to the operator's declaration, including symlink aliases.
    const linkPath=join(f.files,'alias.json');await symlink(join(f.files,'inventory.json'),linkPath);
    const linked={...f.jobs[0],outcome:{...f.jobs[0].outcome,responseFile:{...f.jobs[0].outcome.responseFile,path:linkPath}}};
    await writeFile(f.snapshot,JSON.stringify([...f.jobs,linked]),{mode:0o600});await library.scan();
    assert.equal(library.search({q:'alias'}).items[0].error,'SYMLINK_FILE_REFUSED');
    host=await serveLibrary(library);
    const request=(path,options={})=>fetch(host.origin+path,{...options,headers:{Authorization:'Bearer '+host.token,...options.headers}});
    assert.equal((await fetch(host.origin+'/api/status')).status,401);
    assert.equal((await request('/api/status',{headers:{Origin:'https://attacker.example'}})).status,403);
    const prepare=await request(`/api/resources/${inventory.id}/download`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(prepare.status,200);const transfer=await prepare.json();
    const response=await fetch(host.origin+transfer.url);assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.json);
    assert.equal((await fetch(host.origin+transfer.url)).status,404);
    const over=await request('/api/resources?limit=10000');assert.equal(over.status,400);
    await host.close();host=null;await library.close();library=null;
    const output=join(root,'copied.json');
    await cli('download','--state',state,'--id',inventory.id,'--out',output);assert.deepEqual(await readFile(output),f.json);
    await cli('export','--state',state,'--out',join(root,'review.json'));
    const report=JSON.parse(await readFile(join(root,'review.json'),'utf8'));assert.equal(report.annotations.length,2);
    console.log(JSON.stringify({status:'PASS',resources:7,verifiedOriginalBytes:f.json.length,reviewRevisions:2,
      sourceRefresh:'atomic',processRecovery:'SIGKILL',browserTransfer:'exact-and-single-use',cliExport:'complete'},null,2));
  } finally {if(host)await host.close();if(library)await library.close();await rm(root,{recursive:true,force:true});}
}
if(process.argv[1]===new URL(import.meta.url).pathname)run().catch(e=>{console.error(e);process.exitCode=1;});
