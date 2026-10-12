// MIT. Xero document handovers share the original accounting lease and request log.
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,mkdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {accountingWorkspaceBinding} from '../../workspace/binding.mjs';
import {json,sha,need,plain,field,identifier,dateValue,today,customerExport,currencyKey} from '../core.mjs';
import {XERO_SCHEMA,XERO_PACKAGE_SCHEMA,XERO_RESULT_SCHEMA,XERO_PACKAGE_BYTES,XERO_MAX_DOCUMENTS,
  normalizeXeroProfile,publicXeroProfile,compileXeroPackage,readXeroResults,xeroFileDescriptor,xeroInstant} from './domain.mjs';

const at=()=>new Date().toISOString();
const clone=value=>structuredClone(value);
const orgKey=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX=/^[0-9a-f]{64}$/;
const MIME='application/json; charset=utf-8';
const sourceKey=row=>row.documentId+':'+row.sourceSha256;
function packetFile(name,bytes,role,type=MIME){return {name,bytes:Buffer.from(bytes),role,type};}
function filename(value) {
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)&&value!=='.'&&value!=='..',
    'INVALID_XERO_FILE_NAME','Choose one retained Xero handover file.');return value;
}
function parsed(bytes,name) {
  try{return JSON.parse(bytes.toString('utf8'));}
  catch{need(false,'INVALID_XERO_RETAINED_JSON','The retained '+name+' is not valid JSON.',409);}
}
async function syncDirectory(path) {
  const handle=await open(path,constants.O_RDONLY|(constants.O_DIRECTORY??0)|(constants.O_NOFOLLOW??0));
  try{await handle.sync();}finally{await handle.close();}
}
async function verified(path,descriptor) {
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const stat=await handle.stat();
    need(stat.isFile()&&stat.size===descriptor.bytes&&stat.size<=XERO_PACKAGE_BYTES,
      'XERO_RETAINED_FILE_CHANGED','The retained Xero file size or type changed.',409);
    const bytes=await handle.readFile();
    need(bytes.length===descriptor.bytes&&sha(bytes)===descriptor.sha256,'XERO_RETAINED_FILE_CHANGED',
      'The retained Xero file differs from its saved original bytes.',409);
    return bytes;
  }finally{await handle.close();}
}
function compactNative(value) {
  if(!value)return undefined;
  const envelope=Object.fromEntries(Object.entries(value.envelope??{})
    .filter(([,item])=>item===null||['string','boolean','number'].includes(typeof item)));
  return {schema:value.schema,sourceKind:value.sourceKind,collections:value.collections,envelope,
    documentCount:value.documentCount,consideredCount:value.consideredCount,
    excludedDocumentCount:value.excludedDocuments?.length??0,numericTokenCount:value.numericTokens?.length??Object.keys(value.numericTokens??{}).length,
    numberEncoding:value.numberEncoding,monetaryConvention:value.monetaryConvention,
    documents:(value.documents??[]).map(row=>({collection:row.collection,index:row.index,pointer:row.pointer,
      kind:row.kind,type:row.type,number:row.number,id:row.id,status:row.status,currency:row.currency,
      amounts:row.amounts,canonicalAmounts:row.canonicalAmounts,providerRejected:row.providerRejected,
      validationPointers:row.validationPointers,fields:row.fields,lineItemsPresent:row.lineItemsPresent,
      lineItemCount:row.lineItems?.length??0,issues:row.issues,excludedReason:row.excludedReason}))};
}
function selectIds(value) {
  need(Array.isArray(value)&&value.length>0&&value.length<=XERO_MAX_DOCUMENTS,
    'XERO_DOCUMENT_SELECTION','Choose between one and '+XERO_MAX_DOCUMENTS+' original issued documents.');
  const ids=value.map(id=>identifier(id,'issued invoice or credit note'));
  need(new Set(ids).size===ids.length,'DUPLICATE_XERO_DOCUMENT','Select each original document once.');
  return ids;
}

export class XeroReceivablesWorkspace {
  constructor(receivables) {
    need(receivables&&typeof receivables._mutate==='function'&&receivables.workspace,
      'XERO_RECEIVABLES_OWNER_REQUIRED','Use the original initialized receivables controller.');
    this.receivables=receivables;
    this.workspace=receivables.workspace;
  }
  data() {
    this.workspace.lease.assertHeld();
    const value=this.receivables.data().xero;
    need(value?.schema===XERO_SCHEMA&&['profiles','packages','imports'].every(key=>Array.isArray(value[key])),
      'INVALID_XERO_WORKSPACE','Open the initialized Xero receivables extension.',409);
    return value;
  }
  async init() {
    return this.workspace.serial(async()=>{
      const data=this.receivables.data();
      if(data.xero===undefined) {
        data.xero={schema:XERO_SCHEMA,profiles:[],packages:[],imports:[]};
        await this.workspace.commit('receivables_xero_initialized','workspace startup');
      }
      this.data();return this;
    });
  }
  _profile(id,version) {
    identifier(id,'Xero profile');
    const matches=this.data().profiles.filter(row=>row.profile.id===id);
    const record=version===undefined?matches.at(-1):matches.find(row=>row.profile.version===version);
    need(record,'XERO_PROFILE_NOT_FOUND','Choose a retained Xero profile version.',404);
    return record;
  }
  _package(id) {
    identifier(id,'Xero package');const record=this.data().packages.find(row=>row.id===id);
    need(record,'XERO_PACKAGE_NOT_FOUND','Choose a prepared Xero document package.',404);return record;
  }
  async _retainedFile(record,name) {
    filename(name);
    const descriptor=record.files.find(row=>row.name===name);
    need(descriptor,'XERO_FILE_NOT_FOUND','Choose a file from this retained package.',404);
    const root=join(this.workspace.directory,'exports');
    const parent=await lstat(root);
    need(parent.isDirectory()&&!parent.isSymbolicLink(),'XERO_EXPORT_DIRECTORY_CHANGED',
      'The original accounting export directory changed.',409);
    const directory=join(root,identifier(record.directoryId,'retained Xero export'));
    const stat=await lstat(directory);
    need(stat.isDirectory()&&!stat.isSymbolicLink(),'XERO_EXPORT_DIRECTORY_CHANGED',
      'The retained Xero export directory changed.',409);
    return {name,type:descriptor.type,role:descriptor.role,bytes:await verified(join(directory,name),descriptor),
      ...(descriptor.documentIds?{documentIds:clone(descriptor.documentIds),rowCount:descriptor.rowCount}:{})};
  }
  async _retain(files) {
    need(Array.isArray(files)&&files.length>0,'EMPTY_XERO_PACKAGE','Retain the complete original handover files.');
    const names=new Set();let total=0;
    for(const item of files) {
      filename(item.name);
      need(Buffer.isBuffer(item.bytes)&&!names.has(item.name),'XERO_FILE_COLLISION',
        'Every original handover file needs a unique name and complete bytes.',409);
      names.add(item.name);total+=item.bytes.length;
      need(total<=XERO_PACKAGE_BYTES,'XERO_PACKAGE_LIMIT','The complete handover exceeds 128 MiB. Select fewer documents.');
    }
    const root=join(this.workspace.directory,'exports'),parent=await lstat(root);
    need(parent.isDirectory()&&!parent.isSymbolicLink(),'XERO_EXPORT_DIRECTORY_CHANGED',
      'The original accounting export directory changed.',409);
    const directoryId=randomUUID(),directory=join(root,directoryId);
    await mkdir(directory,{mode:0o700});
    for(const item of files) {
      const handle=await open(join(directory,item.name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
      try{await handle.writeFile(item.bytes);await handle.sync();}finally{await handle.close();}
    }
    await syncDirectory(directory);await syncDirectory(root);
    return {directoryId,files:files.map(xeroFileDescriptor)};
  }
  _receivingIndex() {
    const index=new Map(),holders=new Map(),owners=new Map();
    const entry=(organisationKey,documentId,sourceSha256)=>{
      const key=JSON.stringify([organisationKey,documentId,sourceSha256]);
      if(!index.has(key))index.set(key,{key,organisationKey,externalStates:new Map(),latest:null,binding:null,latestPackage:null});
      return index.get(key);
    };
    const externalKey=(organisationKey,id)=>JSON.stringify([organisationKey,id]);
    for(const record of this.data().packages)for(const document of record.documents)
      entry(record.organisationKey,document.id,document.sourceSha256).latestPackage=record;
    for(const record of this.data().imports)for(const row of record.rows) {
      const item=entry(record.organisationKey,row.documentId,row.sourceSha256);
      item.latest={record,row};
      const events=row.externalRecords??(record.importedStatusValues.includes(row.externalStatus)&&UUID.test(row.externalDocumentId??'')?
        [{externalDocumentId:row.externalDocumentId,externalStatus:row.externalStatus,kind:'ACCEPTED',
          outcome:row.status,error:row.error,rowNumbers:row.rowNumbers,sourcePointers:row.sourcePointers??[]}]:[]);
      for(const event of events) {
        const id=event.externalDocumentId,key=externalKey(record.organisationKey,id);
        if(!holders.has(key))holders.set(key,new Set());
        holders.get(key).add(item);
        const received={...event,record,row,active:event.kind!=='RETIRED'};
        if(event.kind==='RETIRED') {
          // One physical Xero document retirement applies to every earlier source claim on that ID.
          for(const holder of holders.get(key))holder.externalStates.set(id,{...holder.externalStates.get(id),...received,active:false});
        } else item.externalStates.set(id,received);
      }
    }
    for(const item of index.values())for(const [id,event] of item.externalStates)if(event.active) {
      const key=externalKey(item.organisationKey,id);
      if(!owners.has(key))owners.set(key,new Set());
      owners.get(key).add(item.key);
    }
    for(const item of index.values()) {
      item.active=[...item.externalStates.values()].filter(event=>event.active);
      item.collisionIds=item.active.filter(event=>owners.get(externalKey(item.organisationKey,event.externalDocumentId)).size>1)
        .map(event=>event.externalDocumentId);
      if(item.active.length===1&&item.collisionIds.length===0&&item.active[0].outcome==='IMPORTED') {
        const event=item.active[0];
        item.binding={externalDocumentId:event.externalDocumentId,externalStatus:event.externalStatus,
          importId:event.record.id,packageId:event.record.packageId,fileName:event.record.fileName,
          receivedAt:event.record.receivedAt,recordedAt:event.record.recordedAt};
      }
    }
    return index;
  }
  _indexed(index,organisation,document) {
    return index.get(JSON.stringify([orgKey(organisation),document.id,document.sourceSha256]))??
      {externalStates:new Map(),active:[],collisionIds:[],latest:null,binding:null,latestPackage:null};
  }
  _resolution(record,document,index=this._receivingIndex()) {
    const item=this._indexed(index,record.organisation,document),latest=item.latest,latestPackage=item.latestPackage;
    const active=item.active,event=active.length===1?active[0]:null;
    let status=latest?.row.status??'UNRESOLVED',message=latest?.row.error??'Awaiting the original Xero result file.';
    if(active.length>1) {
      status='CONFLICT';message='Multiple active Xero IDs refer to this original. Retain the intended document, retire the duplicates in Xero, and receive the original updated records.';
    } else if(item.collisionIds.length) {
      status='CONFLICT';message='An active Xero ID also belongs to another original document. Correct the document records in Xero and receive their original updated results.';
    } else if(event) {
      status=event.outcome==='IMPORTED'?'IMPORTED':'MISMATCH';
      message=status==='IMPORTED'?'Original Xero ID, currency, net, tax and total match the issued document.':event.error;
      if(latest?.row.status==='CONFLICT'||(latest?.row.externalRecords?.length===0&&latest.row.status!=='IMPORTED')) {
        status='CONFLICT';message=latest.row.error||'The latest original result contradicts the active Xero document.';
      }
    } else if(item.externalStates.size&&[...item.externalStates.values()].every(row=>!row.active)) {
      status='REJECTED';message='The original Xero results retire every previously accepted document ID. A replacement can use this issued source.';
    }
    const voidedNumber=[...item.externalStates.values()].some(row=>!row.active&&row.externalStatus==='VOIDED');
    if(active.length===0&&voidedNumber)
      message='This number remains on a voided Xero document. Create and issue a linked replacement invoice in Receivables, then prepare its new number.';
    const canCorrect=active.length===0&&!voidedNumber&&['UNRESOLVED','REJECTED'].includes(status)&&
      (!latestPackage||latestPackage.id===record.id);
    if(latestPackage&&latestPackage.id!==record.id&&status==='UNRESOLVED')
      message='Continue in successor package '+latestPackage.id+'.';
    const selected=event??latest?.row,selectedImport=event?.record??latest?.record;
    return {documentId:document.id,documentNumber:document.number,sourceSha256:document.sourceSha256,status,message,canCorrect,
      externalDocumentId:event?.externalDocumentId??latest?.row.externalDocumentId??null,
      externalDocumentIds:[...item.externalStates.keys()],activeExternalDocumentIds:active.map(row=>row.externalDocumentId),
      externalStatus:selected?.externalStatus??null,importId:selectedImport?.id??null,
      packageId:selectedImport?.packageId??latestPackage?.id??record.id,latestPackageId:latestPackage?.id??record.id,
      fileName:selectedImport?.fileName??null,sourceRowNumbers:clone(selected?.rowNumbers??[]),
      sourcePointers:clone(selected?.sourcePointers??[]),imported:!!item.binding};
  }
  _summary(record,index=this._receivingIndex()) {
    const resolutions=record.documents.map(doc=>this._resolution(record,doc,index));
    const resolvedCount=resolutions.filter(row=>row.status==='IMPORTED').length;
    const state=resolvedCount===record.documents.length?'RECEIVED':resolutions.some(row=>row.status!=='UNRESOLVED')?'PARTIAL':'PREPARED';
    return {id:record.id,title:record.title,createdAt:record.createdAt,actor:record.actor,profileId:record.selection.profileId,
      profileVersion:record.selection.profileVersion,organisation:record.organisation,asOf:record.selection.asOf,
      parentId:record.selection.parentId??null,documentCount:record.documents.length,state,resolvedCount,
      unresolvedCount:record.documents.length-resolvedCount,correctableCount:resolutions.filter(row=>row.canCorrect).length,
      totals:clone(record.totals)};
  }
  _relatedImports(record,index=this._receivingIndex()) {
    const keys=new Set(record.documents.map(row=>sourceKey({documentId:row.id,sourceSha256:row.sourceSha256})));
    const externalIds=new Set(record.documents.flatMap(doc=>[...this._indexed(index,record.organisation,doc).externalStates.keys()]));
    return this.data().imports.filter(item=>item.organisationKey===record.organisationKey&&
      item.rows.some(row=>keys.has(sourceKey(row))||(row.externalRecords??[]).some(event=>externalIds.has(event.externalDocumentId))));
  }
  _detail(record,index=this._receivingIndex()) {
    const keys=new Set(record.documents.map(row=>sourceKey({documentId:row.id,sourceSha256:row.sourceSha256})));
    const imports=this._relatedImports(record,index)
      .map(item=>{const value=clone(item);delete value.directoryId;delete value.files;return value;});
    const family=this.data().packages.filter(item=>item.organisationKey===record.organisationKey&&
      item.documents.some(row=>keys.has(sourceKey({documentId:row.id,sourceSha256:row.sourceSha256}))))
      .map(item=>this._summary(item,index));
    return {...this._summary(record,index),schema:XERO_PACKAGE_SCHEMA,selection:clone(record.selection),
      documents:clone(record.documents),files:clone(record.files),profile:clone(record.profile),
      sourceFingerprint:record.sourceFingerprint,previewSha256:record.previewSha256,
      imports,resolutions:record.documents.map(doc=>this._resolution(record,doc,index)),history:clone(record.history),family};
  }
  async state(query={}) {
    return this.workspace.serial(async()=>{
      const asOf=dateValue(query.asOf??today(),'account date'),original=this.receivables._view(asOf);
      const binding=accountingWorkspaceBinding(this.workspace.directory,this.workspace.state);
      const current=new Map(this.data().profiles.map(record=>[record.profile.id,record.profile])),index=this._receivingIndex();
      return {schema:XERO_SCHEMA,revision:this.workspace.state.revision,asOf,workspaceId:binding.workspaceId,
        sourcesSha256:binding.sourcesSha256,profiles:[...current.values()].map(publicXeroProfile),
        packages:this.data().packages.map(record=>this._summary(record,index)).reverse(),
        customers:original.customers,invoices:original.invoices,credits:original.credits};
    });
  }
  async saveProfile(value) {
    const result=await this.receivables._mutate('xero_profile_saved',value,async(_data,actor)=>{
      const previous=value.id?this._profile(value.id):null;
      if(previous)need(value.expectedVersion===previous.profile.version,'STALE_XERO_PROFILE',
        'Reload the current Xero profile before saving its next version.',409);
      const id=previous?.profile.id??randomUUID(),version=(previous?.profile.version??0)+1;
      const input={...value};
      for(const kind of ['invoice','credit'])if(input[kind+'Template']===undefined&&previous) {
        const retained=await this._retainedFile(previous,kind+'-template.csv');
        input[kind+'Template']={name:previous.profile[kind+'Template'].name,dataBase64:retained.bytes.toString('base64')};
      }
      const normalized=normalizeXeroProfile(input,{id,version});
      for(const contact of normalized.profile.contacts)this.receivables._customer(contact.customerId);
      for(const mapping of normalized.profile.lineMappings) {
        const record=this.receivables.data().invoices.find(row=>row.id===mapping.documentId)??
          this.receivables.data().credits.find(row=>row.id===mapping.documentId);
        const doc=record?.document??record?.draft;
        need(doc?.lines.some(line=>(line.id??line.invoiceLineId)===mapping.lineId),'XERO_MAPPING_SOURCE_NOT_FOUND',
          'Choose an existing original document and line for each mapping override.',409);
      }
      const retained=await this._retain(normalized.files);
      this.data().profiles.push({profile:normalized.profile,...retained,createdAt:at(),actor});
      return {xeroProfileId:id,xeroProfileVersion:version};
    });
    return this.workspace.serial(async()=>({...result,revision:this.workspace.state.revision,
      profile:publicXeroProfile(this._profile(result.operation.result.xeroProfileId,result.operation.result.xeroProfileVersion).profile)}));
  }
  _selection(value,index=this._receivingIndex()) {
    need(plain(value),'INVALID_XERO_SELECTION','Choose a profile, account date and issued documents.');
    const profile=this._profile(value.profileId),parent=value.parentId?this._package(value.parentId):null;
    let documentIds=value.documentIds,asOf=value.asOf??parent?.selection.asOf??today();
    dateValue(asOf,'account date');
    if(parent) {
      need(orgKey(profile.profile.organisation)===parent.organisationKey&&
        currencyKey(profile.profile.currency)===currencyKey(parent.profile.currency),
        'XERO_CORRECTION_ORGANISATION','A correction keeps the original Xero organisation and accounting currency.',409);
      need(asOf===parent.selection.asOf,'XERO_CORRECTION_ACCOUNT_DATE',
        'Use the original package account date for its corrected handover.',409);
      const eligible=parent.documents.filter(doc=>this._resolution(parent,doc,index).canCorrect).map(doc=>doc.id);
      documentIds??=eligible;
      need(Array.isArray(documentIds)&&documentIds.length>0,'XERO_NO_CORRECTION_DOCUMENTS',
        'Open the returned results or current successor package; this package has no documents eligible for another import.',409);
      need(documentIds.every(id=>eligible.includes(id)),'XERO_CORRECTION_DOCUMENT_SELECTION',
        'Correct only this package’s unresolved documents without an accepted Xero ID or a later successor.',409);
    }
    return {profile,selection:{profileId:profile.profile.id,documentIds:selectIds(documentIds),asOf,
      ...(parent?{parentId:parent.id}:{})}};
  }
  async _build(value) {
    const index=this._receivingIndex(),{profile,selection}=this._selection(value,index),data=this.receivables.data(),originals=[],customerIds=new Set();
    for(const id of selection.documentIds) {
      const record=data.invoices.find(row=>row.id===id)??data.credits.find(row=>row.id===id);
      need(record?.document&&record.files,'XERO_ISSUED_DOCUMENT_REQUIRED','Choose issued invoices and credit notes.',409);
      const stem=record.document.kind==='CREDIT_NOTE'?'credit':'invoice';
      const source=await this.receivables._file(id,stem+'.json'),document=parsed(source.bytes,'issued document');
      need(document.id===id&&sha(json(record.document))===sha(source.bytes),'XERO_ISSUED_SOURCE_CHANGED',
        'The saved issued document differs from its retained original JSON.',409);
      const files=[];
      for(const name of Object.keys(record.files)) {
        const item=await this.receivables._file(id,name);
        files.push({name,type:item.type,bytes:item.bytes});
      }
      customerIds.add(document.customer.id);
      const descriptor={id,sourceSha256:sha(source.bytes)};
      const indexed=this._indexed(index,profile.profile.organisation,descriptor),latest=indexed.latestPackage;
      const resolution=latest?this._resolution(latest,descriptor,index):null;
      originals.push({document,files,status:record.status??'ISSUED',sourceSha256:descriptor.sourceSha256,
        previouslyImported:!!indexed.binding,
        preparedElsewhere:latest&&latest.id!==selection.parentId?latest.id:null,
        requiresReturnedCorrection:resolution&&['MISMATCH','CONFLICT'].includes(resolution.status)});
    }
    const accounts=[],additionalFiles=[];
    for(const kind of ['invoice','credit'])additionalFiles.push(await this._retainedFile(profile,kind+'-template.csv'));
    for(const customerId of customerIds) {
      const account=customerExport(data,this.receivables._customer(customerId),selection.asOf);
      accounts.push(account.value);
      for(const item of account.files)additionalFiles.push({...item,name:'customer-'+customerId+'-'+item.name,role:'original-customer-account'});
    }
    const receiptIds=new Set(data.receipts.filter(row=>customerIds.has(row.customerId)&&row.receivedDate<=selection.asOf).map(row=>row.id));
    const snapshot={schema:'stellar-forge.merchant-receivables-xero-account-snapshot.v1',asOf:selection.asOf,accounts,
      receipts:clone(data.receipts.filter(row=>receiptIds.has(row.id))),
      allocations:clone(data.allocations.filter(row=>receiptIds.has(row.receiptId)&&row.allocatedDate<=selection.asOf))};
    return compileXeroPackage(profile.profile,originals,snapshot,selection,additionalFiles);
  }
  async preview(value) {return this.workspace.serial(async()=>({...((await this._build(value)).review),revision:this.workspace.state.revision}));}
  async _prepare(action,value) {
    const result=await this.receivables._mutate(action,value,async(_data,actor)=>{
      need(HEX.test(value.previewSha256??''),'XERO_REVIEW_REQUIRED','Review the complete selected handover before preparation.');
      const built=await this._build(value);
      need(built.review.ready,'XERO_HANDOVER_NOT_READY','Resolve the displayed mapping and document issues before preparation.',409);
      need(built.review.previewSha256===value.previewSha256,'XERO_REVIEW_CHANGED',
        'The selected profile, original files or customer account changed. Review the current handover.',409);
      const id=randomUUID(),createdAt=at(),retained=await this._retain(built.files);
      const record={schema:XERO_PACKAGE_SCHEMA,id,title:field(value.title??(built.review.profile.organisation+' · '+built.review.selection.asOf),'package title',300),
        createdAt,actor,organisation:built.review.profile.organisation,organisationKey:orgKey(built.review.profile.organisation),
        selection:built.review.selection,documents:built.review.documents,profile:built.review.profile,
        totals:built.review.totals,sourceFingerprint:built.review.sourceFingerprint,previewSha256:built.review.previewSha256,
        ...retained,history:[{at:createdAt,actor,action:built.review.selection.parentId?'correction_prepared':'package_prepared',
          parentId:built.review.selection.parentId??null}]};
      this.data().packages.push(record);
      if(record.selection.parentId)this._package(record.selection.parentId).history.push({at:createdAt,actor,action:'successor_prepared',packageId:id,documentIds:record.selection.documentIds});
      return {xeroPackageId:id};
    });
    return this.workspace.serial(async()=>({...result,revision:this.workspace.state.revision,
      package:this._detail(this._package(result.operation.result.xeroPackageId))}));
  }
  async prepare(value) {return this._prepare('xero_package_prepared',value);}
  async correct(id,value) {
    identifier(id,'original Xero package');
    need(value.parentId===undefined||value.parentId===id,'XERO_CORRECTION_PARENT_CHANGED','Use the reviewed original package.',409);
    return this._prepare('xero_package_corrected',{...value,parentId:id});
  }
  async detail(id) {return this.workspace.serial(async()=>({package:this._detail(this._package(id)),revision:this.workspace.state.revision}));}
  async receive(id,value) {
    identifier(id,'Xero package');
    const result=await this.receivables._mutate('xero_result_received',{...value,xeroPackageId:id},async(_data,actor)=>{
      const record=this._package(id);
      need(typeof value.organisation==='string'&&orgKey(value.organisation)===record.organisationKey,
        'XERO_RETURN_ORGANISATION','Select the exact Xero organisation used by this original package.',409);
      const format=value.format??'CSV_SUMMARY';
      need(['CSV_SUMMARY','NATIVE_JSON'].includes(format),'XERO_RETURN_FORMAT','Choose the original native Xero JSON or a mapped document-summary CSV.');
      const original=format==='NATIVE_JSON'?
        await (await import('./native-return.mjs')).readNativeXeroResults(value,record.documents):
        readXeroResults(value,record.documents);
      const importId=randomUUID();
      const receivedAt=xeroInstant(value.receivedAt??at()),recordedAt=at();
      const fileName='result-'+importId+(format==='NATIVE_JSON'?'.json':'.csv'),reportName='result-'+importId+'-mapping.json';
      const report={...original};delete report.bytes;
      const item={...report,id:importId,packageId:id,receivedAt,recordedAt,actor,
        organisation:record.organisation,organisationKey:record.organisationKey,fileName,reportName};
      const retained=await this._retain([packetFile(fileName,original.bytes,'original-xero-result',format==='NATIVE_JSON'?MIME:'text/csv; charset=utf-8'),
        packetFile(reportName,json(item),'xero-result-mapping')]);
      const savedItem={...item,...retained};
      if(item.native)savedItem.native=compactNative(item.native);
      this.data().imports.push(savedItem);
      const resolutionIndex=this._receivingIndex(),resolved=record.documents.map(doc=>this._resolution(record,doc,resolutionIndex));
      record.history.push({at:recordedAt,actor,action:'result_received',importId,fileName,sha256:original.file.sha256,
        imported:resolved.filter(row=>row.status==='IMPORTED').length,
        unresolved:resolved.filter(row=>row.status!=='IMPORTED').length,unmatchedRows:original.unmatchedRows.length});
      return {xeroPackageId:id,importId};
    });
    return this.workspace.serial(async()=>({...result,revision:this.workspace.state.revision,
      package:this._detail(this._package(result.operation.result.xeroPackageId))}));
  }
  async _file(id,name,index=this._receivingIndex()) {
    const record=this._package(id);filename(name);
    if(record.files.some(row=>row.name===name))return this._retainedFile(record,name);
    const item=this._relatedImports(record,index).find(row=>row.files.some(file=>file.name===name));
    need(item,'XERO_FILE_NOT_FOUND','Choose an original file listed in this package or one of its returned results.',404);
    return this._retainedFile(item,name);
  }
  async file(id,name) {return this.workspace.serial(async()=>this._file(id,name));}
  async export(id) {
    return this.workspace.serial(async()=>{
      const record=this._package(id),index=this._receivingIndex(),value=this._detail(record,index),files=[];
      let total=0;
      const add=item=>{
        total+=item.bytes.length;
        need(total<=XERO_PACKAGE_BYTES,'XERO_PACKAGE_LIMIT','The complete handover exceeds 128 MiB. Download its individual retained result files.');
        files.push(item);
      };
      for(const item of record.files)add(await this._retainedFile(record,item.name));
      for(const item of value.imports) {
        add(await this._file(id,item.fileName,index));add(await this._file(id,item.reportName,index));
      }
      add(packetFile('current-package.json',json(value),'current-package-state'));
      add(packetFile('handover-manifest.json',json({schema:'stellar-forge.merchant-receivables-xero-files.v1',
        packageId:id,revision:this.workspace.state.revision,sourceFingerprint:record.sourceFingerprint,
        previewSha256:record.previewSha256,files:files.map(xeroFileDescriptor)}),'handover-manifest'));
      return {value,files,revision:this.workspace.state.revision};
    });
  }
}
