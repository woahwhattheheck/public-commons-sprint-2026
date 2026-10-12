#!/usr/bin/env node
// MIT. Fresh-process receiving through both original Research portable paths.
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {resolve,join,isAbsolute} from 'node:path';
import {parseArgs} from 'node:util';
import {openDossierStore} from '../dossier.mjs';
import {startDossierWorkspace} from '../server.mjs';
import {ResearchWorkspaceClient} from '../workspace-client.mjs';
import {need} from '../../node/store.mjs';
import {inspectRisEdition} from './review.mjs';
import {nativeJson,nativeSha,nativeRead,nativeSame,openRisNativeJournal} from './native-support.mjs';

const SCHEMA='sf88-research-ris-cold-reopen-v1';
async function checked(row){const bytes=await nativeRead(row.file);need(bytes.length===row.bytes&&nativeSha(bytes)===row.sha256,
  'RIS_COLD_SELECTED_FILE_CHANGED');return bytes;}
async function collect(stream){
  const parts=[];let size=0;
  for await(const part of stream){const bytes=Buffer.from(part);size+=bytes.length;need(size<=256*1024*1024,'RIS_COLD_PORTABLE_TOO_LARGE');parts.push(bytes);}
  return Buffer.concat(parts);
}
export async function runRisSourcesReopen(selection){
  need(selection?.schema===SCHEMA&&isAbsolute(selection.runDirectory)&&
    selection.currentRevision===selection.receipt.revision,'RIS_COLD_SELECTION_REQUIRED');
  const journal=await openRisNativeJournal(join(selection.runDirectory,'cold'),selection);
  if(journal.state.stage==='COMPLETE')return journal.finish(journal.state.result);
  const {dossierId,questionId,baselineReceipt,receipt,currentRevision}=selection;
  const json=await checked(selection.portableJson),gzip=await checked(selection.portableGzip);
  const original=JSON.parse(json),metadata=JSON.parse(await checked(selection.metadata));
  need(original.id===dossierId&&original.versions.at(-1)?.state.revision===currentRevision&&
    metadata.id===dossierId&&metadata.revision===currentRevision,'RIS_COLD_ORIGINAL_HEAD_CHANGED');
  let server,client;
  try{
    const jsonDirectory=join(selection.runDirectory,'private','received-json');
    const gzipDirectory=join(selection.runDirectory,'private','received-gzip');
    const jsonStore=await openDossierStore(jsonDirectory);
    const reopened=await jsonStore.reopen(original);
    need(reopened.id===dossierId&&[currentRevision,currentRevision+1].includes(reopened.revision),'RIS_COLD_JSON_REOPEN_CHANGED');
    let gzipResult;
    const savedGzip=await journal.recover('gzip-receiving.json');
    if(savedGzip)gzipResult=JSON.parse(savedGzip);
    else{
      server=await startDossierWorkspace({directory:gzipDirectory,port:0,extractionPython:selection.python});
      client=new ResearchWorkspaceClient({url:server.url,directory:gzipDirectory,expectedWorkspaceId:server.workspaceId});
      await client.status();gzipResult=await client.reopenFile(selection.portableGzip.file,{expectedSha256:selection.portableGzip.sha256});
      need(gzipResult.source?.sha256===selection.portableGzip.sha256&&gzipResult.source.bytes===gzip.length&&
        gzipResult.dossier.id===dossierId&&gzipResult.dossier.revision===currentRevision,'RIS_COLD_GZIP_REOPEN_CHANGED');
      await journal.retain('gzip-receiving.json',nativeJson(gzipResult));
      await client.close();client=null;await server.close();server=null;
    }
    const gzipStore=await openDossierStore(gzipDirectory);
    const observations=[];
    for(const [kind,store]of [['json',jsonStore],['gzip',gzipStore]]){
      const head=await store.getMetadata(dossierId,{revision:currentRevision});
      need(nativeSame(head,metadata),'RIS_COLD_METADATA_CHANGED');
      const exported=JSON.parse((await store.exportDossier(dossierId,{format:'json',revision:currentRevision})).body);
      need(nativeSame(exported.versions,original.versions)&&nativeSame(exported.blobs,original.blobs),'RIS_COLD_COMPLETE_HISTORY_CHANGED');
      const bindings=[];
      for(const originalReceipt of [baselineReceipt,receipt]){
        const saved=await store.risSources(dossierId,{requestId:originalReceipt.requestId,revision:currentRevision});
        need(nativeSame(saved.receipt,originalReceipt),'RIS_COLD_RECEIPT_CHANGED');
        const edition=await store.exportRis(dossierId,{editionId:originalReceipt.editionId,format:'edition',revision:currentRevision});
        need(edition.bytes.length===originalReceipt.edition.bytes&&nativeSha(edition.bytes)===originalReceipt.edition.sha256,
          'RIS_COLD_EDITION_BYTES_CHANGED');
        const inspected=inspectRisEdition(edition.bytes),documents=[];
        for(const document of inspected.prepared.source.documents){
          const raw=await store.exportRis(dossierId,{editionId:originalReceipt.editionId,format:'document',
            documentId:document.id,revision:currentRevision});
          need(raw.bytes.length===document.bytes&&nativeSha(raw.bytes)===document.sha256,'RIS_COLD_ORIGINAL_DOCUMENT_CHANGED');
          documents.push({id:document.id,filename:document.filename,bytes:document.bytes,sha256:document.sha256});
        }
        bindings.push({receipt:originalReceipt,documents,records:inspected.reviewed.counts.records});
      }
      for(const report of selection.reports){
        const output=await store.exportDossier(dossierId,{format:report.format,revision:report.revision});
        const bytes=Buffer.from(output.body);
        need(bytes.length===report.bytes&&nativeSha(bytes)===report.sha256,'RIS_COLD_REPORT_CHANGED');
      }
      const comparison=await store.exportRisComparison(dossierId,{before:baselineReceipt.editionId,after:receipt.editionId,
        revision:currentRevision,format:'json'});
      await journal.retain(kind+'-complete-comparison.json',comparison.bytes);
      const observed={kind,dossierId,revision:currentRevision,versionCount:exported.versions.length,
        originalBlobCount:exported.blobs.length,bindings,completeHistoryEqual:true,reportsEqual:true};
      await journal.retain(kind+'-original-receiving.json',nativeJson(observed));observations.push(observed);
    }
    // A changed original selected state with recomputed outer hashes still has to
    // replay the saved atomic RIS transition. Both original import paths reject it.
    const tampered=structuredClone(original),changed= tampered.versions.at(-1);
    const choice=changed.state.selections.find(row=>row.editionId===receipt.editionId);
    need(choice,'RIS_COLD_SELECTION_MISSING');choice.selected=!choice.selected;
    changed.sha256=nativeSha(nativeJson(changed.state));const bad=nativeJson(tampered);
    await journal.retain('changed-selection-rehashed.json',bad);
    const rejections=[];
    for(const kind of ['json','stream']){
      const target=await openDossierStore(join(selection.runDirectory,'private','rejected-'+kind));
      need((await target.list()).length===0,'RIS_COLD_REJECTION_STORE_CHANGED');
      let code=null;
      try{if(kind==='json')await target.reopen(tampered);else await target.reopenStream(Readable.from([bad]),{projection:'metadata'});}
      catch(error){code=error.code??'UNKNOWN';}
      need(code==='RIS_PORTABLE_ATOMIC_REPLAY_CHANGED'&&(await target.list()).length===0,'RIS_COLD_CHANGED_HISTORY_ACCEPTED');
      rejections.push({kind,code,savedDossiers:0,sha256:nativeSha(bad)});
    }
    await journal.retain('changed-selection-rejections.json',nativeJson(rejections));
    const {state}=journal;
    if(!state.values.continuedRequest){
      const base=await jsonStore.getMetadata(dossierId,{revision:currentRevision});
      const question=base.questions.find(row=>row.id===questionId);need(question,'RIS_COLD_QUESTION_MISSING');
      state.values.continuedRequest={questionId,expectedRevision:currentRevision,
        notes:question.notes+'\n\nEditable receiving '+selection.operationId+
          ': original RIS files, full review choices and source citations were reopened from the complete portable.'};
      await journal.save();
    }
    const request=state.values.continuedRequest;
    let continued=await jsonStore.getMetadata(dossierId);
    if(continued.revision===currentRevision)
      continued=await jsonStore.updateQuestion(dossierId,questionId,{notes:request.notes,expectedRevision:currentRevision,projection:'metadata'});
    need(continued.revision===currentRevision+1&&continued.questions.find(row=>row.id===questionId)?.notes===request.notes,
      'RIS_COLD_CONTINUATION_CHANGED');
    await journal.retain('continued-metadata.json',nativeJson(continued));
    for(const format of ['json','md','html']){
      const name='Research_Dossier_Continued.'+format;
      if(!await journal.recover(name)){
        const output=await jsonStore.exportDossier(dossierId,{format,revision:continued.revision});
        await journal.retain(name,Buffer.from(output.body));
      }
    }
    if(!await journal.recover('Research_Dossier_Continued.json.gz')){
      const output=await jsonStore.exportStream(dossierId,{compression:'gzip',revision:continued.revision});
      await journal.retain('Research_Dossier_Continued.json.gz',await collect(output.body));
    }
    const result={schema:SCHEMA,operationId:selection.operationId,dossierId,questionId,currentRevision,
      json:observations[0],gzip:observations[1],continued:{revision:continued.revision,questionId,
        portable:'cold/Research_Dossier_Continued.json.gz'},tamper:{rehashed:true,rejections}};
    return await journal.finish(result);
  }catch(error){await journal.failed(error);throw error;}
  finally{try{if(client)await client.close();}finally{if(server)await server.close();}}
}
export async function main(argv=process.argv.slice(2)){
  const {values}=parseArgs({args:argv,options:{selection:{type:'string'},'parent-lifetime':{type:'boolean',default:false}},strict:true});
  need(values.selection,'RIS_COLD_SELECTION_FILE_REQUIRED');
  const parentEnded=()=>process.exit(75);
  if(values['parent-lifetime']){process.stdin.once('end',parentEnded);process.stdin.resume();}
  const selected=JSON.parse(await nativeRead(resolve(values.selection)));
  const result=await runRisSourcesReopen(selected);
  process.stdout.write(JSON.stringify(result)+'\n');
  if(values['parent-lifetime']){process.stdin.removeListener('end',parentEnded);process.stdin.destroy();}
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'RIS_COLD_FAILED'})+'\n');process.exitCode=1;});
