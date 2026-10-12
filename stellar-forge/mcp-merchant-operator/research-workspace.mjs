// MIT. Model-driven operation of an existing authenticated Research workspace.
import {link,unlink,readdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {dirname,resolve,join} from 'node:path';
import {exact,identifier,line,plain,failure} from './host-files.mjs';
import {RetainedFileReads} from './retained-file-reads.mjs';
import {researchWorkspaceTools,RESEARCH_EXPORTS} from './catalog/research-workspace.mjs';
import {callResearchClinicalTrials,exportResearchClinicalTrials,RESEARCH_CLINICALTRIALS_PREFIX} from './research-clinicaltrials.mjs';
import {callResearchDocuments,exportResearchDocuments,RESEARCH_DOCUMENT_PREFIXES} from './research-documents.mjs';
import {callResearchCitationUpdates,RESEARCH_CITATION_REVIEW_PREFIX} from './research-citation-updates.mjs';
import {callResearchExtraction,exportResearchExtraction,RESEARCH_EXTRACTION_PREFIX} from './research-extraction.mjs';
import {callResearchEligibility,exportResearchEligibility,RESEARCH_ELIGIBILITY_PREFIX} from './research-eligibility.mjs';
import {callResearchEuropePmc,exportResearchEuropePmc,RESEARCH_EUROPE_PMC_PREFIX} from './research-europe-pmc.mjs';
export {researchWorkspaceTools} from './catalog/research-workspace.mjs';
import {ResearchWorkspaceClient} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/workspace-client.mjs';
import {readResearchHostFile,openResearchSource} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/workspace-files.mjs';
import {researchSummary,researchCrossrefReview}
  from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/workspace-protocol.mjs';
import {privateDirectory,writeJson,parseJson} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/store.mjs';

export const RESEARCH_MERCHANT_CONNECTION_SCHEMA='stellar-forge.research-workspaces.v1';
const EXPORTS=RESEARCH_EXPORTS;
const definitions=new Map(researchWorkspaceTools((name,_description,properties,required)=>({name,properties,required})).map(row=>[row.name,row]));
function hostPath(value,base){
  if(typeof value!=='string'||!value||/[\u0000-\u001f\u007f]/.test(value))throw failure('CONFIGURATION_ERROR','Declare an original host path.');
  return resolve(base,value);
}
function checkedDigest(value){
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw failure('INVALID_PARAMS','Select the original complete SHA256.');
  return value;
}
export async function readResearchWorkspaceConfiguration(file){
  file=resolve(file);const raw=parseJson(await readResearchHostFile(file,1024*1024,{privateFile:true}));
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  if(raw.schema!==RESEARCH_MERCHANT_CONNECTION_SCHEMA||!plain(raw.workspaces)||
    Object.keys(raw.workspaces).length<1||Object.keys(raw.workspaces).length>32)
    throw failure('CONFIGURATION_ERROR','Declare the existing Research workspace aliases.');
  const base=dirname(file),workspaces=Object.create(null);
  for(const[alias,value]of Object.entries(raw.workspaces)){
    identifier(alias);exact(value,['label','consoleUrlFile','directory','sources'],['consoleUrlFile','directory']);
    const sources=Object.create(null);
    if(value.sources!==undefined&&(!plain(value.sources)||Object.keys(value.sources).length>128))
      throw failure('CONFIGURATION_ERROR','Declare original source handles.');
    for(const[name,source]of Object.entries(value.sources??{})){
      identifier(name);exact(source,['file','kind','sha256','provider','sourceReference','filename','contentType'],['file','kind','sha256']);
      if(!['research','reference','portable','clinicaltrials-packet','source-bundle','pipeline-input','europe-pmc-packet','europe-pmc-portable'].includes(source.kind)||!['portable','clinicaltrials-packet','source-bundle','pipeline-input','europe-pmc-packet','europe-pmc-portable'].includes(source.kind)&&
        (typeof source.provider!=='string'||!/^[a-z][a-z0-9_-]{0,79}$/.test(source.provider)))
        throw failure('CONFIGURATION_ERROR','Each source declares its original kind and provider.');
      if(source.sourceReference!==undefined&&(typeof source.sourceReference!=='string'||source.sourceReference.length>4000)||
        source.kind==='reference'&&!/^[a-z0-9-]+$/.test(source.provider))
        throw failure('CONFIGURATION_ERROR','Use the original reference provider and source reference.');
      if(source.filename!==undefined&&(source.kind!=='pipeline-input'||typeof source.filename!=='string'||
        !source.filename.trim()||Buffer.byteLength(source.filename)>1024||/[\\/\u0000-\u001f\u007f]/.test(source.filename))||
        source.contentType!==undefined&&(source.kind!=='pipeline-input'||typeof source.contentType!=='string'||
          !source.contentType.trim()||Buffer.byteLength(source.contentType)>256||/[\u0000-\u001f\u007f]/.test(source.contentType)))
        throw failure('CONFIGURATION_ERROR','Declare the original pipeline input filename and content type.');
      sources[name]={...source,file:hostPath(source.file,base),sha256:checkedDigest(source.sha256)};
    }
    workspaces[alias]={label:line(value.label??alias),consoleUrlFile:hostPath(value.consoleUrlFile,base),
      directory:hostPath(value.directory,base),sources};
  }
  return {schema:RESEARCH_MERCHANT_CONNECTION_SCHEMA,workspaces};
}
const compactCrossref=value=>researchCrossrefReview({...value,review:value.review??null});
const compactDossier=value=>value?.dossier?{...value,dossier:researchSummary(value.dossier)}:researchSummary(value);

const hash=value=>createHash('sha256').update(value).digest('hex');
const clean=value=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined));
function checkValue(value,schema){
  if(schema.type==='string'&&(typeof value!=='string'||schema.minLength!==undefined&&value.length<schema.minLength||
    schema.maxLength!==undefined&&value.length>schema.maxLength||schema.pattern&&!new RegExp(schema.pattern).test(value))||
    schema.type==='integer'&&(!Number.isSafeInteger(value)||schema.minimum!==undefined&&value<schema.minimum||
      schema.maximum!==undefined&&value>schema.maximum)||schema.type==='boolean'&&typeof value!=='boolean'||
    schema.enum&&!schema.enum.includes(value))
    throw failure('INVALID_PARAMS','Use the declared native field values and reviewed identifiers.');
  if(schema.type==='object'){
    const properties=schema.properties??{},required=schema.required??[];
    if(schema.additionalProperties===true){
      if(!plain(value)||required.some(key=>!Object.hasOwn(value,key)))
        throw failure('INVALID_PARAMS','Supply the complete declared native object and required fields.');
    }else exact(value,Object.keys(properties),required);
    for(const[key,item]of Object.entries(value))
      if(Object.hasOwn(properties,key))checkValue(item,properties[key]);
  }
  if(schema.type==='array'){
    if(!Array.isArray(value)||schema.minItems!==undefined&&value.length<schema.minItems||
      schema.maxItems!==undefined&&value.length>schema.maxItems||
      schema.uniqueItems&&new Set(value).size!==value.length)
      throw failure('INVALID_PARAMS','Use the original unique source identifiers within the declared limit.');
    for(const item of value)checkValue(item,schema.items);
  }
}
function validate(name,args){
  const definition=definitions.get(name);
  if(!definition)throw failure('TOOL_NOT_FOUND','Unknown Research operation.');
  exact(args,Object.keys(definition.properties),definition.required);
  for(const[key,value]of Object.entries(args))checkValue(value,definition.properties[key]);
}
function kind(value){
  if(!Object.hasOwn(EXPORTS,value))throw failure('INVALID_PARAMS','Select an original Research export kind.');
  return EXPORTS[value];
}
const nativeFields=(args,removed)=>Object.fromEntries(Object.entries(args).filter(([key])=>!removed.includes(key)));
const mutationReceipt=(view,section,selectedId)=>{
  const rows=view[section]??[],selected=selectedId?rows.find(row=>row.id===selectedId):rows.at(-1);
  return {dossier:researchSummary(view),...(selected?{[section.slice(0,-1)]:selected}:{})};
};
export class MerchantResearchWorkspaces{
  #definitions;#exports;#entries=new Map();#opening=new Map();#detached=new Map();
  #pending=new Set();#reads=new RetainedFileReads({errorPrefix:'RESEARCH_EXPORT',maxSnapshotBytes:256*1024*1024});
  #closed=false;#closing;
  constructor(config={}){
    this.#definitions=config.researchWorkspaces?.workspaces??{};
    this.#exports=config.exportsDirectory?resolve(config.exportsDirectory):null;
  }
  get summary(){
    return {configured:Object.keys(this.#definitions).length>0,
      listenerOwnership:'ORIGINAL_APPLICATIONS_WORKSPACE',
      workspaces:Object.entries(this.#definitions).map(([workspace,value])=>{
        const entry=this.#entries.get(workspace);
        return {workspace,label:value.label,state:entry?(entry.detaching?'DETACHING':'ATTACHED'):'DETACHED',
          attachmentId:entry?.id??null,workspaceId:entry?.client.workspaceId??null,
          sources:Object.entries(value.sources??{}).map(([source,item])=>({source,kind:item.kind,
            provider:item.provider??null,sha256:item.sha256,
            ...(item.kind==='pipeline-input'?{filename:item.filename??null,contentType:item.contentType??'application/octet-stream'}:{})})),
          reads:entry?this.#reads.status(entry.id):null};
      }),exports:this.#reads.summary};
  }
  #definition(alias){
    identifier(alias,'Research workspace');
    const value=this.#definitions[alias];
    if(!value)throw failure('RESEARCH_WORKSPACE_NOT_CONFIGURED','Select a host-declared existing Research workspace.');
    return value;
  }
  #track(work){
    if(this.#closed)throw failure('RESEARCH_MERCHANT_CLOSED','The Research attachment is closing.');
    const pending=Promise.resolve().then(work);this.#pending.add(pending);
    return pending.finally(()=>this.#pending.delete(pending));
  }
  async #attach(alias){
    const definition=this.#definition(alias),current=this.#entries.get(alias);
    if(current){
      if(current.detaching)throw failure('RESEARCH_ATTACHMENT_CLOSING','The original attachment is draining.');
      return this.#describe(current,await current.client.status());
    }
    if(this.#opening.has(alias))return this.#opening.get(alias);
    const opening=(async()=>{
      if(!this.#exports)throw failure('RESEARCH_EXPORT_DIRECTORY_REQUIRED','Configure the original private merchant exports directory.');
      const directory=await privateDirectory(join(await privateDirectory(join(this.#exports,'research')),alias));
      const client=new ResearchWorkspaceClient({connectionFile:definition.consoleUrlFile,directory:definition.directory});
      try{
        const status=await client.status();
        const entry={alias,id:randomUUID(),definition,client,directory,pending:new Set(),detaching:false};
        this.#entries.set(alias,entry);this.#detached.delete(alias);
        return this.#describe(entry,status);
      }catch(error){await client.close();throw error;}
    })();
    this.#opening.set(alias,opening);
    try{return await opening;}finally{if(this.#opening.get(alias)===opening)this.#opening.delete(alias);}
  }
  #describe(entry,status){
    return {workspace:entry.alias,label:entry.definition.label,attachmentId:entry.id,state:'ATTACHED',
      listenerOwnership:'ORIGINAL_APPLICATIONS_WORKSPACE',status,reads:this.#reads.status(entry.id)};
  }
  #entry(alias){
    this.#definition(alias);const entry=this.#entries.get(alias);
    if(!entry)throw failure('RESEARCH_ATTACHMENT_REQUIRED','Attach to the original Research listener first.');
    if(entry.detaching)throw failure('RESEARCH_ATTACHMENT_CLOSING','The original attachment is draining.');
    return entry;
  }
  async #with(alias,work){
    const entry=this.#entry(alias),pending=Promise.resolve().then(()=>work(entry));entry.pending.add(pending);
    try{return await pending;}finally{entry.pending.delete(pending);}
  }
  async #detach(alias,id){
    this.#definition(alias);const entry=this.#entries.get(alias);
    if(!entry){
      if(this.#detached.get(alias)!==id)throw failure('RESEARCH_ATTACHMENT_CONFLICT','Use the current original attachment ID.');
      return {workspace:alias,attachmentId:id,state:'DETACHED',listenerOwnership:'ORIGINAL_APPLICATIONS_WORKSPACE'};
    }
    if(entry.id!==id)throw failure('RESEARCH_ATTACHMENT_CONFLICT','Use the current original attachment ID.');
    if(!entry.close){
      entry.detaching=true;
      entry.close=(async()=>{
        await Promise.allSettled([...entry.pending]);
        await this.#reads.closeScope(entry.id);
        await entry.client.close();
        if(this.#entries.get(alias)===entry)this.#entries.delete(alias);
        this.#detached.set(alias,id);
        return {workspace:alias,attachmentId:id,state:'DETACHED',workspaceId:entry.client.workspaceId,
          listenerOwnership:'ORIGINAL_APPLICATIONS_WORKSPACE'};
      })().catch(error=>{
        // RetainedFileReads preserves failed handles for the SAME owner to
        // retry. Keep detaching and the entry, but release the failed promise.
        entry.close=null;throw error;
      });
    }
    return entry.close;
  }
  #source(entry,name,accepted){
    identifier(name,'Research source');
    const source=entry.definition.sources?.[name];
    if(!source||!accepted.includes(source.kind))throw failure('RESEARCH_SOURCE_REQUIRED','Select a host-declared source of the required original kind.');
    return source;
  }
  #file(entry,kindName,sha256){
    const type=kind(kindName);checkedDigest(sha256);
    return join(entry.directory,kindName+'-'+sha256+'.'+type.extension);
  }
  async #manifest(entry,kindName,sha256){
    const file=this.#file(entry,kindName,sha256);
    const value=parseJson(await readResearchHostFile(file+'.manifest.json',65536,{privateFile:true}));
    if(value.schema!=='stellar-forge.research-retained-export.v1'||value.workspaceId!==entry.client.workspaceId||
      value.kind!==kindName||value.sha256!==sha256||!Number.isSafeInteger(value.bytes)||value.bytes<0||
      value.bytes>256*1024*1024||typeof value.filename!=='string'||/[\\/\u0000-\u001f\u007f]/.test(value.filename)||
      typeof value.contentType!=='string'||value.contentType.length>256)
      throw failure('RESEARCH_EXPORT_CHANGED','The original retained export manifest differs.');
    return {file,value};
  }
  async #retain(entry,args){
    const spec=kind(args.kind),temporary=join(entry.directory,'.export-'+randomUUID()+'.'+spec.extension);
    let result,selection,verification;
    const download=async work=>{
      try{return await work();}
      catch(error){
        if(error.code!=='RESEARCH_EXPORTED_FILE_CHANGED'||error.destinationPublished!==true||
          error.file?.file!==temporary)throw error;
        // The original receiver completed this file. Verify and retain those
        // actual bytes before reporting the reviewed-digest mismatch.
        const original=await openResearchSource(temporary,256*1024*1024,{sha256:checkedDigest(error.file.sha256)});
        try{if(original.bytes!==error.file.bytes)throw failure('RESEARCH_EXPORT_CHANGED','The completed download length differs.');}
        finally{await original.close();}
        verification={state:'DIGEST_MISMATCH',expectedSha256:error.expectedSha256??args.expectedSha256,actualSha256:error.file.sha256,
          ...(error.expectedBytes!==undefined?{expectedBytes:error.expectedBytes,actualBytes:error.file.bytes}:{})};
        return error.file;
      }
    };
    try{
      if(args.kind.startsWith('document-')||args.kind.startsWith('pipeline-')){
        ({result,selection}=await exportResearchDocuments(entry.client,args,{file:temporary,download}));
      }else if(args.kind.startsWith('clinicaltrials-')){
        ({result,selection}=await exportResearchClinicalTrials(entry.client,args,{file:temporary,download}));
      }else if(args.kind.startsWith('europe-pmc-')){
        ({result,selection}=await exportResearchEuropePmc(entry.client,args,{file:temporary,download}));
      }else if(args.kind.startsWith('eligibility-')){
        ({result,selection}=await exportResearchEligibility(entry.client,args,{file:temporary,download}));
      }else if(args.kind.startsWith('extraction-')){
        ({result,selection}=await exportResearchExtraction(entry.client,args,{file:temporary,download}));
      }else if(spec.format){
        exact(args,['workspace','dossierId','kind','revision','expectedSha256'],['workspace','dossierId','kind']);
        result=await download(()=>entry.client.exportDossier(args.dossierId,{format:spec.format,file:temporary,revision:args.revision,expectedSha256:args.expectedSha256}));
        selection={dossierId:args.dossierId,revision:result.revision??null};
      }else if(args.kind==='crossref-edition'){
        exact(args,['workspace','dossierId','kind','operationId','expectedSha256'],['workspace','dossierId','kind','operationId']);
        result=await download(()=>entry.client.exportCrossrefEdition(args.dossierId,args.operationId,{file:temporary,expectedSha256:args.expectedSha256}));
        selection={dossierId:args.dossierId,operationId:args.operationId};
      }else if(args.kind==='retained-edition'){
        exact(args,['workspace','dossierId','kind','editionId','revision','expectedSha256'],['workspace','dossierId','kind','editionId']);
        result=await download(()=>entry.client.exportRetainedEdition(args.dossierId,args.editionId,{file:temporary,
          revision:args.revision,expectedSha256:args.expectedSha256}));
        selection={dossierId:args.dossierId,editionId:args.editionId,revision:result.revision??null};
      }else if(['source-content','source-record','source-file'].includes(args.kind)){
        const fields=['workspace','dossierId','kind','editionId','key','revision','expectedSha256'];
        const required=['workspace','dossierId','kind','editionId','key'];
        if(args.kind==='source-file'){fields.push('fileName');required.push('fileName','expectedSha256');}
        exact(args,fields,required);
        const options={editionId:args.editionId,key:args.key,revision:args.revision,file:temporary,
          expectedSha256:args.expectedSha256};
        result=await download(()=>args.kind==='source-file'?entry.client.exportSourceFile(args.dossierId,{...options,name:args.fileName}):
          entry.client.exportSource(args.dossierId,{...options,part:args.kind==='source-record'?'record':'content'}));
        selection={dossierId:args.dossierId,editionId:args.editionId,key:args.key,
          revision:result.revision,occurrenceId:result.occurrenceId,
          ...(args.kind==='source-file'?{fileName:args.fileName}:{})};
      }else{
        exact(args,['workspace','dossierId','kind','before','after','expectedSha256'],['workspace','dossierId','kind','before','after']);
        result=await download(()=>entry.client.exportComparison(args.dossierId,{before:args.before,after:args.after,file:temporary,expectedSha256:args.expectedSha256}));
        selection={dossierId:args.dossierId,before:args.before,after:args.after};
      }
      const retained=this.#file(entry,args.kind,result.sha256);
      try{await link(temporary,retained);}
      catch(error){
        if(error.code!=='EEXIST')throw error;
        const original=await openResearchSource(retained,256*1024*1024,{sha256:result.sha256});
        try{if(original.bytes!==result.bytes)throw failure('RESEARCH_EXPORT_CHANGED','The original retained export length differs.');}
        finally{await original.close();}
      }
      const manifest={schema:'stellar-forge.research-retained-export.v1',workspaceId:entry.client.workspaceId,
        kind:args.kind,sha256:result.sha256,bytes:result.bytes,filename:'research-'+args.kind+'-'+result.sha256+'.'+spec.extension,
        contentType:result.contentType,retainedAt:new Date().toISOString(),selection};
      try{await writeJson(retained+'.manifest.json',manifest,{exclusive:true});}
      catch(error){
        if(error.code!=='EEXIST')throw error;
        const saved=await this.#manifest(entry,args.kind,result.sha256);
        if(saved.value.bytes!==result.bytes)throw failure('RESEARCH_EXPORT_CHANGED','The existing original export manifest differs.');
      }
      const receipt={schema:'stellar-forge.research-export-receipt.v1',receiptId:randomUUID(),
        workspaceId:entry.client.workspaceId,kind:args.kind,exportId:result.sha256,bytes:result.bytes,
        sourceFilename:result.filename,contentType:result.contentType,retainedAt:new Date().toISOString(),selection,
        ...(verification?{verification}:{})};
      await writeJson(join(entry.directory,'receipt-'+receipt.receiptId+'.json'),receipt,{exclusive:true});
      return {workspace:entry.alias,...receipt,state:verification?'RETAINED_DIGEST_MISMATCH':'RETAINED'};
    }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  async #exportsPage(entry,{dossierId,offset=0,limit=30,snapshot}={}){
    const names=(await readdir(entry.directory)).filter(name=>/^receipt-[a-f0-9-]{36}\.json$/.test(name)).sort();
    const values=[];
    for(const name of names){
      const value=parseJson(await readResearchHostFile(join(entry.directory,name),65536,{privateFile:true}));
      if(value.schema!=='stellar-forge.research-export-receipt.v1'||value.workspaceId!==entry.client.workspaceId)
        throw failure('RESEARCH_EXPORT_CHANGED','An original export receipt differs.');
      if(dossierId===undefined||value.selection.dossierId===dossierId)values.push(value);
    }
    const current=hash(JSON.stringify(values));
    if(offset>0&&snapshot!==current)throw failure('RESEARCH_EXPORT_INVENTORY_CHANGED','Read page zero from the current retained export inventory.');
    if(offset>values.length)throw failure('INVALID_PARAMS','Select an offset within the retained export inventory.');
    const items=values.slice(offset,offset+limit),nextOffset=offset+items.length<values.length?offset+items.length:null;
    return {workspace:entry.alias,snapshot:current,offset,limit,total:values.length,items,
      next:nextOffset===null?null:{offset:nextOffset,limit,snapshot:current}};
  }
  async #read(entry,args){
    const selected=await this.#manifest(entry,args.kind,args.exportId),value=selected.value;
    return this.#reads.read({scope:entry.id,key:args.kind+':'+args.exportId,kind:args.kind,directory:entry.directory,
      expectedSha256:args.exportId,readId:args.readId,offset:args.offset??0,limit:args.limit??65536,
      loadFile:async()=>({path:selected.file,name:value.filename,type:value.contentType,bytes:value.bytes})});
  }
  async #reopen(entry,args){
    if((args.source!==undefined)===(args.exportId!==undefined))
      throw failure('INVALID_PARAMS','Select exactly one original portable source or retained export.');
    if(args.source!==undefined){
      if(args.kind!==undefined)throw failure('INVALID_PARAMS','A host source declares its original file kind.');
      const source=this.#source(entry,args.source,['portable']);
      return entry.client.reopenFile(source.file,{expectedSha256:source.sha256});
    }
    if(!['portable-json','portable-gzip'].includes(args.kind))
      throw failure('INVALID_PARAMS','Select the retained portable JSON or gzip export.');
    const selected=await this.#manifest(entry,args.kind,args.exportId);
    return entry.client.reopenFile(selected.file,{expectedSha256:args.exportId});
  }
  async #execute(name,args){
    if(name==='merchant_research_workspaces')return this.summary;
    if(name==='merchant_research_attach')return this.#attach(args.workspace);
    if(name==='merchant_research_detach')return this.#detach(args.workspace,args.attachmentId);
    return this.#with(args.workspace,async entry=>{
      const c=entry.client,id=args.dossierId,input=nativeFields(args,['workspace','dossierId']);
      if(name.startsWith(RESEARCH_ELIGIBILITY_PREFIX))return callResearchEligibility(c,name,args);
      if(name.startsWith(RESEARCH_CITATION_REVIEW_PREFIX))return callResearchCitationUpdates(c,name,args);
      if(name.startsWith(RESEARCH_EXTRACTION_PREFIX))return callResearchExtraction(c,name,args);
      if(name.startsWith(RESEARCH_EUROPE_PMC_PREFIX))return callResearchEuropePmc(c,name,args,{
        source:(name,accepted)=>this.#source(entry,name,accepted)});
      if(RESEARCH_DOCUMENT_PREFIXES.some(prefix=>name.startsWith(prefix))){
        const result=await callResearchDocuments(c,name,args,{source:(name,accepted)=>this.#source(entry,name,accepted)});
        return name.endsWith('_receive')?compactDossier(result):result;
      }
      if(name.startsWith(RESEARCH_CLINICALTRIALS_PREFIX)){
        const result=await callResearchClinicalTrials(c,name,args,{source:(name,accepted)=>this.#source(entry,name,accepted)});
        return name==='merchant_research_clinicaltrials_receive'?compactDossier(result):result;
      }
      switch(name){
        case 'merchant_research_status':return this.#describe(entry,await c.status());
        case 'merchant_research_list':return c.list(input);
        case 'merchant_research_dossier':return c.metadata(id,input);
        case 'merchant_research_section':return c.section(id,input);
        case 'merchant_research_source':return c.source(id,input);
        case 'merchant_research_create':return researchSummary(await c.createDossier(input));
        case 'merchant_research_update':return researchSummary(await c.updateDossier(id,input));
        case 'merchant_research_question':{
          const {questionId,...change}=input;
          if(questionId)return mutationReceipt(await c.updateQuestion(id,questionId,change),'questions',questionId);
          if(change.text===undefined||change.notes!==undefined||change.status!==undefined)
            throw failure('INVALID_PARAMS','Add a question using text; edit its saved ID to change notes or status.');
          return mutationReceipt(await c.addQuestion(id,change),'questions');
        }
        case 'merchant_research_evidence':{
          const {sourceId,occurrenceId,...change}=input;
          if((sourceId!==undefined)===(occurrenceId!==undefined))
            throw failure('INVALID_PARAMS','Select exactly one source ID or saved occurrence ID.');
          const value=occurrenceId?await c.updateSelection(id,{...change,occurrenceId}):await c.selectEvidence(id,{...change,sourceId});
          return {dossier:researchSummary(value),...(occurrenceId?{selection:value.selections.find(row=>row.occurrenceId===occurrenceId)}:{sourceId,selected:change.selected,selectionCount:value.selections.length})};
        }
        case 'merchant_research_finding':{
          const {findingId,...change}=input;
          if(findingId){
            if(change.questionId!==undefined)throw failure('INVALID_PARAMS','An existing finding keeps its original question.');
            return mutationReceipt(await c.updateFinding(id,findingId,change),'findings',findingId);
          }
          if(change.questionId===undefined||change.title===undefined||change.text===undefined||change.sourceIds===undefined)
            throw failure('INVALID_PARAMS','Add the finding with its original question, title, analysis and cited sources.');
          return mutationReceipt(await c.addFinding(id,change),'findings');
        }
        case 'merchant_research_compare':return c.compare(id,input);
        case 'merchant_research_receive_source':{
          const source=this.#source(entry,args.source,['research','reference']);
          const request=clean({questionId:args.questionId,label:args.label,expectedRevision:args.expectedRevision,
            provider:source.provider,sourceReference:source.sourceReference});
          if(source.kind==='reference'){
            const reference=parseJson(await readResearchHostFile(source.file,1024*1024,{sha256:source.sha256}));
            delete request.sourceReference;
            return compactDossier(await c.receiveReference(id,{...request,reference}));
          }
          return compactDossier(await c.receiveResearchFile(id,{...request,file:source.file,sha256:source.sha256}));
        }
        case 'merchant_research_source_bundle_preview':{
          const source=this.#source(entry,args.source,['source-bundle']);
          return c.previewSourceBundleFile(id,{questionId:args.questionId,file:source.file,sha256:source.sha256});
        }
        case 'merchant_research_source_bundle_receive':{
          const source=this.#source(entry,args.source,['source-bundle']);
          if(args.expectedBundleSha256!==undefined&&args.expectedBundleSha256!==source.sha256)
            throw failure('RESEARCH_SOURCE_BUNDLE_CHANGED','The reviewed bundle hash differs from the selected original source.');
          return compactDossier(await c.receiveSourceBundleFile(id,{
            questionId:args.questionId,expectedRevision:args.expectedRevision,
            expectedBundleSha256:args.expectedBundleSha256??source.sha256,
            file:source.file,sha256:source.sha256}));
        }
        case 'merchant_research_openalex_editions':return c.openAlexEditions();
        case 'merchant_research_receive_openalex':return compactDossier(await c.receiveOpenAlex(id,input));
        case 'merchant_research_crossref_prepare':return compactCrossref(await c.prepareCrossref(id,input));
        case 'merchant_research_crossref_operations':{
          const result=await c.crossrefOperations(id,input);return {...result,items:result.items.map(compactCrossref)};
        }
        case 'merchant_research_crossref_review':return c.reviewCrossref(id,args.operationId,
          nativeFields(input,['operationId']));
        case 'merchant_research_crossref_start':return compactCrossref(await c.startCrossref(id,args.operationId,
          {expectedPlanSha256:args.expectedPlanSha256}));
        case 'merchant_research_crossref_stop':return compactCrossref(await c.stopCrossref(id,args.operationId));
        case 'merchant_research_crossref_receive':return compactDossier(await c.receiveCrossref(id,args.operationId,
          nativeFields(input,['operationId'])));
        case 'merchant_research_export':return this.#retain(entry,args);
        case 'merchant_research_exports':return this.#exportsPage(entry,args);
        case 'merchant_research_file_read':return this.#read(entry,args);
        case 'merchant_research_file_release':await this.#reads.release(entry.id,args.readId);return {state:'RELEASED',readId:args.readId};
        case 'merchant_research_reopen':return compactDossier(await this.#reopen(entry,args));
        default:throw failure('TOOL_NOT_FOUND','Unknown Research operation.');
      }
    });
  }
  call(name,args={}){
    validate(name,args);
    return this.#track(async()=>{
      try{return await this.#execute(name,args);}
      catch(error){
        if(error.outcomeUnknown)throw Object.assign(failure(error.code??'RESEARCH_CONNECTION_INTERRUPTED',
          error.recovery??'The original write response was interrupted. Read the saved dossier revision and the same source receiving operation or retained input before another write.'),
          {outcomeUnknown:true,dossierId:args.dossierId??args.input?.dossierId,
            operationId:error.operationId??args.operationId??args.input?.operationId,
            requestId:error.requestId??args.requestId??args.input?.requestId,sourceId:args.sourceId,
            ...(name.startsWith(RESEARCH_EUROPE_PMC_PREFIX)?{library:args.library}:{}),
            ...(error.recovery?{recovery:error.recovery}:{})});
        throw error;
      }
    });
  }
  close(){
    if(!this.#closing){
      this.#closed=true;
      this.#closing=(async()=>{
        await Promise.allSettled([...this.#pending]);
        await Promise.all([...this.#entries.values()].map(entry=>this.#detach(entry.alias,entry.id)));
        await this.#reads.close();
        return {state:'DETACHED',listenerOwnership:'ORIGINAL_APPLICATIONS_WORKSPACE'};
      })().catch(error=>{
        // Closing remains admission-closed while its original readers retry.
        this.#closing=null;throw error;
      });
    }
    return this.#closing;
  }
}
