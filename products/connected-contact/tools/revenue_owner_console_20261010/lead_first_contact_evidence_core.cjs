'use strict';
/** Complete original package and native-receipt verification for both native and portable receiving. */
const core=require('./lead_fulfillment_core.cjs');
const hashes=require('../../host/connected_sha256.cjs');
const contactModel=require('./lead_first_contact_core.cjs');
const fileModel=require('./lead_customer_files.cjs');
const archiveCore=require('./lead_customer_archive_core.cjs');
const receiptCore=require('./first_contact_receipt_core.cjs');
function createLeadPackageContactEvidence({Buffer,normalizeMessages,MAILBOXES,nativeSentIdentity,unwrapNativeMessages,URL=globalThis.URL}){
const files=fileModel.createLeadCustomerFiles({hash:core.hash,...hashes});
const {leadCustomerFileArchive}=archiveCore.createLeadCustomerArchive(hashes);
const {verifyFirstContactReceipt,normalizeContactSourceShare}=receiptCore.createFirstContactProofs({
  Buffer,sha256:value=>hashes.sha256Bytes(value).sha256,normalizeMessages,MAILBOXES,URL});
const packageContacts=contactModel.createLeadPackageContacts({hash:core.hash,...hashes,decodeBase64:files.decodeBase64});
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{status:422,code:'LEAD_PACKAGE_CONTACT_EVIDENCE'});};
function originalContactPackage(ledger,row){
  const root=core.validateRoot(ledger);packageContacts.validateOne(root,row);
  const selection=core.leadCustomerPackageSelection(ledger,row.customer_package_id,row.pack_id);
  const sources=new Map(selection.files.map(file=>[file.document.name,file.document]));
  const generated=new Map(row.package.generated_files.map(file=>[file.name,file]));
  const documents=row.package.files.map(file=>{
    const original=sources.get(file.name),text=generated.get(file.name);
    const content=original?files.decodeBase64(original.content_base64):text.content;
    const actual=typeof content==='string'?hashes.sha256Utf8(content):hashes.sha256Bytes(content);
    need(actual.bytes===file.bytes&&actual.sha256===file.sha256,'Retain every exact original package member.');
    return {...file,content};
  });
  const content=leadCustomerFileArchive(documents),actual=hashes.sha256Bytes(content);
  need(actual.bytes===row.package.archive.bytes&&actual.sha256===row.package.archive.sha256,
    'The complete original package ZIP could not be reconstructed from its retained members.');
  return {...row.package.archive,name:row.package.archive.filename,type:'application/zip',content,...actual};
}
function originalPackageSourceProof(saved,native,observations,occurredAt,messageId){
  const links=saved.preview.message.source_links||[];
  if(!links.length){need(!(native.contact_source_delivery||[]).length,'An attachment receipt contains unrelated source delivery checks.');return {checks:[],proof:null};}
  const candidates=[];
  for(const proof of observations||[]){
    if(proof?.schema!=='dealscout.original-contact-source-checks.v1'||proof.draft_id!==saved.id||
      proof.draft_digest!==saved.digest||proof.message_id!==messageId||proof.operation?.id!==proof.operation_id||
      proof.operation.draft_id!==saved.id||proof.operation.review_digest&&proof.operation.review_digest!==saved.digest)continue;
    const start=proof.before_send,event=proof.source_event,send=proof.send_start;
    if(start?.kind!=='provider_start'||start.phase!=='beforeSend'||event?.kind!=='source_delivery'||
      event.phase!=='before_send'||send?.kind!=='provider_start'||send.phase!=='sendEmail')continue;
    const times=[start.at,event.at,send.at,occurredAt].map(Date.parse);
    if(times.some(t=>!Number.isFinite(t))||times.some((t,i)=>i>0&&t<times[i-1]))continue;
    if(proof.operation.result?.message_id!==messageId){
      if(proof.native_receipt){
        try{verifyFirstContactReceipt(saved,proof.native_receipt,messageId);}catch{continue;}
      }else{
        const received=proof.reconciliation,op=received?.operation;
        const expectedSend='op-'+hashes.sha256Utf8('first-contact-send:'+saved.id).sha256.slice(0,32);
        if(received?.schema!=='dealscout.original-contact-reconciliation.v1'||
          received.send_operation_id!==expectedSend||proof.operation_id!==expectedSend||
          !['send','continue-before-send','continue-native'].includes(proof.operation.kind)||
          proof.operation.review_digest!==saved.digest||op?.kind!=='reconcile'||
          !/^op-[a-f0-9]{32}$/.test(op.id||'')||op.draft_id!==saved.id||
          op.message_id!==messageId||op.result?.message_id!==messageId)continue;
        try{verifyFirstContactReceipt(saved,received.native_receipt,messageId);}catch{continue;}
      }
    }
    const checks=event.checks;
    if(!Array.isArray(checks)||checks.length!==links.length)continue;
    let valid=true;
    for(const link of links){
      normalizeContactSourceShare(link,link);
      const matches=checks.filter(row=>row?.file_id===link.file_id),check=matches[0];
      if(matches.length!==1||!['file_id','url','sha256','md5','bytes','recipient','permission'].every(key=>check[key]===link[key])||
        check.account?.id!==link.account.id||check.account?.email!==link.account.email||
        !Number.isFinite(Date.parse(check.checked_at))||Date.parse(check.checked_at)<times[0]||
        Date.parse(check.checked_at)>times[1]){valid=false;break;}
      if(link.schema==='commons.contact-drive-source/v2'){
        if(check.schema!==link.schema||check.revision_id!==link.revision_id||check.filename!==link.filename||check.content_verified!==true)valid=false;
      }else if(check.version!==link.version||check.permission_id!==link.permission_id)valid=false;
    }
    if(valid)candidates.push({checks,proof});
  }
  need(candidates.length>0,'Retain the original native before-send source-check event for this exact message; no new Drive or send operation is needed.');
  const returned=native.contact_source_delivery||[];
  const matches=returned.length?candidates.filter(p=>core.hash(p.checks)===core.hash(returned)):candidates;
  need(matches.length>0,'The returned source checks differ from the retained original sending attempt.');
  matches.sort((a,b)=>Date.parse(b.proof.send_start.at)-Date.parse(a.proof.send_start.at));
  return matches[0];
}
function packageReceiptCoverage(row,saved,message,sources){
  const archive=row.package.archive;
  const attachment=(message.delivered_attachments||[]).find(f=>f.sha256===archive.sha256&&f.bytes===archive.bytes&&f.filename===archive.filename);
  if(attachment)return attachment;
  const link=(saved.preview.message.source_links||[]).find(f=>f.item_id===row.item_id&&f.sha256===archive.sha256&&f.bytes===archive.bytes&&f.filename===archive.filename);
  const proof=link&&sources.find(f=>f.file_id===link.file_id);
  need(link&&proof,'The verified original message does not cover the complete selected package.');
  return {kind:'source',filename:link.filename,bytes:link.bytes,sha256:link.sha256,source_link:link,proof};
}
function verifyPackageContactReceipt(row,value){
  packageContacts.validateReceipt(row,value);
  const saved=packageContacts.event(row,'PREVIEWED').value;
  const message=verifyFirstContactReceipt(saved,value.native,value.message_id);
  const native=unwrapNativeMessages(value.native);
  need(native.length===1,'Receive the complete original native message.');
  const identity=nativeSentIdentity(native[0],{mailbox:value.mailbox});
  need(identity.native_sent===true&&identity.provider_id===value.message_id&&identity.occurred_at===value.occurred_at,
    'Keep the actual original SENT message time and mailbox.');
  if(value.source_delivery_proof?.reconciliation)need(
    core.hash(value.source_delivery_proof.reconciliation.operation)===core.hash(value.source_operation),
    'Keep the selected original reconciliation operation with its source checks.');
  const source=originalPackageSourceProof(saved,value.native,value.source_delivery_proof?[value.source_delivery_proof]:[],value.occurred_at,value.message_id);
  const sources=source.checks;
  need(core.hash(message.delivered_attachments)===core.hash(value.delivered_attachments)&&
    core.hash(sources)===core.hash(value.source_delivery)&&core.hash(source.proof)===core.hash(value.source_delivery_proof??null),'Retain the exact attachment verification and source delivery outcomes.');
  const selected=packageReceiptCoverage(row,saved,message,sources);
  need(core.hash(selected)===core.hash(value.coverage),'Keep the native byte-readback or submitted-MIME verification label.');
  return {message,identity};
}
/** Full saved-record receiving preserves the original native validator and source bytes. */
function verifyLeadPackageContactSources(ledger){
  const root=core.validateRoot(ledger);
  for(const row of root.customer_contacts||[]){
    originalContactPackage(ledger,row);
    for(const event of row.events.filter(event=>event.kind==='RECEIVED'))verifyPackageContactReceipt(row,event.value);
  }
  return root;
}

function verifyIncomingPackageContacts(bundle){
  const source=bundle?.workspace||bundle?.lead_fulfillment||
    (bundle?.pack?{...bundle,version:core.VERSION,packs:[bundle.pack],operations:[]}:null);
  if(source?.customer_contacts?.length)verifyLeadPackageContactSources({lead_fulfillment:source});
}

return {packageContacts,originalContactPackage,originalPackageSourceProof,packageReceiptCoverage,verifyPackageContactReceipt,verifyLeadPackageContactSources,verifyIncomingPackageContacts};
}
module.exports={createLeadPackageContactEvidence};
