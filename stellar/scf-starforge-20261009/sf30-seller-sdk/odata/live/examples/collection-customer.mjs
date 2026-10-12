// MIT. Complete retained-input OData service and customer collection operation.
import { readFile,mkdir,stat } from 'node:fs/promises';
import { dirname,join,resolve,relative,isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { openODataWorkspace } from '../../workspace.mjs';
import { openODataLiveOperations } from '../../live-operations.mjs';
import { startODataServer } from '../../server.mjs';
import { readCollectionRows,restoreCollection,collectionAnalysisMapping } from '../collection.mjs';
import { atomic,formatted,stable } from '../../state.mjs';

const hash=raw=>createHash('sha256').update(raw).digest('hex');
const need=(value,message)=>{if(!value)throw new Error(message);};
const json=path=>readFile(path).then(raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)));
async function identified(path,expected){
  const raw=await readFile(path);
  if(expected)need(raw.length===expected.bytes&&hash(raw)===expected.sha256,'Selected original file changed: '+path);
  return raw;
}
async function save(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});await atomic(path,value);}
function within(root,path){
  const part=relative(root,resolve(path));need(part&&!part.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&part!=='..'&&!isAbsolute(part),'Select a retained packet member.');
  return part;
}
function relocate(packetRoot,packet,path){return join(packetRoot,within(resolve(packet.directory),path));}
async function existing(path){try{return await json(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function allRows(live,id,collectionId,expectedSha){
  const rows=[];let offset=0;
  do{const page=await live.collectionRows({id,collectionId,offset,limit:100});
    need(page.collectionSha256===expectedSha&&page.offset===offset,'Collection page identity changed.');
    rows.push(...page.rows);offset=page.nextOffset;
  }while(offset!==null);
  return rows;
}
async function prepare(input){
  const packetRoot=resolve(input.packetDirectory),output=resolve(input.outputDirectory),packetRaw=await readFile(join(packetRoot,'packet.json'));
  const packet=JSON.parse(packetRaw),selected=packet.selectedQuery;
  need(packet.schema==='stellar-forge.odata-retained-receiving-source.v1'&&packet.rows===input.expectedRows&&
    packet.live.sourceBinding===input.sourceBinding&&packet.queryFingerprint===input.queryFingerprint,'Select the reviewed original live input packet.');
  need(packet.responses.length===input.responseFiles.length,'The selected response chain changed.');
  const sourceDirectory=relocate(packetRoot,packet,packet.workspace.directory),serviceId=packet.live.id,collectionId=input.collectionId;
  const sourceState=await readFile(join(sourceDirectory,'workspace.json'));
  need(hash(sourceState)===packet.workspace.sha256,'The retained source workspace changed.');
  const profile=await readFile(join(sourceDirectory,'live','products',serviceId,'profile.json'));
  need(hash(profile)===packet.live.profileSha256,'The retained service profile changed.');
  need(hash(await readFile(join(sourceDirectory,'live','products',serviceId,'package','package.json')))===packet.live.packageManifestSha256,
    'The retained service package changed.');
  const originalRows=[],originals=[];
  for(let index=0;index<packet.responses.length;index++){
    const record=packet.responses[index],expected=input.responseFiles[index];
    need(record.bytes===expected.bytes&&record.sha256===expected.sha256,'The reviewed response selection changed.');
    const path=relocate(packetRoot,packet,record.file),raw=await identified(path,expected),response=JSON.parse(raw);
    originalRows.push(...response.items);originals.push({path,raw,sha256:hash(raw)});
  }
  need(originalRows.length===input.expectedRows,'The original row count changed.');
  await mkdir(output,{recursive:true,mode:0o700});
  const baselinePath=join(output,'original-odata-transfer.json');
  let baseline=await existing(baselinePath);
  if(!baseline){
    const original=await openODataWorkspace({directory:sourceDirectory});
    try{baseline=await original.backup();await save(baselinePath,baseline);}finally{await original.close();}
  }
  need(stable(baseline.state)===stable(JSON.parse(sourceState)),'The retained input transfer changed.');
  const directory=join(output,'merchant-workspace'),workspace=await openODataWorkspace({directory});
  let live,server,collection,transfer,publicRows,routeFiles=[];
  try{
    await workspace.restore(baseline);
    live=await openODataLiveOperations({workspace});
    server=await startODataServer({workspace,port:0,liveOperations:live,closeWorkspace:false});
    async function request(path,body){
      const response=await fetch(server.url+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const value=await response.json();
      need(response.ok,'Original OData API '+path+': '+(value.message||value.error||response.status));return value;
    }
    for(const path of ['/','/app.mjs','/collection-view.mjs']){
      const response=await fetch(server.url+path),raw=Buffer.from(await response.arrayBuffer());
      need(response.ok,'The original collection UI asset did not open.');
      if(path==='/')need(raw.includes(Buffer.from('id="live-collections"')),'The original collection UI is absent.');
      routeFiles.push({path,bytes:raw.length,sha256:hash(raw)});
    }
    const pages=[];
    for(const original of originals){
      const page=await request('/api/live/receive',{id:serviceId,bodyBase64:original.raw.toString('base64')});
      need(page.id===original.sha256&&page.queryFingerprint===input.queryFingerprint,'The original saved response receiving changed.');
      pages.push({receivedId:page.id});
    }
    const selection={id:serviceId,collectionId,pages,title:input.title};
    collection=await request('/api/live/collection',selection);
    need(collection.rows===input.expectedRows&&collection.sourceBinding===input.sourceBinding&&
      collection.queryFingerprint===input.queryFingerprint,'The completed collection differs from its selected source.');
    const repeated=await request('/api/live/collection',selection);
    need(repeated.manifestSha256===collection.manifestSha256,'The same collection selection did not reopen.');
    const inventory=await request('/api/live/collections?id='+encodeURIComponent(serviceId));
    need(inventory.some(item=>item.id===collectionId&&item.status==='READY'&&item.manifestSha256===collection.manifestSha256),'The original service did not retain its collection.');
    const opened=await request('/api/live/collection?'+new URLSearchParams({id:serviceId,collectionId}));
    need(opened.manifestSha256===collection.manifestSha256,'The original API opened another collection.');
    publicRows=[];let offset=0;
    do{const page=await request('/api/live/collection/rows?'+new URLSearchParams({id:serviceId,collectionId,offset,limit:100}));
      need(page.collectionSha256===collection.manifestSha256,'The original row API source changed.');
      publicRows.push(...page.rows);offset=page.nextOffset;
    }while(offset!==null);
    need(stable(publicRows)===stable(originalRows),'The completed collection changed an original source value.');
    for(const name of ['dataset.csv','rows.jsonl','rows-index.jsonl','analysis/source.json']){
      const response=await fetch(server.url+'/api/live/file?'+new URLSearchParams({id:serviceId,kind:'collection',recordId:collectionId,name}));
      const raw=Buffer.from(await response.arrayBuffer());
      const expected=name==='analysis/source.json'?collection.analysis:collection.files[name];
      need(response.ok&&raw.length===expected.bytes&&hash(raw)===expected.sha256,'The original collection download changed.');
      routeFiles.push({path:name,bytes:raw.length,sha256:hash(raw)});
    }
    const transferPath=join(output,'OData_Collection_Workspace.json');
    transfer=await existing(transferPath);
    if(!transfer){transfer=await request('/api/backup');await save(transferPath,transfer);}
    const retained=transfer.files.find(file=>file.path==='live/products/'+serviceId+'/collections/'+collectionId+'/collection.json');
    need(retained?.sha256===collection.manifestSha256,'The complete workspace transfer omits its original collection.');
  }finally{if(server)await server.close();if(live)await live.close();await workspace.close();}
  const receivingDirectory=join(output,'received-merchant-workspace');
  const receiving=await openODataWorkspace({directory:receivingDirectory});let receivedLive,transferResult;
  try{
    transferResult=await receiving.restore(transfer);receivedLive=await openODataLiveOperations({workspace:receiving});
    const opened=await receivedLive.collection({id:serviceId,collectionId});
    need(opened.manifestSha256===collection.manifestSha256,'The complete OData transfer changed its collection.');
    need(stable(await allRows(receivedLive,serviceId,collectionId,collection.manifestSha256))===stable(originalRows),
      'The received OData workspace changed the original records.');
  }finally{if(receivedLive)await receivedLive.close();await receiving.close();}
  const reopened=await openODataWorkspace({directory:receivingDirectory});let reopenedLive;
  try{reopenedLive=await openODataLiveOperations({workspace:reopened});
    const result=await reopenedLive.collection({id:serviceId,collectionId});
    need(result.manifestSha256===collection.manifestSha256,'The closed and reopened OData service changed.');}
  finally{if(reopenedLive)await reopenedLive.close();await reopened.close();}
  const result={schema:'stellar-forge.odata-collection-customer-prepared.v1',packet:{bytes:packetRaw.length,sha256:hash(packetRaw)},
    sourceBinding:input.sourceBinding,queryFingerprint:input.queryFingerprint,originalRows:input.expectedRows,serviceId,collectionId,
    collection,mapping:collectionAnalysisMapping(collection,{source:input.analysisSource,sourceRevision:1}),
    workspaceDirectory:directory,receivingDirectory,transferResult,sourceRouteFiles:routeFiles,
    originalTransfer:baselinePath,completeTransfer:join(output,'OData_Collection_Workspace.json')};
  await save(join(output,'collection-operation.json'),result);return result;
}
async function restore(input){
  const prepared=await json(join(input.outputDirectory,'collection-operation.json'));
  const result=await restoreCollection({sourceManifest:input.analysisManifest,
    directory:join(input.outputDirectory,'analysis-restored-collection'),expectedSha256:prepared.collection.analysis.sha256});
  need(result.manifestSha256===prepared.collection.manifestSha256,'Analysis receiving changed the original collection.');
  const rows=[];let offset=0;
  do{const page=await readCollectionRows(result.directory,{offset,limit:100});rows.push(...page.rows);offset=page.nextOffset;}while(offset!==null);
  const original=[];
  for(const record of input.responseFiles){const response=JSON.parse(await identified(record.path,record));original.push(...response.items);}
  need(stable(rows)===stable(original),'Analysis receiving changed original supplier values.');
  const output={schema:'stellar-forge.odata-collection-customer-restored.v1',rows:rows.length,
    collectionSha256:result.manifestSha256,sourceManifest:input.analysisManifest,restoredFrom:result.restoredFrom,directory:result.directory};
  await save(join(input.outputDirectory,'collection-analysis-restored.json'),output);return output;
}
const [action,inputPath,...extra]=process.argv.slice(2);
if(!['prepare','restore'].includes(action)||!inputPath||extra.length)throw new Error('Use collection-customer.mjs prepare|restore INPUT.json');
const input=await json(resolve(inputPath));
need(input.schema==='stellar-forge.odata-collection-customer-input.v1','Select an original collection customer input.');
const result=action==='prepare'?await prepare(input):await restore(input);
process.stdout.write(JSON.stringify({schema:result.schema,rows:result.originalRows??result.rows,
  collectionSha256:result.collection?.manifestSha256??result.collectionSha256,outputDirectory:input.outputDirectory})+'\n');
