// SPDX-License-Identifier: MIT
import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {inspectHandoff} from '../../sf88-operator-buyer-cli/operations-handoff/contract.mjs';
import {listReports,describeReport,publishReport,inspectPublication,prepareBuyer,prepareCatalogBuyer} from './publication.mjs';
import {inspectBuyerSelection,previewOperations,receiveReport,inspectReceiving,continueReceiving,captureBuyer,OperationsConnection} from './receiving.mjs';
import {SCHEMA,sha,json,canonical,need,ident,digest,absolute,read,readJSON,put,exists,identity,inventory,checkFile,ownedOperation,
  phase,finish,operation,openDesk,core,MAX_FILE,MAX_JSON,defaultApplication} from './common.mjs';

export class GroundwaterReportDesk{
  constructor({directory,sourceWorkspace=null,application=defaultApplication,python='python3',operationsAccess=null,signal}={}){
    this.directory=absolute(directory,'report desk directory');
    this.sourceWorkspace=sourceWorkspace?absolute(sourceWorkspace,'original scientific workspace'):null;
    this.runtime={application,python,signal};
    this.connection=operationsAccess?new OperationsConnection(operationsAccess,{signal}):null;
    this.opened=null;
  }
  async open({create=false}={}){return this.opened??=(await openDesk(this.directory,{create}));}
  async state(){
    const desk=await this.open(),rows=[];
    for(const name of await readdir(join(desk.directory,'operations'))){
      if(!/^[a-f0-9]{64}$/.test(name))continue;
      const root=join(desk.directory,'operations',name);
      if(!await exists(join(root,'request.json')))continue;
      const request=(await readJSON(join(root,'request.json'))).value;
      need(request.deskId===desk.meta.id&&sha(request.body.operationId)===name&&sha(canonical(request.body))===request.bodySha256,
        'OPERATION_IDENTITY','A retained report operation differs.');
      const result=await exists(join(root,'result.json'))?(await readJSON(join(root,'result.json'))).value:null;
      rows.push({id:request.body.operationId,action:request.body.action,actor:request.body.actor,createdAt:request.createdAt,
        state:result?'RECORDED_COMPLETE':'PENDING',result:result?.result??null});
    }
    return {schema:SCHEMA,desk:desk.meta,sourceConfigured:Boolean(this.sourceWorkspace),operationsConfigured:Boolean(this.connection),
      operationsOrigin:this.connection?.origin??null,operations:rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))};
  }
  async reports(){need(this.sourceWorkspace,'SOURCE_CONFIGURATION','Open the desk with its original scientific workspace.',422);return listReports(this.sourceWorkspace,this.runtime);}
  async report(id){need(this.sourceWorkspace,'SOURCE_CONFIGURATION','Open the original scientific workspace.',422);return describeReport(this.sourceWorkspace,id,this.runtime);}
  async publish({operationId,actor,input}){
    need(this.sourceWorkspace,'SOURCE_CONFIGURATION','Open the original scientific workspace.',422);
    return publishReport({desk:await this.open(),operationId,actor,workspace:this.sourceWorkspace,input,runtime:this.runtime});
  }
  async publication(id){return inspectPublication(await this.open(),id,this.runtime);}
  async prepareBuyer(value){return prepareBuyer({...value,desk:await this.open(),runtime:this.runtime});}
  async prepareCatalog(value){return prepareCatalogBuyer({...value,desk:await this.open()});}
  async capture(value){return captureBuyer({...value,desk:await this.open(),runtime:this.runtime});}
  handoffInfo(raw){
    const report=inspectHandoff(raw);
    return {source:report.source,rows:report.rows.map(row=>({jobId:row.jobId,intentId:row.intentId,url:row.url,method:row.method,
      output:row.output,purchase:row.purchase,issues:row.issues,canReceive:row.canReceive})),interpretation:report.interpretation};
  }
  async previewReceiving({operationId,actor,input,catalog,handoff,response}){
    const desk=await this.open(),files={catalog:identity(catalog),handoff:identity(handoff),response:identity(response)};
    return ownedOperation(desk,operationId,'receiving-preview',actor,{input,files},async op=>{
      for(const [name,raw]of [['catalog.json',catalog],['handoff.json',handoff],['response.zip',response]])await put(join(op.root,name),raw);
      if(await exists(join(op.root,'preview.json'))){
        const saved=await readJSON(join(op.root,'preview.json'));
        need(saved.value.selection.catalog.sha256===files.catalog.sha256&&saved.value.selection.handoff.sha256===files.handoff.sha256&&
          saved.value.binding.archiveSha256===files.response.sha256,'PREVIEW_IDENTITY','The original receiving preview source differs.');
        await finish(op,{kind:'receiving-preview',sha256:saved.sha256,reportId:saved.value.binding.reportId});
        return {...saved.value,operationId};
      }
      const selected=inspectBuyerSelection({catalog,handoff,response,...input});
      const original=await core('inspect-unbound',{archive:join(op.root,'response.zip')},this.runtime);
      let operations=null;
      if(input.caseId){need(this.connection,'OPERATIONS_CONFIGURATION','Configure the original Operations access link.',422);operations=await previewOperations(this.connection,selected,handoff,input.caseId);}
      const preview={schema:SCHEMA+'.receiving-preview',selection:selected,binding:original.binding,
        manifest:original.package.manifest,operations,observedAt:op.request.createdAt};
      await put(join(op.root,'preview.json'),preview);await finish(op,{kind:'receiving-preview',sha256:sha(json(preview)),reportId:original.binding.reportId});
      return {...preview,operationId};
    });
  }
  async receive(value){return receiveReport({...value,desk:await this.open(),connection:this.connection,runtime:this.runtime});}
  async receiving(id){return inspectReceiving(await this.open(),id,this.runtime);}
  async original(id){return operation(await this.open(),id);}
  async resume(id){
    const desk=await this.open(),saved=await operation(desk,id),body=saved.request.body,input=body.input;
    if(body.action==='receive')return continueReceiving({desk,operationId:id,connection:this.connection,runtime:this.runtime});
    if(body.action==='publish'){
      const {workspace,...selected}=input;
      return publishReport({desk,operationId:id,actor:body.actor,workspace,input:selected,runtime:this.runtime});
    }
    if(body.action==='buyer-prepare')return this.prepareBuyer({operationId:id,actor:body.actor,...input});
    if(body.action==='catalog-buyer-prepare'){
      const {catalog,...selected}=input;
      return this.prepareCatalog({operationId:id,actor:body.actor,...selected,catalog:await checkFile(join(saved.root,'catalog.json'),catalog,1048576)});
    }
    if(body.action==='capture')return this.capture({operationId:id,actor:body.actor,...input});
    if(body.action==='export')return this.export({operationId:id,actor:body.actor,...input});
    if(body.action==='receiving-preview'){
      const catalog=await read(join(saved.root,'catalog.json'),1024*1024),handoff=await read(join(saved.root,'handoff.json'),8*1024*1024),
        response=await read(join(saved.root,'response.zip'),MAX_FILE);
      return this.previewReceiving({operationId:id,actor:body.actor,input:input.input,catalog,handoff,response});
    }
    need(false,'OPERATION_ACTION','This original action requires its named command.');
  }
  async cases(){need(this.connection,'OPERATIONS_CONFIGURATION','Configure the original Operations access link.',422);return this.connection.cases();}
  async case(id){need(this.connection,'OPERATIONS_CONFIGURATION','Configure the original Operations access link.',422);return this.connection.read(id);}
  async export({operationId,actor,destination}){
    absolute(destination,'new complete desk archive');
    const desk=await this.open();
    return ownedOperation(desk,operationId,'export',actor,{destination},async op=>{
      if(await exists(join(op.root,'result.json'))){
        const result=(await readJSON(join(op.root,'result.json'))).value;
        const checked=await core('inspect-desk',{archive:destination},this.runtime);
        need(checked.archive.sha256===result.result.archive.sha256&&checked.archive.bytes===result.result.archive.bytes,
          'EXPORT_UNAVAILABLE','The original complete export is unavailable or changed.');
        return result;
      }
      const state=await this.state();
      for(const row of state.operations.filter(x=>x.state==='RECORDED_COMPLETE')){
        if(row.action==='publish')await this.publication(row.id);
        else if(row.action==='receive')await this.receiving(row.id);
      }
      const files=(await phase(op,'captured-files',()=>inventory(desk.directory))).value;
      const archive=await core('pack',{directory:desk.directory,destination,files},this.runtime);
      need(archive.manifest.desk.id===desk.meta.id,'EXPORT_IDENTITY','The complete export contains another desk identity.');
      return finish(op,{kind:'complete-desk-export',path:destination,archive:archive.archive,manifestSha256:archive.manifestSha256,
        deskId:desk.meta.id,files:files.length,snapshot:'Original files captured before this export completion receipt.'});
    });
  }
  async restore({archive,destination,expectedSha256,expectedBytes}){
    absolute(archive,'original complete archive');absolute(destination,'new restore destination');digest(expectedSha256);
    const source=await core('inspect-desk',{archive},this.runtime);
    need(source.archive.sha256===expectedSha256&&source.archive.bytes===expectedBytes,'RESTORE_SOURCE','The archive differs from the explicitly selected original.');
    return core('restore',{archive,destination},this.runtime);
  }
  async download(id,kind,format){
    const desk=await this.open(),op=await operation(desk,id);
    if(op.request.body.action==='publish'){
      const publication=await this.publication(id);
      if(kind==='catalog')return {...publication.publication.catalog,path:join(op.root,'catalog.json'),name:'groundwater-catalog.json',mime:'application/json'};
      if(kind==='report'){
        const selected=publication.publication.formats.find(x=>x.format===format);
        need(selected,'FORMAT_SELECTION','Select an original published format.',404);
        return {path:join(op.root,'frozen',selected.name),name:selected.name,mime:selected.mime,bytes:selected.bytes,sha256:selected.sha256};
      }
    }
    if(['buyer-prepare','catalog-buyer-prepare'].includes(op.request.body.action)&&kind==='buyer-config'){
      const result=op.result?.result;need(result,'PREPARATION_INCOMPLETE','The original buyer configuration is incomplete.');
      return {...result.config,path:join(op.root,'buyer-review.json'),name:'groundwater-buyer-review.json',mime:'application/json'};
    }
    if(op.request.body.action==='capture'&&kind==='handoff'){
      const result=op.result?.result;need(result,'CAPTURE_INCOMPLETE','The original buyer capture is incomplete.');
      return {...result.file,path:join(op.root,'handoff.json'),name:'groundwater-buyer-handoff.json',mime:'application/json'};
    }
    if(op.request.body.action==='receive'){
      const result=await this.receiving(id);
      if(kind==='review'){const raw=await read(join(op.root,'receiving-review.json'));return {path:join(op.root,'receiving-review.json'),name:'groundwater-receiving-review.json',mime:'application/json',...identity(raw)};}
      if(kind==='report')return {path:join(op.root,'response.zip'),name:'groundwater-received-report.zip',mime:'application/zip',
        bytes:result.review.binding.archiveBytes,sha256:result.review.binding.archiveSha256};
      if(kind==='received-html'){
        const row=result.review.files.find(x=>x.path==='report.html');
        need(row,'REPORT_MEMBER','The original HTML companion is unavailable.',404);
        return {...row,path:join(op.root,'received-report','report.html'),name:'report.html',mime:'text/html'};
      }
    }
    if(op.request.body.action==='export'&&kind==='complete-export'){
      const result=op.result?.result;need(result,'EXPORT_INCOMPLETE','The original complete export is incomplete.');
      return {path:result.path,name:'Groundwater_Report_Desk.zip',mime:'application/zip',...result.archive};
    }
    need(false,'DOWNLOAD_NOT_FOUND','Select a retained original download.',404);
  }
}
