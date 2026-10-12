#!/usr/bin/env node
// MIT. Customer workspace, capture, report and portable receiving commands.
import { parseArgs } from 'node:util';
import { readFile, open, mkdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { startManagedFacility, inspectFacilityWorkspace } from './managed-launch.mjs';
import { openFacilityStore } from './store.mjs';
import { SourceCaptures } from './provider.mjs';
import { downloadCollectionArchive } from './buyer-collections.mjs';
import { need, uuid, parseBytes, renderFacilityCsv, reviewCsv, handoverHtml, hash, SOURCE_LIMIT } from './model.mjs';

export const HELP=`Facility operations desk — Node.js 24 or later

starforge usgs-facility-events [serve] --workspace PRIVATE_DIRECTORY [--port 0]
starforge usgs-facility-events inspect --workspace PRIVATE_DIRECTORY
starforge usgs-facility-events project --workspace PRIVATE_DIRECTORY --settings PROJECT.json [--operation-id ID]
starforge usgs-facility-events ingest --workspace PRIVATE_DIRECTORY --project ID --roster FACILITIES.json --source ORIGINAL.geojson [--source OTHER.geojson] --name REPORT --operator NAME [--operation-id ID]
starforge usgs-facility-events show --workspace PRIVATE_DIRECTORY --project ID
starforge usgs-facility-events collection-import --workspace PRIVATE_DIRECTORY --project ID --archive ORIGINAL.tar --operator NAME [--sha256 HASH] [--note TEXT] [--operation-id ID]
starforge usgs-facility-events collection-show --workspace PRIVATE_DIRECTORY --project ID --collection ID [--query TEXT] [--offset 0] [--limit 50]
starforge usgs-facility-events collection-sources --workspace PRIVATE_DIRECTORY --project ID --collection ID --member ID [--member ID] --operator NAME [--note TEXT] [--operation-id ID]
starforge usgs-facility-events collection-export --workspace PRIVATE_DIRECTORY --project ID --collection ID --out NEW_FILE.tar
starforge usgs-facility-events edition --workspace PRIVATE_DIRECTORY --project ID --roster FACILITIES.json --source-id ID [--source-id ID] --name REPORT --operator NAME [--note TEXT] [--operation-id ID]
starforge usgs-facility-events edition --workspace PRIVATE_DIRECTORY --project ID --roster-id ID --source-id ID [--source-id ID] --name REPORT --operator NAME [--operation-id ID]
starforge usgs-facility-events capture --workspace PRIVATE_DIRECTORY --project ID --query QUERY.json [--operation-id ID]
starforge usgs-facility-events capture --workspace PRIVATE_DIRECTORY --project ID --capture ID
starforge usgs-facility-events report --workspace PRIVATE_DIRECTORY --project ID --edition ID --out NEW_DIRECTORY
starforge usgs-facility-events export --workspace PRIVATE_DIRECTORY --project ID --out NEW_FILE.ndjson
starforge usgs-facility-events import --workspace PRIVATE_DIRECTORY --input COMPLETE.ndjson [--operation-id ID]

The browser keeps facilities, original public or merchant-delivered GeoJSON,
source windows, saved reports, assigned actions and full review history together.
Original SF88 collection archives retain every member, annotation and buyer outcome.
Select 1–16 original event responses for a report; the whole archive accompanies
complete workspace receiving. Retained intake and receiving work offline. Public capture uses the
published USGS service. Output files are created without replacing existing
customer records. Use the browser of an already open workspace; CLI writers
reopen it after that server closes. Preserve --operation-id when retrying a write.
`;
const OPTIONS={workspace:{type:'string'},port:{type:'string'},'managed-source':{type:'string'},project:{type:'string'},settings:{type:'string'},
  roster:{type:'string'},source:{type:'string',multiple:true},query:{type:'string'},capture:{type:'string'},edition:{type:'string'},
  archive:{type:'string'},sha256:{type:'string'},collection:{type:'string'},member:{type:'string',multiple:true},
  offset:{type:'string'},limit:{type:'string'},'source-id':{type:'string',multiple:true},'roster-id':{type:'string'},note:{type:'string'},
  name:{type:'string'},operator:{type:'string'},out:{type:'string'},input:{type:'string'},'operation-id':{type:'string'},help:{type:'boolean',short:'h'}};
async function sourceFile(path,maximum){
  const handle=await open(resolve(path),'r');
  try{const before=await handle.stat();need(before.isFile()&&before.size<=maximum,'Select a regular input of at most '+maximum+' bytes.');
    const bytes=await handle.readFile(),after=await handle.stat();need(bytes.length===before.size&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'The original input changed while reading.');return bytes;
  }finally{await handle.close();}
}
async function exclusive(path,bytes){
  const file=await open(path,'wx',0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  return {path,bytes:bytes.byteLength,sha256:hash(bytes)};
}
async function exportFile(store,project,path){
  const handle=await open(path,'wx',0o600);let bytes=0;
  try{
    for await(const chunk of store.exportProject(project)){
      let offset=0;while(offset<chunk.length){const written=await handle.write(chunk,offset,chunk.length-offset);need(written.bytesWritten>0,'The workspace transfer could not finish.');offset+=written.bytesWritten;}bytes+=chunk.length;
    }
    await handle.sync();
  }finally{await handle.close();}
  return {path,bytes};
}
async function exportArchive(store,projectId,collectionId,path){
  const entry=store.entry(projectId,'collection',collectionId);
  const verified=await downloadCollectionArchive(store.directory,entry);
  let output;
  try{
    output=await open(path,'wx',0o600);let bytes=0;
    for await(const chunk of verified.file.createReadStream({autoClose:false,start:0})){
      let offset=0;
      while(offset<chunk.length){
        const written=await output.write(chunk,offset,chunk.length-offset);
        need(written.bytesWritten>0,'The original archive export could not finish.');offset+=written.bytesWritten;
      }
      bytes+=chunk.length;
    }
    need(bytes===entry.archiveBytes,'The original archive export was interrupted.');
    await output.sync();return {path,bytes,sha256:entry.archiveSha256,collectionId};
  }finally{
    try{if(output)await output.close();}finally{await verified.dispose();}
  }
}
export async function runFacilityCommand(argv=process.argv.slice(2)){
  need(Number(process.versions.node.split('.')[0])>=24,'The facility operations workspace requires Node.js 24 or later.');
  const {values,positionals}=parseArgs({args:argv,options:OPTIONS,allowPositionals:true,strict:true});
  if(values.help){process.stdout.write(HELP);return;}
  need(positionals.length<=1,'Choose one customer command.');
  const command=positionals[0]??'serve';
  need(values.workspace,'Supply --workspace PRIVATE_DIRECTORY.');
  const workspace=resolve(values.workspace);
  if(command==='inspect'){const result=await inspectFacilityWorkspace(workspace);process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;}
  if(command==='serve'){
    const running=await startManagedFacility({workspace,port:Number(values.port??0),...(values['managed-source']?{sourceDirectory:resolve(values['managed-source'])}:{})});
    process.stdout.write(JSON.stringify(running.announcement)+'\n');
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;try{await running.close();}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    await once(running.server,'close');process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    return {workspaceId:running.announcement.workspaceId,stopped:true};
  }
  need(['project','show','ingest','edition','collection-import','collection-show','collection-sources','collection-export','capture','report','export','import'].includes(command),'Unknown facility command: '+command);
  const store=await openFacilityStore(workspace),operationId=values['operation-id']??uuid();let captures;
  try{
    let result;
    if(command==='project'){
      need(values.settings,'Supply --settings PROJECT.json.');const settings=parseBytes(await sourceFile(values.settings,1024*1024));
      result=store.createProject(settings,operationId);
    }else if(command==='import'){
      need(values.input,'Supply --input COMPLETE.ndjson.');
      result=await store.importProject(createReadStream(resolve(values.input)),operationId);
    }else{
      need(values.project,'Supply the original --project ID.');const projectId=values.project;store.project(projectId);
      if(command==='show')result=store.state(projectId);
      if(command==='collection-import'){
        need(values.archive&&values.operator,'Supply the complete original --archive and receiving --operator.');
        result=await store.importBuyerCollection(projectId,{archive:resolve(values.archive),
          expectedSha256:values.sha256??'',operator:values.operator,note:values.note??''},
          store.project(projectId).revision,operationId);
      }
      if(command==='collection-show'){
        need(values.collection,'Supply the retained --collection ID.');
        result=store.collectionMembers(projectId,values.collection,{query:values.query??'',
          offset:Number(values.offset??0),limit:Number(values.limit??50)});
      }
      if(command==='collection-sources'){
        need(values.collection&&values.member?.length&&values.operator,'Supply --collection, 1–16 original --member IDs and the receiving --operator.');
        result=await store.importCollectionSources(projectId,values.collection,{memberIds:values.member,
          operator:values.operator,note:values.note??''},store.project(projectId).revision,operationId);
      }
      if(command==='collection-export'){
        need(values.collection&&values.out,'Supply the retained --collection ID and a new --out FILE.tar.');
        result=await exportArchive(store,projectId,values.collection,resolve(values.out));
      }
      if(command==='edition'){
        need(Boolean(values.roster)!==Boolean(values['roster-id']),'Supply either --roster FACILITIES.json or one original --roster-id.');
        need(values['source-id']?.length&&values['source-id'].length<=16&&values.name&&values.operator,
          'Supply 1–16 retained --source-id values, --name and --operator.');
        let rosterId=values['roster-id'];
        if(values.roster){
          const input=parseBytes(await sourceFile(values.roster,8*1024*1024));
          rosterId=store.saveRoster(projectId,input,store.project(projectId).revision,operationId+':roster').id;
        }
        result=store.createEdition(projectId,{rosterId,sourceIds:values['source-id'],label:values.name,
          operator:values.operator,note:values.note??''},store.project(projectId).revision,operationId+':edition');
      }
      if(command==='ingest'){
        need(values.roster&&values.source?.length&&values.name&&values.operator,'Supply --roster, --source, --name and --operator.');
        need(values.source.length<=16,'The original report accepts at most 16 retained sources.');
        const roster=parseBytes(await sourceFile(values.roster,8*1024*1024));
        const sites=store.saveRoster(projectId,roster,store.project(projectId).revision,operationId+':roster'),sourceIds=[];
        for(let index=0;index<values.source.length;index++){
          const path=values.source[index],bytes=await sourceFile(path,SOURCE_LIMIT);
          const saved=store.importSource(projectId,bytes,{name:basename(path)},store.project(projectId).revision,operationId+':source-'+index);sourceIds.push(saved.id);
        }
        result=store.createEdition(projectId,{rosterId:sites.id,sourceIds,label:values.name,operator:values.operator},store.project(projectId).revision,operationId+':edition');
      }
      if(command==='capture'){
        captures=new SourceCaptures(store);let id=values.capture;
        if(!id){need(values.query,'Supply --query QUERY.json or the original --capture ID.');
          const plan=parseBytes(await sourceFile(values.query,1024*1024));id=store.createCapture(projectId,plan,store.project(projectId).revision,operationId).id;}
        const job=await captures.start(projectId,id);result={projectId,captureId:id,state:job.state,sourceIds:job.sourceIds,pending:job.pending,error:job.error,retryAt:job.retryAt};
        if(job.state!=='complete')process.exitCode=2;
      }
      if(command==='export'){
        need(values.out,'Supply a new --out FILE.ndjson.');result=await exportFile(store,projectId,resolve(values.out));
      }
      if(command==='report'){
        need(values.out&&values.edition,'Supply --edition ID and a new --out DIRECTORY.');
        const value=store.entry(projectId,'edition',values.edition),sites=store.entry(projectId,'roster',value.rosterId),
          sources=value.sourceIds.map(id=>store.entry(projectId,'source',id)),project=store.project(projectId),directory=resolve(values.out);
        await mkdir(directory,{recursive:false,mode:0o700});
        const files=[];
        files.push(await exclusive(join(directory,'report.json'),Buffer.from(JSON.stringify(value.report,null,2)+'\n')));
        files.push(await exclusive(join(directory,'report.csv'),Buffer.from(renderFacilityCsv(value.report))));
        files.push(await exclusive(join(directory,'operating-work.csv'),Buffer.from(reviewCsv(store.allEditionWork(projectId,null)))));
        files.push(await exclusive(join(directory,'handover.html'),Buffer.from(handoverHtml(project,value,store.allEditionWork(projectId,value.id),sites,sources,{retainedWork:store.allEditionWork(projectId,null),reviewHistory:store.entries(projectId,'review'),acquisitions:store.sourceAcquisitions(projectId,sources)}))));
        files.push(await exportFile(store,projectId,join(directory,'workspace.ndjson')));
        result={projectId,editionId:value.id,reportSha256:value.reportSha256,files};
      }
    }
    result={operationId,...result};process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{if(captures)await captures.close();store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  runFacilityCommand().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
