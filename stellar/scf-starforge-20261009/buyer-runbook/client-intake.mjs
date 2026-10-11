// MIT. Receive the original customer SDK into the existing request intake.
// The canonical receipt/export helpers own validation. Uploaded code is data.
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {InputError} from '../sf88-operator-buyer-cli/config.mjs';
import {prepareReview} from '../sf88-operator-buyer-cli/prepare.mjs';
import {createOperationHandoff,readOperationHandoffRequest,OPERATION_HANDOFF_MAX_BYTES} from '../sf88-operator-buyer-cli/operation-handoff.mjs';
import {MAX_REQUEST_BODY_BYTES,requestBodyPin} from '../sf88-operator-buyer-cli/request-body.mjs';
import {CLIENT_EXPORT_FILES,CLIENT_EXPORT_MANIFEST,MAX_CLIENT_EXPORT_FILE_BYTES,
  parseSellerClientManifest,inspectSellerClientExport,readSellerClientFile} from '../sf30-seller-sdk/developer/client-export.mjs';
import {buildUnpaidRequest} from '../sf30-seller-sdk/developer/request.mjs';
import {encodeMultipart,decodeMultipart} from '../sf30-seller-sdk/multipart.mjs';

export const CLIENT_RECEIPT_MAX_BYTES=65000;
export const CLIENT_FILE_UPLOAD_MAX_BYTES=4*Math.ceil(MAX_CLIENT_EXPORT_FILE_BYTES/3)+4096;
export const CLIENT_REQUEST_UPLOAD_MAX_BYTES=2*MAX_REQUEST_BODY_BYTES+65536;
const SCHEMA='stellar-forge.buyer-client-intake.v1',ID=/^client-[a-f0-9]{64}$/;
const REQUEST=/^request-[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/;
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const check=(ok,code,status=422)=>{if(!ok)throw Object.assign(new InputError(code),{status});};
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,allowed,required=allowed)=>check(plain(value)&&Object.keys(value).every(key=>allowed.includes(key))&&
  required.every(key=>Object.hasOwn(value,key)),'CLIENT_RECEIVE_FIELDS_INVALID');
const codeOf=error=>/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'CLIENT_RECEIVE_FAILED';
function unpack(value,limit) {
  check(typeof value==='string'&&value.length<=4*Math.ceil(limit/3),'CLIENT_RECEIVE_FILE_TOO_LARGE',413);
  const raw=Buffer.from(value,'base64');
  check(raw.length<=limit&&raw.toString('base64')===value,'CLIENT_RECEIVE_ENCODING_INVALID');return raw;
}

/** Uses the original intake's private publication and metadata lease. Request
 * preparation, keys, ledger, execution and recovery stay in that same intake. */
export async function createSellerClientIntake({directory,request,receiveRequest,storage}) {
  const {privateDirectory,bytes,publish,json,optional,lease,lstat,readdir}=storage;
  await privateDirectory(directory,true);
  const root=id=>{check(typeof id==='string'&&ID.test(id),'CLIENT_RECEIVE_ID_INVALID');return join(directory,id);};
  async function retained(id) {
    const target=root(id),record=await json(join(target,'received.json'));
    check(record.schema===SCHEMA&&record.id===id&&record.manifestSha256===id.slice(7),'CLIENT_RECEIVE_RECORD_CHANGED',409);
    const raw=await bytes(join(target,CLIENT_EXPORT_MANIFEST),CLIENT_RECEIPT_MAX_BYTES);
    check(hash(raw)===record.manifestSha256,'CLIENT_RECEIVE_MANIFEST_CHANGED',409);
    return {target,record,manifest:parseSellerClientManifest(raw)};
  }
  async function inspect(id,{requests=true}={}) {
    const {target,record,manifest}=await retained(id),files=[];let complete=true;
    for(const expected of manifest.files) {
      let info;
      try {info=await lstat(join(target,expected.name));}
      catch(error){if(error.code!=='ENOENT')throw error;}
      if(!info){complete=false;files.push({...expected,state:'MISSING'});continue;}
      check(info.isFile()&&!info.isSymbolicLink()&&info.size===expected.bytes,'CLIENT_RECEIVE_FILE_CHANGED',409);
      files.push({...expected,state:'RETAINED'});
    }
    let inspected=null,operations=[];
    if(complete) {
      inspected=await inspectSellerClientExport({directory:target,includeOffers:true});
      check(inspected.state==='COMPLETE'&&inspected.manifestFile.sha256===record.manifestSha256,
        'CLIENT_RECEIVE_MANIFEST_CHANGED',409);
      const original=await readSellerClientFile({directory:target,file:'seller-openapi.json',expectedManifestSha256:record.manifestSha256});
      const document=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original.bytes));
      operations=inspected.snapshot.operations.map(op=>{
        // The original OpenAPI path uses {name}; its compiled seller route
        // uses :name. Join their validated operation identity, not path syntax.
        const matches=Object.entries(document.paths).flatMap(([openapiPath,item])=>{
          const source=item[op.method.toLowerCase()];
          return source?.operationId===op.id?[{openapiPath,source}]:[];
        });
        check(matches.length===1,'CLIENT_RECEIVE_OPERATION_CHANGED',409);
        const {openapiPath,source}=matches[0],route=source['x-seller-route'];
        check(route.id===op.id&&route.method===op.method&&route.path===op.path,
          'CLIENT_RECEIVE_OPERATION_CHANGED',409);
        return {...op,openapiPath,parameters:source.parameters??[],requestBody:source.requestBody??null};
      });
    }
    const selections=[];
    if(requests)for(const name of (await readdir(join(target,'requests'))).filter(name=>/^request-[a-f0-9]{64}\.json$/.test(name)).sort()) {
      const selected=await json(join(target,'requests',name));
      check(selected.schema===SCHEMA&&selected.clientId===id&&selected.manifestSha256===record.manifestSha256&&
        selected.requestId+'.json'===name,'CLIENT_RECEIVE_REQUEST_CHANGED',409);
      const original=await request(selected.requestId);
      check(original.handoffSha256===selected.handoffSha256&&original.summary.intentId===selected.intentId,
        'CLIENT_RECEIVE_REQUEST_CHANGED',409);
      selections.push({...selected,summary:original.summary,prepared:original.prepared});
    }
    return {schema:SCHEMA,id,manifestSha256:record.manifestSha256,receivedAt:record.receivedAt,
      state:complete?'COMPLETE':'INCOMPLETE',manifest,files,operations,
      title:inspected?.snapshot.title??manifest.origin,requests:selections};
  }
  async function receive(input) {
    fields(input,['base64']);
    const raw=unpack(input.base64,CLIENT_RECEIPT_MAX_BYTES);parseSellerClientManifest(raw);
    const id='client-'+hash(raw),target=root(id);
    await privateDirectory(target,true);await privateDirectory(join(target,'requests'),true);
    await privateDirectory(join(target,'compositions'),true);
    await publish(join(target,CLIENT_EXPORT_MANIFEST),raw,{same:true,raw:true});
    const prior=await optional(join(target,'received.json'));
    if(!prior)await publish(join(target,'received.json'),{schema:SCHEMA,id,manifestSha256:hash(raw),
      receivedAt:new Date().toISOString()});
    // The original receipt is authoritative even while some payloads are absent.
    return inspect(id);
  }
  async function upload(input) {
    fields(input,['id','file','base64']);
    const {target,manifest}=await retained(input.id),expected=manifest.files.find(file=>file.name===input.file);
    check(expected,'CLIENT_RECEIVE_FILE_NOT_LISTED');
    const raw=unpack(input.base64,expected.bytes);
    check(raw.length===expected.bytes&&hash(raw)===expected.sha256,'CLIENT_RECEIVE_FILE_CHANGED',409);
    await publish(join(target,input.file),raw,{same:true,raw:true});
    return inspect(input.id);
  }
  async function compose(input) {
    fields(input,['id','expectedManifestSha256','operationId','intentId','values','ticket'],
      ['id','expectedManifestSha256','operationId','intentId','values']);
    check(HASH.test(input.expectedManifestSha256??''),'CLIENT_RECEIVE_MANIFEST_REQUIRED');
    const selected=await inspect(input.id,{requests:false}),target=root(input.id);
    check(selected.state==='COMPLETE','CLIENT_RECEIVE_INCOMPLETE',409);
    check(selected.manifestSha256===input.expectedManifestSha256,'CLIENT_RECEIVE_MANIFEST_CHANGED',409);
    const op=selected.operations.find(value=>value.id===input.operationId);
    check(op,'CLIENT_RECEIVE_OPERATION_NOT_FOUND');
    fields(input.values,['path','query','body','multipart','form','omitBody'],[]);
    const values={...input.values},path=values.path??{},query=values.query??{};
    check(plain(path)&&Object.keys(path).every(name=>op.pathNames.includes(name))&&
      op.pathNames.every(name=>Object.hasOwn(path,name)),'CLIENT_RECEIVE_PATH_VALUES_REQUIRED');
    check(plain(query),'CLIENT_RECEIVE_QUERY_VALUES_REQUIRED');
    const bodyMethod=['POST','PUT','PATCH'].includes(op.method),form=op.bodyType==='form-data';
    check(bodyMethod||!['body','multipart','form','omitBody'].some(key=>Object.hasOwn(values,key)),
      'CLIENT_RECEIVE_BODY_NOT_DECLARED');
    check(values.omitBody===undefined||typeof values.omitBody==='boolean','CLIENT_RECEIVE_BODY_CHOICE_REQUIRED');
    check(!(form&&Object.hasOwn(values,'body'))&&!(!form&&(Object.hasOwn(values,'multipart')||Object.hasOwn(values,'form')))&&
      !(Object.hasOwn(values,'multipart')&&Object.hasOwn(values,'form'))&&
      !(values.omitBody===true&&['body','multipart','form'].some(key=>Object.hasOwn(values,key))),
      'CLIENT_RECEIVE_BODY_CHOICE_REQUIRED');
    const selectionSha256=hash(encode({clientId:input.id,manifestSha256:selected.manifestSha256,
      operationId:op.id,intentId:input.intentId,values:input.values,ticket:input.ticket??null}));
    const packetPath=join(target,'compositions',selectionSha256+'.handoff'),inputDirectory=join(target,'prepared-input');
    let retainedPacket;
    try {retainedPacket=await readOperationHandoffRequest({file:packetPath,directory:inputDirectory,acceptIndex:0,requireCurrent:false});}
    catch(error){if(error.code!=='OPERATION_HANDOFF_FILE_UNREADABLE')throw error;
      try {await lstat(packetPath);throw error;}catch(missing){if(missing.code!=='ENOENT')throw missing;}}
    if(retainedPacket) {
      const source=retainedPacket.draft.preparedFrom.originalListing.extensions?.['stellar-forge-client-source'];
      check(source?.manifestSha256===selected.manifestSha256&&source.selectionSha256===selectionSha256&&
        source.operationId===op.id&&retainedPacket.draft.operation.intentId===input.intentId,
        'CLIENT_RECEIVE_REQUEST_CHANGED',409);
      // The original intake recovers an already accepted request even after
      // ticket expiry, and still checks expiry before accepting a new request.
      return acceptPacket(retainedPacket.handoffBytes);
    }
    let formEncoded=false;
    if(values.form!==undefined) {
      fields(values.form,['fields','files'],[]);
      check(plain(values.form.fields??{})&&Array.isArray(values.form.files??[]),'CLIENT_RECEIVE_FORM_INVALID');
      let total=0;
      const files=(values.form.files??[]).map(file=>{
        fields(file,['field','filename','contentType','base64'],['field','filename','base64']);
        const bytes=unpack(file.base64,MAX_REQUEST_BODY_BYTES);total+=bytes.length;
        check(total<=MAX_REQUEST_BODY_BYTES,'CLIENT_RECEIVE_FILE_TOO_LARGE',413);
        return {field:file.field,filename:file.filename,contentType:file.contentType??'application/octet-stream',bytes};
      });
      const encoded=encodeMultipart({fields:values.form.fields??{},files});
      values.multipart={body:encoded.raw,contentType:encoded.contentType};
      delete values.form;formEncoded=true;
    }
    if(values.multipart!==undefined&&!formEncoded) {
      fields(values.multipart,['base64','contentType']);
      values.multipart={body:unpack(values.multipart.base64,Math.min(op.maxRequestBytes,MAX_REQUEST_BODY_BYTES)),
        contentType:values.multipart.contentType};
    }
    if(values.multipart!==undefined) {
      // Use the same complete Bazaar body schema as the original seller's
      // multipart decoder. The OpenAPI view contains projected $ref pointers.
      await decodeMultipart(values.multipart.body,values.multipart.contentType,
        op.offer.extensions.bazaar.schema.properties.input.properties.body);
    }
    const built=buildUnpaidRequest({
      'x-seller-route':{id:op.id,method:op.method,path:op.path,maxRequestBytes:op.maxRequestBytes},
      'x-x402-payment-required':op.offer,parameters:op.parameters,
      ...(op.requestBody===null?{}:{requestBody:op.requestBody}),
    },{...values,path,query},selected.manifest.origin);
    const bodyBytes=Object.hasOwn(built.init,'body')?Buffer.from(built.init.body):undefined;
    check(bodyBytes===undefined||bodyBytes.length<=MAX_REQUEST_BODY_BYTES,'CLIENT_RECEIVE_FILE_TOO_LARGE',413);
    let ticketBytes,ticketHeader;
    if(input.ticket!==undefined) {
      fields(input.ticket,['base64','header'],['base64']);
      ticketBytes=unpack(input.ticket.base64,16384);
      ticketHeader=input.ticket.header;
    }
    const row=structuredClone(op.offer);
    row.resource={...row.resource,url:built.publicUrl};
    row.extensions={...row.extensions,'stellar-forge-client-source':{
      schema:'stellar-forge.seller-client-reference.v1',manifestSha256:selected.manifestSha256,
      sourceSha256:selected.manifest.sourceSha256,filesSha256:selected.manifest.filesSha256,selectionSha256,
      operationId:op.id,method:op.method,path:op.path,
      ...(selected.manifest.provenance?{provenance:selected.manifest.provenance}:{}),
    }};
    const discoveryBytes=encode({resources:[row]});
    // The initial preparation supplies the packet's ordinary config shape. The
    // receiving buyer still explicitly reviews a payment option before setup.
    const prepared=prepareReview(discoveryBytes,{rowIndex:0,acceptIndex:0,intentId:input.intentId,
      url:built.publicUrl,method:op.method,headers:built.init.headers,
      ...(bodyBytes===undefined?{}:{bodyFile:join(inputDirectory,'request.body'),...requestBodyPin(bodyBytes)}),
      ...(ticketBytes===undefined?{}:{ticketFile:join(inputDirectory,'operation-ticket.json'),...(ticketHeader===undefined?{}:{ticketHeader})}),
    });
    const packet=createOperationHandoff({draft:prepared.draft,discoveryBytes,bodyBytes,ticketBytes,directory:inputDirectory});
    const raw=encode(packet);
    check(raw.length<=OPERATION_HANDOFF_MAX_BYTES,'CLIENT_RECEIVE_FILE_TOO_LARGE',413);
    // Retain the original packet before accepting the request. The original
    // multipart boundary and bytes survive a lost response or process restart.
    await publish(packetPath,raw,{same:true,raw:true});
    return acceptPacket(raw);
    async function acceptPacket(raw) {
      const received=await receiveRequest({filename:'sdk-request.handoff.json',base64:raw.toString('base64')});
      check(REQUEST.test(received.id),'CLIENT_RECEIVE_REQUEST_CHANGED');
      const relation={schema:SCHEMA,clientId:input.id,manifestSha256:selected.manifestSha256,
        sourceSha256:selected.manifest.sourceSha256,operationId:op.id,intentId:input.intentId,selectionSha256,
        requestId:received.id,handoffSha256:received.handoffSha256};
      await publish(join(target,'requests',received.id+'.json'),relation,{same:true});
      return {clientId:input.id,manifestSha256:selected.manifestSha256,request:received};
    }
  }
  async function attachment(id,file) {
    const {target,record}=await retained(id);
    const selected=await readSellerClientFile({directory:target,file,expectedManifestSha256:record.manifestSha256});
    return {bytes:selected.bytes,name:selected.name,type:selected.type,sha256:hash(selected.bytes)};
  }
  async function state() {
    const clients=[],errors=[];
    for(const id of (await readdir(directory)).filter(name=>ID.test(name))) {
      try {const item=await inspect(id,{requests:false});
        clients.push({id:item.id,title:item.title,state:item.state,receivedAt:item.receivedAt,
          manifestSha256:item.manifestSha256,origin:item.manifest.origin,operations:item.manifest.operations.length,
          missingFiles:item.files.filter(file=>file.state==='MISSING').map(file=>file.name)});}
      catch(error){errors.push({id,code:codeOf(error)});}
    }
    clients.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
    return {clients,errors,files:[CLIENT_EXPORT_MANIFEST,...CLIENT_EXPORT_FILES],
      maxReceiptBytes:CLIENT_RECEIPT_MAX_BYTES,maxFileBytes:MAX_CLIENT_EXPORT_FILE_BYTES,maxRequestBodyBytes:MAX_REQUEST_BODY_BYTES};
  }
  return {state,get:inspect,attachment,receive:input=>lease(()=>receive(input)),
    upload:input=>lease(()=>upload(input)),compose:input=>lease(()=>compose(input))};
}
