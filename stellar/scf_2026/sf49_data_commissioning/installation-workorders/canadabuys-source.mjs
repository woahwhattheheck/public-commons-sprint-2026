// MIT. Complete original CanadaBuys Workshares for native Grant commissioning.
import {openSync, closeSync, fstatSync, lstatSync, readFileSync, writeFileSync,
  mkdirSync, mkdtempSync, rmSync, realpathSync, fsyncSync, linkSync, unlinkSync, constants} from 'node:fs';
import {dirname, join, resolve, basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CanadaBuysWorkspace} from '../../../scf-starforge-20261009/sf30-seller-sdk/canadabuys/workspace.mjs';
import {canonical, sha256, PACKAGE_SCHEMA} from '../../../scf-starforge-20261009/sf30-seller-sdk/canadabuys/core.mjs';

export const NATIVE_SELECTION_SCHEMA='stellar-forge.canadabuys-workshare-selection.v1';
export const NATIVE_SOURCE_SCHEMA='stellar-forge.canadabuys-workshare-source.v1';
const MAX_FILE=8*1024*1024;
const HASH=/^[a-f0-9]{64}$/;
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function need(condition,message){if(!condition)throw new Error(message);}
function keys(value,required,optional,label){
  need(record(value)&&required.every(key=>own(value,key))&&
    Object.keys(value).every(key=>[...required,...optional].includes(key)),label+' needs its complete declared fields.');
}
function text(value,label,maximum=4000){
  need(typeof value==='string'&&value.trim()&&value.length<=maximum,label+' must be explicit nonempty text.');
  return value;
}
function safeInteger(value,label,min=0){
  need(Number.isSafeInteger(value)&&value>=min,label+' must be a safe integer of at least '+min+'.');return value;
}
function decimal(value,label){
  // Compare the operator's decimal allocation with the exact JSON number retained
  // by the original model, without currency conversion or binary floating sums.
  const input=typeof value==='number'?String(value):value;
  need(typeof input==='string'&&/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$/i.test(input)&&input.length<=80,
    label+' must be a complete nonnegative finite decimal.');
  const [mantissa,exponent='0']=input.toLowerCase().split('e'), [whole,fraction='']=mantissa.split('.');
  const exp=Number(exponent);
  need(Number.isSafeInteger(exp)&&Math.abs(exp)<=40,label+' has an unsupported decimal scale.');
  let coefficient=BigInt(whole+fraction),scale=fraction.length-exp;
  if(scale<0){coefficient*=10n**BigInt(-scale);scale=0;}
  while(scale>0&&coefficient%10n===0n){coefficient/=10n;scale--;}
  return {coefficient,scale};
}
function decimalText(value){
  const digits=value.coefficient.toString();
  return value.scale===0?digits:
    (digits.length<=value.scale?'0.'+'0'.repeat(value.scale-digits.length)+digits:
      digits.slice(0,-value.scale)+'.'+digits.slice(-value.scale));
}
function exactTotal(values,expected,label){
  const normalized=decimal(expected,label),scale=Math.max(normalized.scale,...values.map(value=>value.scale));
  need(values.reduce((sum,value)=>sum+value.coefficient*10n**BigInt(scale-value.scale),0n)===
    normalized.coefficient*10n**BigInt(scale-normalized.scale),label+' allocations must equal the original complete Workshare amount.');
}
function stableFile(path,maximum=MAX_FILE){
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=fstatSync(fd);
    need(before.isFile()&&before.size<=maximum,'Use a complete regular source within the native receiving bound: '+path);
    const bytes=readFileSync(fd),after=fstatSync(fd),named=lstatSync(path);
    need(bytes.length===before.size&&['dev','ino','size','mtimeMs','ctimeMs'].every(key=>before[key]===after[key])&&
      named.dev===after.dev&&named.ino===after.ino,'Original source changed while being read: '+path);
    return bytes;
  }finally{closeSync(fd);}
}
function parseJson(bytes,label){
  // Native JSON is retained byte for byte, while the original reader validates
  // its complete object. Duplicate-member ambiguity is rejected before parsing.
  const source=bytes.toString('utf8');
  need(Buffer.from(source,'utf8').equals(bytes),label+' must be complete UTF-8.');
  let offset=0;
  const whitespace=()=>{while(/\s/.test(source[offset]||'')&&offset<source.length)offset++;};
  function string(){
    const start=offset;need(source[offset++]==='"',label+' contains an invalid JSON string.');
    while(offset<source.length){
      const c=source[offset++];
      if(c==='"')return JSON.parse(source.slice(start,offset));
      if(c==='\\')offset++;
    }
    throw new Error(label+' contains an incomplete JSON string.');
  }
  function value(){
    whitespace();
    if(source[offset]==='{'){
      offset++;whitespace();const names=new Set();
      if(source[offset]==='}'){offset++;return;}
      while(true){
        whitespace();const name=string();
        need(!names.has(name),label+' repeats JSON member '+name+'.');names.add(name);
        whitespace();need(source[offset++]===':',label+' contains an invalid JSON object.');value();whitespace();
        if(source[offset]==='}'){offset++;return;}
        need(source[offset++]===',',label+' contains an invalid JSON object.');
      }
    }else if(source[offset]==='['){
      offset++;whitespace();if(source[offset]===']'){offset++;return;}
      while(true){value();whitespace();if(source[offset]===']'){offset++;return;}
        need(source[offset++]===',',label+' contains an invalid JSON array.');}
    }else if(source[offset]==='"'){string();}
    else{
      const match=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(source.slice(offset));
      need(match,label+' contains an invalid JSON value.');offset+=match[0].length;
    }
  }
  value();whitespace();need(offset===source.length,label+' contains trailing JSON bytes.');
  const result=JSON.parse(source);need(record(result),label+' must be an object.');return result;
}
function syncDirectory(path){
  const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{fsyncSync(fd);}finally{closeSync(fd);}
}
function privateDirectory(path){
  mkdirSync(path,{recursive:true,mode:0o700});
  const status=lstatSync(path);
  need(status.isDirectory()&&!status.isSymbolicLink()&&!(status.mode&0o077)&&realpathSync(path)===path,
    'Use a private original output directory without symbolic-link ancestors.');
  syncDirectory(path);syncDirectory(dirname(path));
}
function retain(path,bytes){
  const expected={filename:basename(path),bytes:bytes.length,sha256:sha256(bytes)};
  try{
    const raw=stableFile(path);
    need(raw.equals(bytes),'The retained original output differs: '+path);
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{fsyncSync(fd);}finally{closeSync(fd);}
    syncDirectory(dirname(path));return expected;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=path+'.'+randomUUID()+'.tmp',fd=openSync(temporary,'wx',0o600);
  try{
    writeFileSync(fd,bytes);fsyncSync(fd);
    try{linkSync(temporary,path);}catch(error){
      if(error.code!=='EEXIST')throw error;
      need(stableFile(path).equals(bytes),'A concurrent original preparation selected different bytes.');
    }
    syncDirectory(dirname(path));
  }finally{closeSync(fd);unlinkSync(temporary);syncDirectory(dirname(path));}
  return expected;
}
const encoded=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
function fileDescriptor(bytes,filename){return {filename,bytes:bytes.length,sha256:sha256(bytes)};}

export function nativeWorkshareSelectionTemplate(packet){
  need(record(packet)&&packet.schema===PACKAGE_SCHEMA&&Array.isArray(packet.workshares),
    'Select the complete original v2 CanadaBuys package.');
  return {
    schema:NATIVE_SELECTION_SCHEMA,operationId:null,requestPrefix:null,receivingName:null,
    sourceUrl:null,observedAt:null,
    package:{filename:null,bytes:null,sha256:null,packageId:packet.packageId,
      workspaceId:packet.workspace?.id,workspaceRevision:packet.workspace?.revision},
    workshares:packet.workshares.map(workshare=>({
      workshareId:workshare.id,revision:workshare.revision,workshareSha256:sha256(canonical(
        Object.fromEntries(Object.entries(workshare).filter(([key])=>key!=='history')))),
      profile:'canadabuys-bidder-desk',mappingNote:null,
      parties:{customer:null,supplier:null,basis:null},
      schedule:{businessDays:null,basis:null,startConditions:[]},
      phases:workshare.milestones.map(milestone=>({
        id:milestone.id,title:milestone.title,milestoneIds:[milestone.id],
        productionHours:null,partnerHours:null,businessDays:null,owner:null,dependsOn:[],
        deliverables:null,acceptance:milestone.acceptance,inputs:null
      }))
    }))
  };
}
function allocations(selected,workshare){
  keys(selected,['workshareId','revision','workshareSha256','profile','mappingNote','parties','schedule','phases'],['bindings'],'Workshare selection');
  need(selected.workshareId===workshare.id&&selected.revision===workshare.revision&&
    HASH.test(selected.workshareSha256)&&selected.workshareSha256===sha256(canonical(workshare)),
    'Select the exact original complete Workshare edition.');
  need(selected.profile==='canadabuys-bidder-desk','Use the maintained CanadaBuys Installation profile.');
  text(selected.mappingNote,'Phase mapping note');
  keys(selected.parties,['customer','supplier','basis'],[],'Original party mapping');
  for(const name of ['customer','supplier','basis'])text(selected.parties[name],'Explicit party '+name,name==='basis'?4000:1000);
  keys(selected.schedule,['businessDays','basis','startConditions'],[],'Explicit working-day selection');
  safeInteger(selected.schedule.businessDays,'Selected working days',1);
  need(selected.schedule.businessDays<=1000000,'Selected duration exceeds the original native range.');
  text(selected.schedule.basis,'Original delivery-day interpretation');
  need(Array.isArray(selected.schedule.startConditions)&&selected.schedule.startConditions.length<=100,
    'Retain the explicit commencement conditions.');
  for(const condition of selected.schedule.startConditions)text(condition,'Commencement condition');
  need(Array.isArray(selected.phases)&&selected.phases.length>0&&selected.phases.length<=100,
    'Select one to one hundred explicitly authored delivery phases.');
  need(Array.isArray(workshare.milestones)&&workshare.milestones.length>0,
    'Retain explicit milestone amounts in the original Workshare before commissioning.');
  const milestones=new Map(workshare.milestones.map(row=>[row.id,row]));
  const ids=new Set(),used=new Set();
  const phases=selected.phases.map(phase=>{
    keys(phase,['id','title','milestoneIds','productionHours','partnerHours','businessDays','owner','dependsOn',
      'deliverables','acceptance','inputs'],[],'Delivery phase');
    text(phase.id,'Phase ID',200);text(phase.title,'Phase title',1000);
    need(!ids.has(phase.id),'Every delivery phase needs a distinct ID.');ids.add(phase.id);
    safeInteger(phase.businessDays,'Phase working days',1);
    need(phase.businessDays<=selected.schedule.businessDays,'A phase exceeds the explicitly selected project working days.');
    text(phase.owner,'Original delivery owner',500);text(phase.deliverables,'Phase deliverables');
    text(phase.acceptance,'Phase acceptance');text(phase.inputs,'Phase inputs');
    need(Array.isArray(phase.milestoneIds)&&phase.milestoneIds.length>0,
      'Each delivery phase must select original Workshare milestones.');
    let cents=0;
    const sourceMilestones=phase.milestoneIds.map(id=>{
      need(typeof id==='string'&&milestones.has(id)&&!used.has(id),
        'Map each original milestone exactly once.');used.add(id);
      const item=milestones.get(id);cents+=safeInteger(item.amountCents,'Original milestone cents');
      need(Number.isSafeInteger(cents),'Original milestone cents exceed the exact native range.');return item;
    });
    need(Array.isArray(phase.dependsOn)&&new Set(phase.dependsOn).size===phase.dependsOn.length&&
      phase.dependsOn.every(id=>typeof id==='string'&&id!==phase.id),'Select distinct original phase dependencies.');
    need(typeof phase.productionHours==='string'&&typeof phase.partnerHours==='string',
      'Select production and partner hours as exact decimal strings.');
    return {...phase,productionHours:decimalText(decimal(phase.productionHours,'Production hours')),
      partnerHours:decimalText(decimal(phase.partnerHours,'Partner hours')),amountCents:cents,
      currency:workshare.currency,milestones:sourceMilestones};
  });
  need(used.size===milestones.size,'Retain every original milestone in the complete delivery allocation.');
  const phaseFees=phases.reduce((sum,phase)=>sum+BigInt(phase.amountCents),0n);
  need(phaseFees===BigInt(safeInteger(workshare.feeCents,'Original fee cents')),
    'Complete original milestone amounts must equal the original quoted fee before commissioning.');
  exactTotal(phases.map(phase=>decimal(phase.productionHours,'Production hours')),workshare.estimatedHours,'Production effort');
  exactTotal(phases.map(phase=>decimal(phase.partnerHours,'Partner hours')),workshare.partnerHours,'Partner effort');
  const visited=new Set(),visiting=new Set(),elapsed=new Map(),byId=new Map(phases.map(phase=>[phase.id,phase]));
  function visit(id){
    need(ids.has(id),'A delivery dependency names an unselected phase: '+id);
    need(!visiting.has(id),'Delivery phase dependencies contain a cycle.');
    if(visited.has(id))return;
    visiting.add(id);for(const dependency of byId.get(id).dependsOn)visit(dependency);
    elapsed.set(id,Math.max(0,...byId.get(id).dependsOn.map(parent=>elapsed.get(parent)))+byId.get(id).businessDays);
    need(elapsed.get(id)<=selected.schedule.businessDays,'The explicit phase critical path exceeds the selected working-day duration.');
    visiting.delete(id);visited.add(id);
  }
  for(const id of ids)visit(id);
  if(own(selected,'bindings'))need(record(selected.bindings),'Use complete explicit Installation bindings.');
  return phases;
}

export function prepareNativeWorkshareSource({selectionPath,packagePath,outputDirectory}){
  const selectedBytes=stableFile(resolve(selectionPath)),selected=parseJson(selectedBytes,'Native Workshare selection');
  keys(selected,['schema','operationId','requestPrefix','receivingName','sourceUrl','observedAt','package','workshares'],[],'Native source selection');
  need(selected.schema===NATIVE_SELECTION_SCHEMA,'Select the original native Workshare selection schema.');
  for(const name of ['operationId','requestPrefix'])need(typeof selected[name]==='string'&&/^[A-Za-z0-9_-]{1,70}$/.test(selected[name]),
    'Retain the original '+name+'.');
  text(selected.receivingName,'Receiving name',300);text(selected.sourceUrl,'Original source URL',8192);
  need(typeof selected.observedAt==='string'&&Number.isFinite(Date.parse(selected.observedAt))&&
    /[Tt].*(?:[Zz]|[+-][0-9]{2}:[0-9]{2})$/.test(selected.observedAt),'Retain the actual source observation and timezone.');
  keys(selected.package,['filename','bytes','sha256','packageId','workspaceId','workspaceRevision'],[],'Original package binding');
  need(typeof selected.package.filename==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(selected.package.filename)&&
    !['SOURCE_SELECTION.json','CANADABUYS_NATIVE_WORKSHARES.json','SUPPLIER_RECEIVING.json','SOURCE_PREPARATION.json','selection-template.json'].includes(selected.package.filename),
    'Use an original source package filename distinct from the preparation outputs.');
  const packageBytes=stableFile(resolve(packagePath)),packet=parseJson(packageBytes,'Original CanadaBuys package');
  need(selected.package.bytes===packageBytes.length&&HASH.test(selected.package.sha256)&&
    selected.package.sha256===sha256(packageBytes)&&packet.packageId===selected.package.packageId&&
    packet.schema===PACKAGE_SCHEMA&&packet.workspace?.id===selected.package.workspaceId&&
    packet.workspace?.revision===selected.package.workspaceRevision,
    'The complete original package or native workspace selection differs.');
  safeInteger(selected.package.workspaceRevision,'Source workspace revision');
  need(Array.isArray(selected.workshares)&&selected.workshares.length>0&&selected.workshares.length<=20,
    'Select one to twenty original native Workshares.');
  const output=resolve(outputDirectory);privateDirectory(output);
  // The full request and original bytes precede any derived publication.
  retain(join(output,'SOURCE_SELECTION.json'),selectedBytes);
  retain(join(output,selected.package.filename),packageBytes);
  const validationDirectory=mkdtempSync(join(output,'.native-validation-'));
  let workspace;
  try{
    workspace=new CanadaBuysWorkspace(validationDirectory,{operator:'native-source-validation'});
    const receiving=workspace.receivePackage(packet,{expectedRevision:workspace.metadata().revision});
    need(receiving.receiving?.packageId===packet.packageId,'The original native receiver selected another package.');
    const ids=new Set(),rows=selected.workshares.map(selection=>{
      need(record(selection)&&typeof selection.workshareId==='string'&&!ids.has(selection.workshareId),
        'Select each original Workshare once.');ids.add(selection.workshareId);
      const original=workspace.getWorkshare(selection.workshareId);
      const edition=original.history.find(row=>row.revision===selection.revision);
      need(edition,'The selected original Workshare revision is not in its complete retained history.');
      const phases=allocations(selection,edition),sourceEntry=workspace.getEntry(edition.sourceContext.entryId);
      need(sourceEntry.sourceId===edition.sourceContext.sourceId&&sourceEntry.rowSha256===edition.sourceContext.rowSha256&&
        sourceEntry.noticeId===edition.noticeId,'The native Workshare source edition differs.');
      return {
        workshareId:edition.id,selectedRevision:edition.revision,workshareSha256:sha256(canonical(edition)),
        nativeHead:original,selectedEdition:edition,selectedEditionCanonical:canonical(edition),sourceEntry,phases,
        parties:selection.parties,schedule:selection.schedule,
        profile:selection.profile,mappingNote:selection.mappingNote,
        ...(own(selection,'bindings')?{bindings:selection.bindings}:{})
      };
    });
    const result={
      schema:NATIVE_SOURCE_SCHEMA,operationId:selected.operationId,requestPrefix:selected.requestPrefix,
      receivingName:selected.receivingName,sourceUrl:selected.sourceUrl,observedAt:selected.observedAt,
      selection:fileDescriptor(selectedBytes,'SOURCE_SELECTION.json'),selectionBodyBase64:selectedBytes.toString('base64'),
      originalPackage:{...fileDescriptor(packageBytes,selected.package.filename),packageId:packet.packageId,
        workspace:packet.workspace,schema:packet.schema},
      nativeValidation:{method:'CanadaBuysWorkspace.receivePackage',packageId:packet.packageId,
        fullOriginalSourceAndWorkshareHistory:true},
      workshares:rows
    };
    const bytes=encoded(result);
    need(bytes.length<=MAX_FILE,'The complete native Workshare preparation exceeds the original receiver limit.');
    return {...result,output:retain(join(output,'CANADABUYS_NATIVE_WORKSHARES.json'),bytes)};
  }finally{if(workspace)workspace.close();rmSync(validationDirectory,{recursive:true,force:true});syncDirectory(output);}
}

export function nativeTemplateFromFile(packagePath){
  const bytes=stableFile(resolve(packagePath)),packet=parseJson(bytes,'Original CanadaBuys package');
  const result=nativeWorkshareSelectionTemplate(packet);
  result.package={...result.package,...fileDescriptor(bytes,basename(packagePath))};
  return result;
}

export function retainNativeSelectionTemplate(packagePath,outputDirectory){
  const output=resolve(outputDirectory);privateDirectory(output);
  const value=nativeTemplateFromFile(packagePath);
  return retain(join(output,'selection-template.json'),encoded(value));
}
