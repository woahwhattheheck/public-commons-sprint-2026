// MIT — One local source-native collection, receiving and HTTP workflow.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, rename, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serveLibrary } from './server.mjs';
import { collectionExtension } from './collection-ui.mjs';
import { openLibrary } from './library.mjs';
import { digest } from './files.mjs';
import { exportCollection, receiveCollection, openReceivedLibrary, inspectCollectionArchive, prepareCollectionDownload } from './collection-package.mjs';
const root=await mkdtemp(join(tmpdir(),'starforge-collections-'));
let activeLibrary,host;
try {
await mkdir(join(root,'files'),{mode:0o700});
const inputs=[Buffer.from('{"quantity":900719925474099312345,"description":"Crème 東京 </script>"}\r\n'),
  Buffer.from([0,255,6,4,10,13,2]),Buffer.alloc(16*1024*1024,87)];
const jobs=[];
for(let i=0;i<inputs.length;i++) {
 const path=join(root,'files',i===1?'payload.bin':i===2?'long-report.txt':'quantity.json');await writeFile(path,inputs[i],{mode:0o600});
 const intentId='collection-source-'+i;
 jobs.push({schema:'stellar-forge.sf88.buyer-inbox.v1',id:digest(intentId),state:'COMPLETE',configSha256:digest('config-'+i),
  operation:{intentId,method:'GET',url:'https://merchant.example/resources/'+i,expect:{maxAtomic:'9007199254740993'}},
  outcome:{intentId,mode:'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT',responseFile:{path,bytes:inputs[i].length,sha256:digest(inputs[i]),contentType:i===1?'application/octet-stream':'text/plain',status:'SAVED'}}});
}
const snapshot=join(root,'snapshot.json');await writeFile(snapshot,JSON.stringify(jobs),{mode:0o600});
let library=activeLibrary=await openLibrary({state:join(root,'library'),kind:'snapshot',source:snapshot,roots:[join(root,'files')],indexBytes:4096});
const scan=await library.scan();assert.equal(scan.counts.VERIFIED,3);
let members=library.search().items;
const noted=library.saveAnnotation(members[0].id,{expectedRevision:0,operationId:'note-1',note:'Reviewed original source',tags:['research'],starred:true});
const select=()=>library.search().items.map(r=>({id:r.id,sha256:r.sha256,annotationRevision:r.annotation.revision}));
const input={id:'customer-handoff',expectedRevision:0,operationId:'collection-1',name:'Customer research',note:'Selected source edition',members:select()};
const first=library.collections.save(input);assert.equal(first.revision,1);
assert.deepEqual(library.collections.save(input),first);
assert.throws(()=>library.collections.save({...input,operationId:'stale'}),{code:'COLLECTION_REVISION_CONFLICT'});
const second=library.collections.save({...input,expectedRevision:1,operationId:'collection-2',name:'Research handoff — edition 2',members:first.members.map(r=>({id:r.id,mode:'retain',sha256:r.sha256,annotationRevision:r.annotation.revision}))});
assert.equal(second.revision,2);assert.equal(library.collections.history(input.id).total,2);
const tar=join(root,'handoff.tar'),output=await exportCollection(library,{id:input.id,revision:1,destination:tar});
const check=await inspectCollectionArchive(tar,{expectedSha256:output.sha256});assert.equal(check.manifest.collection.revision,1);
const descriptor=await prepareCollectionDownload(library,{id:input.id,revision:1});
const buf=Buffer.alloc(descriptor.bytes);await descriptor.file.read(buf,0,buf.length,0);assert.equal(digest(buf),output.sha256);await descriptor.dispose();
await library.close();library=activeLibrary=await openLibrary({state:join(root,'library')});assert.equal(library.collections.show(input.id).revision,2);await library.close();
const received=await receiveCollection({archive:tar,destination:join(root,'received'),expectedSha256:output.sha256});
const again=await receiveCollection({archive:tar,destination:received.directory,resume:true,expectedSha256:output.sha256});assert.deepEqual(again,received);
await rename(join(root,'files'),join(root,'source-removed'));
const recipient=activeLibrary=await openReceivedLibrary({directory:received.directory,state:join(root,'recipient')});
const rows=recipient.search().items;assert.equal(rows.length,3);assert.equal(recipient.collections.show(input.id).name,'Customer research');
for(const row of rows){assert.equal(digest(await readFile(row.path)),row.sha256);assert.equal(row.origin.manifestSha256,output.manifestSha256);}
assert.equal(recipient.search({starred:true}).total,1);
const imported=rows.find(r=>r.annotation.note);assert.equal(imported.annotation.revision,0);assert.equal(imported.annotation.inheritedRevision,1);
recipient.saveAnnotation(imported.id,{expectedRevision:0,operationId:'receiver-note',note:'Receiving-team observation',tags:['received'],starred:false});
assert.equal(recipient.search({starred:true}).total,0);
await recipient.close();
const reopened=activeLibrary=await openLibrary({state:join(root,'recipient')});assert.equal(reopened.resource(imported.id).annotation.note,'Receiving-team observation');await reopened.close();
// Cancellation retains an exact intake for same-package resume; partial bytes never become a manifest.
const cancel=new AbortController();cancel.abort();await assert.rejects(receiveCollection({archive:tar,destination:join(root,'cancelled'),signal:cancel.signal}));
const broken=join(root,'broken.tar');await copyFile(tar,broken);const bad=await readFile(broken);const manifestSize=parseInt(bad.subarray(124,136).toString('ascii'),8);bad[512+Math.ceil(manifestSize/512)*512+512]^=1;await writeFile(broken,bad);
await assert.rejects(receiveCollection({archive:broken,destination:join(root,'broken')}),{code:'COLLECTION_OBJECT_DIGEST_CHANGED'});
const repaired=await receiveCollection({archive:tar,destination:join(root,'broken'),resume:true});assert.equal(repaired.sha256,output.sha256);
// The same HTTP service carries original resource and collection downloads.
activeLibrary=await openLibrary({state:join(root,'recipient')});
const extension=await collectionExtension(activeLibrary);
host=await serveLibrary(activeLibrary,{...extension,authenticatedRoute:[()=>false,extension.authenticatedRoute]});
const call=async(path,method='GET',body)=>{
  const response=await fetch(host.origin+path,{method,headers:{Authorization:'Bearer '+host.token,
    ...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
};
assert.equal((await fetch(host.origin+'/api/collections')).status,401);
assert.equal((await fetch(host.origin+'/api/collections',{headers:{Authorization:'Bearer '+host.token,Origin:'https://outside.example'}})).status,403);
assert.ok((await(await fetch(host.origin+'/collections')).text()).includes('Research collections'));
const receivedEdition=await call('/api/collections/customer-handoff');
const save={id:receivedEdition.id,name:'Receiving review',note:'Preserve the selected original edition',
  expectedRevision:1,operationId:'http-save',members:receivedEdition.members.map(r=>({id:r.id,mode:'retain',sha256:r.sha256,annotationRevision:r.annotation.revision}))};
const saved=await call('/api/collections','PUT',save);assert.equal(saved.revision,2);
assert.deepEqual(await call('/api/collections','PUT',save),saved);
const quantity=saved.members.find(r=>r.name==='quantity.json');
const preview=await call(`/api/collections/customer-handoff/preview?revision=2&resource=${quantity.id}`);
assert.ok(preview.text.includes('900719925474099312345'));
const transfer=await call('/api/collections/customer-handoff/download','POST',{revision:2});
const transferred=Buffer.from(await(await fetch(host.origin+transfer.url)).arrayBuffer());
assert.equal(digest(transferred),transfer.sha256);
assert.equal((await fetch(host.origin+transfer.url)).status,404);
const held=[await call('/api/resources/'+quantity.id+'/download','POST',{})];
for(let i=0;i<3;i++)held.push(await call('/api/collections/customer-handoff/download','POST',{revision:2}));
assert.equal((await fetch(host.origin+'/api/resources/'+quantity.id+'/download',{method:'POST',headers:{Authorization:'Bearer '+host.token,'Content-Type':'application/json'},body:'{}'})).status,429);
for(const item of held)await(await fetch(host.origin+item.url)).arrayBuffer();
await host.close();host=null;await activeLibrary.close();activeLibrary=null;
console.log(JSON.stringify({result:'PASS',files:inputs.length,sourceBytes:inputs.reduce((n,b)=>n+b.length,0),archiveBytes:output.bytes,
 collectionRevisions:2,portableSha256:output.sha256,originalRemoved:true,receiverNoteReopened:true,interruptedReceiveResumed:true,nativeHttp:true,sharedTransferCapacity:true},null,2));

} finally {if(host)await host.close();if(activeLibrary)await activeLibrary.close();await rm(root,{recursive:true,force:true});}
