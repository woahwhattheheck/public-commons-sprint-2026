// MIT. Cryptoworth operations share the original merchant accounting owner.
import {createHash} from 'node:crypto';
import {CryptoworthWorkspace,CRYPTOWORTH_PACKET_BYTES} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/cryptoworth-workspace.mjs';
import {inspectCryptoworthTemplate,CRYPTOWORTH_FILE_BYTES,cwCanonical} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/cryptoworth-csv.mjs';
import {CRYPTOWORTH_TOOL_PREFIX,cryptoworthDefinitions,CRYPTOWORTH_FILE_SELECTORS,cryptoworthPreviewBinding,cryptoworthFileName} from './accounting-cryptoworth-contract.mjs';
export {cryptoworthDefinitions,cryptoworthFileName};
export const cryptoworthFileSelectors=CRYPTOWORTH_FILE_SELECTORS;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value),copy=value=>structuredClone(value);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>Object.assign(new Error(message),{code});
function need(ok,code,message){if(!ok)throw fail(code,message);}
function page(items,args={},view){
  const offset=args.offset??0,limit=args.limit??50;
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'INVALID_CRYPTOWORTH_PAGE','Choose a nonnegative offset and 1–200 retained records.');
  return {view,items:copy(items.slice(offset,offset+limit)),total:items.length,offset,limit,nextOffset:offset+limit<items.length?offset+limit:null};
}
function shortRecord(value){
  if(!value)return value;
  const {files,stageFiles,captures,returns,receivedPackets,revisions,...rest}=value;
  return {...copy(rest),...(files?{fileCount:files.length}:{}),...(stageFiles?{stageFileCount:stageFiles.length}:{}),
    ...(captures?{captureCount:captures.length}:{}),...(returns?{returnCount:returns.length}:{}),
    ...(receivedPackets?{receivedPacketCount:receivedPackets.length}:{}),
    ...(revisions?{revisionCount:revisions.length,latestRevision:copy(revisions.at(-1)??null)}:{})};
}
function sourceLocations(kind,request){
  if(['profile','capture','template','packet'].includes(kind))return [{get:()=>request.file,set:value=>{request.file=value;}}];
  if(kind==='plan')return (request.dateEvidence??[]).map(row=>({get:()=>row.file,set:value=>{row.file=value;}}));
  return [];
}
function compactPlan(value){
  const {decisions,dateEvidence,...plan}=value;
  return {...plan,decisionCount:decisions?.length??0,dateEvidenceCount:dateEvidence?.length??0};
}
/** All source files come from the original host-configured input map. */
export class MerchantCryptoworth{
  constructor(workspace,accountant,{readSource}={}){
    need(typeof readSource==='function','CRYPTOWORTH_CONFIGURATION_ERROR','Use the original declared accounting input reader.');
    this.workspace=workspace;this.controller=new CryptoworthWorkspace(workspace,accountant);this.readSource=readSource;
  }
  async close(){await this.controller.pendingMutation;}
  binding(args){
    if(args.workspaceId!==undefined)need(args.workspaceId===this.controller.workspaceId,'CRYPTOWORTH_WORKSPACE_CHANGED','Reopen the same original accounting workspace before continuing its saved request.');
  }
  result(value){return {workspaceId:this.controller.workspaceId,revision:this.workspace.state.revision,...value};}
  async expand(kind,value,{pinned=false}={}){
    const request=copy(value),references=[],locations=sourceLocations(kind,request);
    let aggregate=0;
    for(const location of locations){
      const selected=location.get();
      need(plain(selected)&&Object.keys(selected).every(key=>['source','name','sha256','bytes'].includes(key))&&
        /^[a-z0-9][a-z0-9_-]{0,63}$/.test(selected.source??'')&&typeof selected.name==='string'&&selected.name.trim().length>0&&
        selected.name.length<=240&&!/[\\/\r\n\0]/.test(selected.name)&&!['.','..'].includes(selected.name),
        'CRYPTOWORTH_SOURCE_REQUIRED','Select the configured original input alias and original filename.');
      if(pinned)need(/^[a-f0-9]{64}$/.test(selected.sha256??'')&&Number.isSafeInteger(selected.bytes)&&selected.bytes>0,
        'CRYPTOWORTH_SOURCE_BINDING_REQUIRED','Keep every reviewed input SHA256 and byte count unchanged.');
      const maximum=kind==='packet'?CRYPTOWORTH_PACKET_BYTES:CRYPTOWORTH_FILE_BYTES;
      const bytes=Buffer.from(await this.readSource(selected.source,maximum));
      need(bytes.length>0&&bytes.length<=maximum,'CRYPTOWORTH_SOURCE_SIZE','Select the complete original file within its native size limit.');
      aggregate+=bytes.length;
      need(kind!=='plan'||aggregate<=64*1024*1024,'CRYPTOWORTH_DATE_EVIDENCE_SIZE','The complete original date-source selection exceeds 64 MiB.');
      const actual=sha(bytes);
      need(selected.sha256===undefined||selected.sha256===actual,'CRYPTOWORTH_SOURCE_CHANGED','The declared input changed after review. Select and review its actual current bytes.');
      need(selected.bytes===undefined||selected.bytes===bytes.length,'CRYPTOWORTH_SOURCE_CHANGED','The declared input byte count changed after review.');
      references.push({source:selected.source,name:selected.name.trim(),sha256:actual,bytes:bytes.length});
      location.set({name:selected.name.trim(),dataBase64:bytes.toString('base64')});
    }
    return {request,references};
  }
  compact(kind,value,references){
    const result=copy(value),locations=sourceLocations(kind,result.request??{});
    need(locations.length===references.length,'CRYPTOWORTH_SOURCE_BINDING_CHANGED','The native request changed its original source-file selection.');
    for(let index=0;index<locations.length;index++){
      const original=locations[index].get(),bytes=Buffer.from(original.dataBase64,'base64'),reference=references[index];
      need(original.name===reference.name&&sha(bytes)===reference.sha256&&bytes.length===reference.bytes,
        'CRYPTOWORTH_SOURCE_BINDING_CHANGED','The original native normalizer changed the reviewed source bytes.');
      const {dataBase64,...attributes}=original;
      locations[index].set({...attributes,...reference});
    }
    return result;
  }
  async preview(kind,args){
    const expanded=await this.expand(kind,args.request);
    const methods={profile:'previewProfile',plan:'previewPlan',capture:'previewCapture',return:'previewReturn'},method=methods[kind];
    const result=await (kind==='capture'||kind==='return'
      ?this.controller[method](args.planId,expanded.request,args)
      :this.controller[method](expanded.request,args));
    const value=this.result({...this.compact(kind,result,expanded.references),kind,requestSha256:sha(cwCanonical(result.request)),...(args.planId?{planId:args.planId}:{})});
    return {...value,wireSha256:sha(cwCanonical(cryptoworthPreviewBinding(value)))};
  }
  async save(kind,args){
    this.binding(args);
    const expanded=await this.expand(kind,args.request,{pinned:true});
    const methods={profile:'createProfile',plan:'createPlan',capture:'createCapture',return:'saveReturn'},method=methods[kind];
    const result=await (kind==='capture'||kind==='return'
      ?this.controller[method](args.planId,expanded.request)
      :this.controller[method](expanded.request));
    return this.result({...result,kind,...(args.planId?{planId:args.planId}:{})});
  }
  async file(args){
    const {profileId,planId,captureId,returnId,rollbackId,scope,file}=args;
    need(Boolean(profileId)!==Boolean(planId),'INVALID_CRYPTOWORTH_DOWNLOAD','Select one original mapping or receiving plan.');
    if(profileId){
      need(!captureId&&!returnId&&!rollbackId&&!scope&&file!=='packet','INVALID_CRYPTOWORTH_DOWNLOAD','Use only the original mapping ID and retained filename.');
      return this.controller.profileFile(profileId,file);
    }
    if(file==='packet'){
      need(!captureId&&!returnId&&!rollbackId&&!scope,'INVALID_CRYPTOWORTH_DOWNLOAD','A complete receiving packet selects only its original plan.');
      return this.controller.packet(planId);
    }
    need(scope===undefined||Boolean(returnId),'INVALID_CRYPTOWORTH_DOWNLOAD','A staged/completed file scope requires the original accountant return ID.');
    return this.controller.file(planId,file,{captureId,returnId,rollbackId,scope});
  }
  async call(operation,args){
    this.binding(args);
    const name=operation.slice(CRYPTOWORTH_TOOL_PREFIX.length);
    const reviewed=/^(profile|plan|capture|return)_(preview|save)$/.exec(name);
    if(reviewed)return reviewed[2]==='preview'?this.preview(reviewed[1],args):this.save(reviewed[1],args);
    switch(name){
      case 'status':{
        const view=args.view??'summary',state=this.controller.view(),rollbacks=this.workspace.state.cryptoworthRollbacks??[];
        if(view==='summary')return this.result({docs:state.docs,dateFormats:state.dateFormats,requiredRoles:state.requiredRoles,
          counts:{profiles:state.profiles.length,plans:state.plans.length,handoffs:state.handoffs.length,rollbacks:rollbacks.length}});
        const items={profiles:state.profiles,plans:state.plans,handoffs:state.handoffs,rollbacks}[view];
        return this.result({page:page(items.map(shortRecord),args,view)});
      }
      case 'source':return this.result(await this.controller.source(args));
      case 'template':{
        const {request,references}=await this.expand('template',args);
        return this.result({...inspectCryptoworthTemplate(request.file,{delimiter:args.delimiter}),file:references[0]});
      }
      case 'profile':return this.result(await this.controller.profileDetail(args.profileId));
      case 'plan':{
        const detail=await this.controller.detail(args.planId),view=args.view??'summary',record=shortRecord(detail.record),plan=compactPlan(detail.plan);
        if(view==='summary')return this.result({record,plan,canReturn:detail.canReturn});
        const items={captures:detail.captures,returns:detail.returns,rollbacks:detail.rollbacks,files:detail.files,
          receivedPackets:detail.record.receivedPackets??[],decisions:detail.plan.decisions??[],dateEvidence:detail.plan.dateEvidence??[]}[view];
        return this.result({planId:args.planId,record,canReturn:detail.canReturn,page:page(items,args,view)});
      }
      case 'rows':return this.result({planId:args.planId,...(args.captureId?{captureId:args.captureId}:{}),
        ...(args.captureId?await this.controller.captureRows(args.planId,args.captureId,args):await this.controller.rows(args.planId,args))});
      case 'capture':return this.result({planId:args.planId,...await this.controller.captureDetail(args.planId,args.captureId)});
      case 'return':return this.result({planId:args.planId,...await this.controller.returnDetail(args.planId,args.returnId)});
      case 'rollback':return this.result({planId:args.planId,...await this.controller.rollback(args.planId,args.request)});
      case 'rollback_record':{
        const record=(this.workspace.state.cryptoworthRollbacks??[]).find(row=>row.id===args.rollbackId);
        need(record,'CRYPTOWORTH_ROLLBACK_NOT_FOUND','Choose a retained native import-unit rollback.');
        return this.result({record:copy(record)});
      }
      case 'packet_inspect':{
        const {request,references}=await this.expand('packet',args),result=await this.controller.inspectPacket(request);
        return this.result({...result,file:references[0]});
      }
      case 'packet_receive':{
        const {request,references}=await this.expand('packet',args,{pinned:true});
        const inspected=await this.controller.inspectPacket(request);
        need(inspected.sha256===args.expectedSha256&&inspected.packetSha256===args.expectedPacketSha256,
          'CRYPTOWORTH_PACKET_CHANGED','Receive the exact reviewed native input and sealed packet hashes.');
        return this.result({...await this.controller.receivePacket(request),file:references[0]});
      }
      default:throw fail('CRYPTOWORTH_TOOL_NOT_FOUND','Choose an original Cryptoworth accounting operation.');
    }
  }
}
