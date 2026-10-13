// MIT. Original report editorial requests and complete portable recipient files.
import {constants} from 'node:fs';
import {open,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AnalysisReportReviewClient,need,plain,identity,encode,digest,REPORT_REVIEW_SHA,REPORT_REVIEW_MAX_RETURN} from './analysis-report-review-client.mjs';
import {REPORT_REVIEW_ALIAS} from './report-editorial-connection.mjs';
import {EDITORIAL_MANIFEST,EDITORIAL_DELIVERY,EDITORIAL_FILE_BYTES,parseEditorialDelivery,descriptor} from './report-editorial-contracts.mjs';
import {validateReportEditorialArguments} from './catalog/report-editorial.mjs';
import {readWorkflowSeriesPrivateFile,workflowSeriesPrivateDirectory} from './workflow-series-connection.mjs';
import {writeConsoleWorkflowFile,writeConsoleWorkflowStream,inspectConsoleWorkflowFile} from './console/client-files.mjs';
import {RetainedFileReads} from './retained-file-reads.mjs';

const CHUNK=65536;
const json=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
const mime=name=>name.endsWith('.html')?'text/html;charset=utf-8':'application/json';
function issueIdentity(detail,workspaceId,id,sha){
  need(plain(detail)&&detail.issue?.id===id&&detail.issue.workspace_id===workspaceId&&
    REPORT_REVIEW_SHA.test(detail.issue_sha256)&&REPORT_REVIEW_SHA.test(detail.issue.source_sha256)&&
    (!sha||detail.issue_sha256===sha),'The selected native report issue changed.','REPORT_REVIEW_SOURCE_CHANGED');
  return detail;
}
export class MerchantReportEditorialAgent{
  #config;#reads=new RetainedFileReads({errorPrefix:'REPORT_REVIEW'});
  #controller=new AbortController();#pending=new Set();#clients=new Set();#queues=new Map();#closing=false;#closed=false;#close;
  constructor(config){this.#config=config;}
  get summary(){return{configured:Boolean(this.#config.reportEditorial),...this.#reads.summary,
    workspaces:Object.entries(this.#config.reportEditorial?.workspaces??{}).map(([workspace,v])=>({workspace,label:v.label,workspaceId:v.workspaceId}))};}
  #definition(alias){
    need(typeof alias==='string'&&REPORT_REVIEW_ALIAS.test(alias),'Select the original declared Analysis alias.');
    const value=this.#config.reportEditorial?.workspaces[alias];
    need(value,'Select an original workspace from merchant_report_editorial_connections.');return value;
  }
  async #using(alias,fn){
    const definition=this.#definition(alias);
    need(!this.#closing,'The report provider is closing.','REPORT_REVIEW_CLOSING');
    const launch=json(await readWorkflowSeriesPrivateFile(definition.launchFile,65536));
    const client=new AnalysisReportReviewClient({launch,workspaceId:definition.workspaceId,signal:this.#controller.signal});
    this.#clients.add(client);
    try{return await fn(client,await client.state());}
    finally{client.close();this.#clients.delete(client);}
  }
  async #root(create=false){
    await workflowSeriesPrivateDirectory(this.#config.exportsDirectory);
    return workflowSeriesPrivateDirectory(join(this.#config.exportsDirectory,'report-editorial'),create);
  }
  async #area(kind,id,create=false){
    need(['uploads','operations','exports','staging'].includes(kind)&&/^[a-f0-9-]{32,64}$/.test(id),'Select the retained private editorial record.');
    const root=await this.#root(create),area=await workflowSeriesPrivateDirectory(join(root,kind),create);
    return workflowSeriesPrivateDirectory(join(area,id),create);
  }
  #boundKey(workspace,id){return digest(encode({workspaceId:this.#definition(workspace).workspaceId,id}));}
  #scope(workspace,exportId){this.#definition(workspace);need(REPORT_REVIEW_SHA.test(exportId),'Retain the complete export hash.');return workspace+'\0'+exportId;}
  async #operation(workspace,action,id){
    return this.#area('operations',this.#boundKey(workspace,action+':'+identity(id)),true);
  }
  async #manifest(workspace,exportId){
    const definition=this.#definition(workspace),directory=await this.#area('exports',exportId);
    const bytes=await readWorkflowSeriesPrivateFile(join(directory,EDITORIAL_MANIFEST),65000),manifest=parseEditorialDelivery(bytes,exportId);
    need(manifest.workspace===workspace&&manifest.workspaceId===definition.workspaceId,'The retained delivery belongs to another original workspace.','REPORT_REVIEW_DELIVERY_CHANGED');
    return{directory,manifest,bytes,manifestFile:{name:EDITORIAL_MANIFEST,bytes:bytes.length,sha256:digest(bytes),contentType:'application/json'}};
  }
  async #capture(client,workspace,issueId,{issueSha256,returned=null,application=null,preview=null,detail=null}={}){
    detail=issueIdentity(detail??await client.detail(issueId),client.workspaceId,issueId,issueSha256);
    if(returned)need(returned.issue_id===issueId&&returned.return?.workspace_id===client.workspaceId&&
      returned.return.issue_sha256===detail.issue_sha256&&returned.return.source_sha256===detail.issue.source_sha256,
      'The returned review belongs to another original report.','REPORT_REVIEW_SOURCE_CHANGED');
    if(application)need(returned&&application.return_id===returned.id,'Keep the original return and application together.','REPORT_REVIEW_SOURCE_CHANGED');
    if(preview)need(returned&&preview.return_id===returned.id&&preview.issue_id===issueId,'Keep the original comparison source.','REPORT_REVIEW_SOURCE_CHANGED');
    // Capture current recipient rendering as an immutable edition. A later source
    // correction can create a different edition without overwriting prior files.
    const stage=await this.#area('staging',randomUUID(),true),files=[];
    for(const name of ['package.json','review.html']){
      const saved=await client.download(issueId,name,join(stage,name));
      files.push(descriptor({name,bytes:saved.bytes,sha256:saved.sha256,contentType:mime(name)}));
    }
    for(const[name,value]of [['issue.json',detail],['returned-review.json',returned],['application.json',application],['comparison.json',preview]]){
      if(value===null)continue;
      const bytes=encode(value);need(bytes.length<=EDITORIAL_FILE_BYTES,'The complete retained native record exceeds its declared file capacity.');
      await writeConsoleWorkflowFile(join(stage,name),bytes);
      files.push(descriptor({name,bytes:bytes.length,sha256:digest(bytes),contentType:mime(name)}));
    }
    const body={schema:EDITORIAL_DELIVERY,workspace,workspaceId:client.workspaceId,issueId,
      issueSha256:detail.issue_sha256,sourceSha256:detail.issue.source_sha256,
      returnId:returned?.id??null,applyId:application?.id??null,files};
    const exportId=digest(encode(body)),manifest={...body,exportId},raw=encode(manifest);
    parseEditorialDelivery(raw,exportId);
    const directory=await this.#area('exports',exportId,true);
    for(const file of files){
      need(!this.#closing,'Resume the same retained native issue after provider shutdown.','REPORT_REVIEW_CLOSING');
      const source=join(stage,file.name),destination=join(directory,file.name);
      try{
        const existing=await inspectConsoleWorkflowFile(destination,file);
        need(existing.bytes===file.bytes&&existing.sha256===file.sha256,'The retained editorial member changed.','REPORT_REVIEW_FILE_CHANGED');
      }catch(error){
        if(error.code!=='ENOENT')throw error;
        const input=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        try{
          await writeConsoleWorkflowStream(destination,async output=>{
            const stat=await input.stat();
            need(stat.isFile()&&stat.size===file.bytes&&!(stat.mode&0o077),'Read the exact private captured source.');
            const {createHash}=await import('node:crypto'),hash=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0;
            while(bytes<file.bytes){
              this.#controller.signal.throwIfAborted();
              const part=await input.read(buffer,0,Math.min(buffer.length,file.bytes-bytes),bytes);
              need(part.bytesRead>0,'The captured source ended early.','REPORT_REVIEW_FILE_CHANGED');
              const raw=buffer.subarray(0,part.bytesRead);hash.update(raw);await output.writeFile(raw);bytes+=part.bytesRead;
            }
            const sha256=hash.digest('hex');
            need(bytes===file.bytes&&sha256===file.sha256,'The complete captured source changed.','REPORT_REVIEW_FILE_CHANGED');
            return{bytes,sha256};
          });
        }finally{await input.close();}
      }
      // Retire only this fully copied immutable snapshot. The original atomic
      // writer owns interrupted destination publication and exact replay.
      await unlink(source);
      const saved=await inspectConsoleWorkflowFile(destination,file);
      need(saved.bytes===file.bytes&&saved.sha256===file.sha256,'The complete original editorial member changed.','REPORT_REVIEW_FILE_CHANGED');
    }
    await writeConsoleWorkflowFile(join(directory,EDITORIAL_MANIFEST),raw);
    await rmdir(stage).catch(()=>{});
    return{state:'EXPORTED',workspace,workspaceId:client.workspaceId,issueId,issueSha256:detail.issue_sha256,
      returnId:body.returnId,applyId:body.applyId,exportId,manifest,
      manifestFile:{name:EDITORIAL_MANIFEST,bytes:raw.length,sha256:digest(raw),contentType:'application/json'},files};
  }
  async #upload(workspace,uploadId){
    const directory=await this.#area('uploads',this.#boundKey(workspace,identity(uploadId)));
    const raw=await readWorkflowSeriesPrivateFile(join(directory,'intent.json'),4096),intent=json(raw);
    need(intent.schema==='stellar-forge.report-editorial-upload.v1'&&intent.workspace===workspace&&
      intent.workspaceId===this.#definition(workspace).workspaceId&&intent.uploadId===uploadId&&
      Number.isSafeInteger(intent.bytes)&&intent.bytes>=1&&intent.bytes<=REPORT_REVIEW_MAX_RETURN&&
      REPORT_REVIEW_SHA.test(intent.sha256)&&REPORT_REVIEW_SHA.test(intent.issueSha256),'The original returned-file intent changed.','REPORT_REVIEW_UPLOAD_CHANGED');
    identity(intent.issueId);return{directory,intent,intentSha256:digest(raw)};
  }
  async #uploadStatus(workspace,uploadId){
    const saved=await this.#upload(workspace,uploadId);let availableBytes=0;
    while(availableBytes<saved.intent.bytes){
      const name='chunk-'+String(availableBytes).padStart(10,'0'),length=Math.min(CHUNK,saved.intent.bytes-availableBytes);
      let raw,meta;
      try{raw=await readWorkflowSeriesPrivateFile(join(saved.directory,name),CHUNK);meta=json(await readWorkflowSeriesPrivateFile(join(saved.directory,name+'.json'),1024));}
      catch(error){if(error.code==='ENOENT')break;throw error;}
      need(raw.length===length&&meta.offset===availableBytes&&meta.bytes===length&&meta.sha256===digest(raw),
        'The original returned-file fragment changed.','REPORT_REVIEW_UPLOAD_CHANGED');
      availableBytes+=raw.length;
    }
    let outcome=null;
    try{outcome=json(await readWorkflowSeriesPrivateFile(join(saved.directory,'received.json'),4096));}
    catch(error){if(error.code!=='ENOENT')throw error;}
    return{state:outcome?'RECEIVED':availableBytes===saved.intent.bytes?'READY':'UPLOADING',
      ...saved.intent,intentSha256:saved.intentSha256,availableBytes,outcome};
  }
  async #uploadAction(action,args){
    const{workspace,uploadId}=args;
    if(action==='return_begin'){
      return this.#using(workspace,async client=>{
        const detail=issueIdentity(await client.detail(args.issueId),client.workspaceId,args.issueId,args.issueSha256);
        const directory=await this.#area('uploads',this.#boundKey(workspace,uploadId),true);
        const intent={schema:'stellar-forge.report-editorial-upload.v1',workspace,workspaceId:client.workspaceId,
          uploadId,issueId:args.issueId,issueSha256:args.issueSha256,sourceSha256:detail.issue.source_sha256,
          bytes:args.bytes,sha256:args.sha256,chunkBytes:CHUNK};
        await writeConsoleWorkflowFile(join(directory,'intent.json'),encode(intent));
        return this.#uploadStatus(workspace,uploadId);
      });
    }
    if(action==='return_status')return this.#uploadStatus(workspace,uploadId);
    const saved=await this.#upload(workspace,uploadId);
    if(action==='return_chunk'){
      const raw=Buffer.from(args.base64,'base64'),offset=args.offset;
      need(raw.toString('base64')===args.base64&&offset%CHUNK===0&&offset<saved.intent.bytes&&
        raw.length===Math.min(CHUNK,saved.intent.bytes-offset)&&digest(raw)===args.sha256,
        'Send the exact next original fragment, offset and SHA256.','REPORT_REVIEW_UPLOAD_CHANGED');
      const status=await this.#uploadStatus(workspace,uploadId);
      need(offset<=status.availableBytes,'Keep the original contiguous fragment order.');
      const name='chunk-'+String(offset).padStart(10,'0');
      await writeConsoleWorkflowFile(join(saved.directory,name),raw);
      await writeConsoleWorkflowFile(join(saved.directory,name+'.json'),encode({offset,bytes:raw.length,sha256:args.sha256}));
      return this.#uploadStatus(workspace,uploadId);
    }
    need(action==='return_receive','Select an original return intake action.');
    const status=await this.#uploadStatus(workspace,uploadId);
    need(status.availableBytes===saved.intent.bytes,'Receive every original returned-file fragment first.');
    const chunks=[];
    for(let offset=0;offset<saved.intent.bytes;offset+=CHUNK)chunks.push(await readWorkflowSeriesPrivateFile(join(saved.directory,'chunk-'+String(offset).padStart(10,'0')),CHUNK));
    const raw=Buffer.concat(chunks);need(raw.length===saved.intent.bytes&&digest(raw)===saved.intent.sha256,'The complete original return changed.','REPORT_REVIEW_UPLOAD_CHANGED');
    const request=json(raw);identity(request?.id);
    need(request.workspace_id===saved.intent.workspaceId&&request.issue_id===saved.intent.issueId&&
      request.issue_sha256===saved.intent.issueSha256&&request.source_sha256===saved.intent.sourceSha256,
      'The complete return is bound to another original issue.','REPORT_REVIEW_SOURCE_CHANGED');
    await writeConsoleWorkflowFile(join(saved.directory,'returned-file.json'),raw);
    return this.#using(workspace,async client=>{
      const result=await client.mutate('receive',request,await this.#operation(workspace,'receive',request.id));
      const outcome={returnId:request.id,issueId:request.issue_id,returnSha256:result.value.return_sha256,intentSha256:result.intentSha256};
      await writeConsoleWorkflowFile(join(saved.directory,'received.json'),encode(outcome));
      return{state:'RECEIVED',workspace,uploadId,...outcome,
        delivery:await this.#capture(client,workspace,request.issue_id,{issueSha256:request.issue_sha256,returned:result.value})};
    });
  }
  async #file(args){
    const received=await this.#manifest(args.workspace,args.exportId);
    need(received.manifestFile.sha256===args.expectedManifestSha256,'Select the exact original manifest SHA256.','REPORT_REVIEW_DELIVERY_CHANGED');
    const file=args.file===EDITORIAL_MANIFEST?received.manifestFile:received.manifest.files.find(x=>x.name===args.file);
    need(file&&file.sha256===args.expectedSha256,'Select the exact complete editorial file.','REPORT_REVIEW_FILE_CHANGED');
    const result=await this.#reads.read({scope:this.#scope(args.workspace,args.exportId),key:file.name,kind:'report-editorial',
      directory:received.directory,expectedSha256:file.sha256,readId:args.readId,offset:args.offset??0,limit:args.limit??65536,
      load:async()=>{
        const path=join(received.directory,file.name),saved=await inspectConsoleWorkflowFile(path,file);
        need(saved.bytes===file.bytes&&saved.sha256===file.sha256,'The complete editorial file changed.','REPORT_REVIEW_FILE_CHANGED');
        const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        try{const stat=await handle.stat();need(stat.isFile()&&stat.size===file.bytes&&!(stat.mode&0o077)&&
          (typeof process.getuid!=='function'||stat.uid===process.getuid()),'Read the original private complete file.','REPORT_REVIEW_FILE_CHANGED');
          return{readonlyFileHandle:handle,bytes:file.bytes,sha256:file.sha256,name:file.name,type:file.contentType};
        }catch(error){await handle.close();throw error;}
      }});
    return{workspace:args.workspace,exportId:args.exportId,manifestSha256:received.manifestFile.sha256,...result};
  }
  async #execute(action,args){
    if(action==='connections')return this.summary;
    const{workspace,...input}=args;this.#definition(workspace);
    if(action.startsWith('return_'))return this.#uploadAction(action,args);
    if(action==='file')return this.#file(args);
    if(action==='file_release'){await this.#reads.release(this.#scope(workspace,input.exportId),input.readId);return{state:'RELEASED',workspace,...input};}
    if(action==='manifest'){const v=await this.#manifest(workspace,input.exportId);return{state:'MANIFEST_RETAINED',workspace,exportId:input.exportId,manifestFile:v.manifestFile,manifest:v.manifest};}
    return this.#using(workspace,async(client,state)=>{
      if(action==='state')return{workspace,workspaceId:client.workspaceId,jobs:state.jobs?.filter(x=>x.kind==='report'||x.kind==='report-export')??[],
        reportCount:Array.isArray(state.reports)?state.reports.length:null};
      if(action==='history')return{workspace,...await client.history(input)};
      if(action==='detail'){
        const{issueId,...page}=input,detail=await client.detail(issueId,page);
        return{workspace,issueId,issueSha256:detail.issue_sha256,returns:detail.returns,applies:detail.applies,
          next_returns_before:detail.next_returns_before,next_applies_before:detail.next_applies_before,
          delivery:await this.#capture(client,workspace,issueId,{detail})};
      }
      if(action==='issue'){
        const result=await client.mutate('issue',input.request,await this.#operation(workspace,'issue',input.request.id));
        return{workspace,requestId:input.request.id,state:'ISSUED',intentSha256:result.intentSha256,
          delivery:await this.#capture(client,workspace,input.request.id,{detail:result.value})};
      }
      if(action==='returned'||action==='preview'||action==='apply'||action==='status'){
        let application=null,returned,preview=null;
        if(action==='status'){application=await client.status(input.applyId);returned=await client.returned(application.return_id);}
        else returned=await client.returned(input.returnId);
        if(action==='preview')preview=await client.preview(input.returnId,input.mapping??null);
        if(action==='apply')application=(await client.mutate('apply',input.request,await this.#operation(workspace,'apply',input.request.id),{returnId:input.returnId})).value;
        return{workspace,returnId:returned.id,returnSha256:returned.return_sha256,
          ...(preview?{previewSha256:preview.preview_sha256,currentRevision:preview.current_revision,fieldCount:preview.fields.length}:{}),
          ...(application?{applyId:application.id,status:application.status,definitionRevision:application.definition?.revision??null,lastError:application.last_error??null}:{}),
          delivery:await this.#capture(client,workspace,returned.issue_id,{returned,application,preview})};
      }
      if(action==='export'){
        const application=input.applyId?await client.status(input.applyId):null;
        need(!application||!input.returnId||application.return_id===input.returnId,'Select the original application return.');
        const returnId=input.returnId??application?.return_id,returned=returnId?await client.returned(returnId):null;
        return this.#capture(client,workspace,input.issueId,{issueSha256:input.issueSha256,returned,application});
      }
      need(false,'Select an original declared report editorial method.');
    });
  }
  call(name,args={}){
    if(this.#closing)return Promise.reject(Object.assign(new Error('The report provider is closing.'),{code:'REPORT_REVIEW_CLOSING'}));
    const action=validateReportEditorialArguments(name,args),key=args.workspace??'connections';
    // Serial local custody per alias; the native report model remains the sole
    // author. File readers have their own original retained-file leases.
    const parallel=['file','file_release','manifest','connections'].includes(action);
    const prior=parallel?Promise.resolve():this.#queues.get(key)??Promise.resolve();
    const pending=prior.catch(()=>{}).then(()=>{need(!this.#closing,'The provider is closing.','REPORT_REVIEW_CLOSING');return this.#execute(action,args);});
    if(!parallel)this.#queues.set(key,pending);
    this.#pending.add(pending);
    const done=()=>{this.#pending.delete(pending);if(this.#queues.get(key)===pending)this.#queues.delete(key);};
    pending.then(done,done);return pending;
  }
  requestClose(){this.#closing=true;this.#controller.abort();for(const client of this.#clients)client.close();}
  close(){if(this.#closed)return Promise.resolve();if(this.#close)return this.#close;this.requestClose();
    this.#close=(async()=>{await Promise.allSettled([...this.#pending]);await this.#reads.close();this.#closed=true;})()
      .catch(error=>{this.#close=undefined;throw error;});return this.#close;}
}
