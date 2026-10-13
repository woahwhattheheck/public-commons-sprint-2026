'use strict';
/** Complete package/contact associations inside the original lead working record. */
function createLeadPackageContacts({hash,sha256Utf8,sha256Bytes,decodeBase64}){
  const FIELDS=['customer_contacts'],VERSION='dealscout.lead-package-contact.v1';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const need=(ok,message,status=422)=>{if(!ok)throw Object.assign(new Error(message),{status,code:'LEAD_PACKAGE_CONTACT'});};
  const seal=value=>({...value,sha256:hash(value)});
  const identity=value=>{need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value),'Retain the original package contact identity.');return value;};
  const digest=value=>need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'Retain the complete source digest.');
  const instant=value=>need(typeof value==='string'&&Number.isFinite(Date.parse(value)),'Retain the original occurrence time.');
  const file=value=>{
    need(plain(value)&&typeof value.name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value.name)&&
      value.name.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Retain an ordinary complete package filename.');
    need(Number.isSafeInteger(value.bytes)&&value.bytes>=0,'Retain the complete file size.');digest(value.sha256);
  };
  const event=(row,kind)=>row.events.find(item=>item.kind===kind);
  function selection(root,row){
    const packet=(root.customer_packages||[]).find(p=>p.id===row.customer_package_id);
    const edition=root.editions.find(e=>e.id===row.edition_id);
    need(packet&&packet.pack_id===row.pack_id&&packet.sha256===row.customer_package_sha256&&
      edition?.pack_id===row.pack_id&&edition.sha256===row.edition_sha256&&packet.edition_id===edition.id,
      'The contact lost its original complete package or customer edition.');
    need(hash(packet.files)===hash(row.source_files),'The selected original supporting-file revisions changed.');
    return {packet,edition};
  }
  function validateOne(root,row){
    need(plain(row)&&row.version===VERSION,'Keep the complete original package/contact record.');
    identity(row.id);identity(row.pack_id);identity(row.case_id);instant(row.created_at);
    need(plain(row.request)&&row.request.operation_id===row.id&&row.request.pack_id===row.pack_id&&
      row.request.customer_package_id===row.customer_package_id&&hash(row.request)===row.request_sha256,
      'The original package preparation request changed.');
    const {sha256,events,...basis}=row;
    need(sha256===hash({...basis,events})&&Array.isArray(events),'The complete package/contact history changed.');
    const {packet,edition}=selection(root,row);
    need(row.case_record?.id===row.case_id&&hash(row.case_record)===row.case_sha256&&row.request.expected_case_sha256===row.case_sha256,
      'The selected original company case changed.');
    need(row.item_id==='lead-package-'+packet.sha256.slice(0,40),'Retain the original package delivery item.');
    need(plain(row.package)&&Array.isArray(row.package.files)&&row.package.files.length>0&&
      Array.isArray(row.package.generated_files)&&plain(row.package.manifest),'Retain all original customer document bytes and supporting-file references.');
    file({...row.package.archive,name:row.package.archive.filename});
    need(/\.zip$/i.test(row.package.archive.filename),'Select the complete customer ZIP.');
    need(row.package.manifest.customer===edition.brief.customer.name&&row.package.manifest.title===packet.title&&
      row.package.manifest.prepared_at===packet.prepared_at&&row.package.manifest.delivery_type===edition.kind&&
      row.package.manifest.lead_count===edition.leads.length&&row.package.manifest.currency===edition.currency&&
      row.package.manifest.price_minor===edition.price_minor,'The complete customer manifest belongs to another selection.');
    const files=row.package.files;files.forEach(file);
    need(new Set(files.map(f=>f.name)).size===files.length,'The retained complete package repeats a filename.');
    const generated=new Map();
    for(const f of row.package.generated_files){
      file(f);need(typeof f.content==='string','Retain complete original rendered customer text.');
      const actual=sha256Utf8(f.content);
      need(actual.bytes===f.bytes&&actual.sha256===f.sha256&&!generated.has(f.name),'The original rendered customer bytes changed.');
      generated.set(f.name,f);
    }
    const originals=new Map();
    for(const ref of packet.files){
      const saved=root.customer_files.find(f=>f.id===ref.id&&f.pack_id===row.pack_id);
      const version=[...saved.history,saved].find(f=>f.revision===ref.revision&&f.sha256===ref.sha256);
      originals.set(version.document.name,version.document);
    }
    need(files.length===generated.size+originals.size,'Keep every generated and supporting package member exactly once.');
    for(const f of files){
      const source=generated.get(f.name)||originals.get(f.name);
      need(source&&source.bytes===f.bytes&&source.sha256===f.sha256,'A complete customer package member is missing or changed.');
    }
    const manifest=generated.get('manifest.json');
    need(manifest&&hash(JSON.parse(manifest.content))===hash(row.package.manifest)&&
      hash(row.package.manifest.files)===hash(files.filter(f=>f.name!=='manifest.json')),
      'Retain the original complete package manifest and every member.');
    let previous=hash(basis),stage=0;const kinds=new Set();
    for(const e of events){
      need(plain(e)&&typeof e.kind==='string'&&plain(e.value),'Retain the complete contact event.');identity(e.id);instant(e.at);
      const {sha256:eh,...body}=e;
      need(eh===hash(body)&&e.previous_sha256===previous,'The original package/contact event chain changed.');
      need(!kinds.has(e.id),'The package contact repeats an event identity.');kinds.add(e.id);previous=eh;
      if(e.kind==='INSTALL_REVIEW'){
        need(stage===0&&e.value.state==='REVIEW'&&e.value.case_id===row.case_id,'Retain the original file-install review.');
        digest(e.value.review_sha256);stage=1;
      }else if(e.kind==='INSTALLED'){
        need(stage===1&&e.value.state==='COMPLETE'&&e.value.case_id===row.case_id&&
          e.value.review_sha256===event(row,'INSTALL_REVIEW').value.review_sha256,'Retain the same completed file install.');
        const selected=e.value.files?.find(f=>f.item_id===row.item_id);
        need(selected&&selected.sha256===row.package.archive.sha256&&selected.bytes===row.package.archive.bytes&&
          selected.filename===row.package.archive.filename,'The installed file does not cover the complete original package.');stage=2;
      }else if(e.kind==='PREVIEW_REQUEST'){
        const r=e.value;need(stage===2&&r.case_id===row.case_id&&r.prospect==='buyer'&&
          (typeof r.request_key==='string'&&/^[a-zA-Z0-9_-]{8,128}$/.test(r.request_key)||
            /^contact-[a-f0-9]{32}$/.test(r.existing_draft_id||'')&&/^[a-f0-9]{64}$/.test(r.review_digest||'')),'Retain the original frozen contact request.');
        const selected=[...(r.attachments||[]),...(r.source_items||[])];
        need(selected.length===1&&selected[0].item_id===row.item_id&&selected[0].sha256===row.package.archive.sha256,
          'The original contact request must select the whole package.');stage=3;
      }else if(e.kind==='PREVIEWED'){
        need(stage===3,'Retain the exact contact request before its draft.');
        validateDraft(row,e.value);stage=4;
      }else if(e.kind==='RECEIVED'){
        need(stage>=4,'Keep the original reviewed draft before its receipt.');
        validateReceipt(row,e.value);stage=5;
      }else need(false,'Use a supported package/contact event.');
    }
    return row;
  }
  function validateDraft(row,saved){
    need(saved?.schema==='commons.case_first_contact/v1'&&plain(saved.preview),'Retain the complete original First contact draft.');
    const expected=sha256Utf8(JSON.stringify(saved.preview,null,2)+'\n').sha256;
    need(saved.digest===expected,'The original First contact preview digest changed.');
    const request=event(row,'PREVIEW_REQUEST').value,p=saved.preview,m=p.message;
    need((request.existing_draft_id?saved.id===request.existing_draft_id&&saved.digest===request.review_digest:
      saved.id==='contact-'+sha256Utf8(JSON.stringify([request.request_key,saved.digest])).sha256.slice(0,32))&&
      p.case.id===row.case_id&&p.case_fingerprint===request.case_fingerprint&&p.prospect===request.prospect&&
      m.to===request.to.trim().toLowerCase()&&m.link_id===request.link_id&&m.subject===request.subject.trim()&&
      m.authored_body===request.body.replace(/\r\n/g,'\n')&&m.body_type===(request.body_type||'text/plain'),
      'The retained native draft differs from the exact original request.');
    const selected=[...(m.attachments||[]),...(m.source_links||[])];
    need(selected.length===1&&selected[0].item_id===row.item_id&&selected[0].sha256===row.package.archive.sha256&&
      selected[0].bytes===row.package.archive.bytes&&selected[0].filename===row.package.archive.filename,
      'The original native draft must retain complete package coverage.');
    need((request.attachments||[]).length===(m.attachments||[]).length&&
      (request.source_items||[]).length===(m.source_links||[]).length,'Keep the reviewed original delivery mode.');
  }
  function validateReceipt(row,value){
    const saved=event(row,'PREVIEWED').value;
    need(Date.parse(value.occurred_at)>=Date.parse(row.package.manifest.prepared_at),'The native delivery precedes the original prepared customer package.');
    need(value.draft_id===saved.id&&value.draft_digest===saved.digest&&value.case_id===row.case_id&&
      value.mailbox===saved.preview.sender&&value.recipient===saved.preview.message.to&&
      value.ledger?.saved===true&&(!value.ledger.message_id||value.ledger.message_id===value.message_id)&&
      value.native!==null&&typeof value.native==='object'&&value.native_sha256===hash(value.native),'Retain the verified original native SENT source and saved case receipt.');
    identity(value.operation_id);identity(value.source_operation_id);instant(value.occurred_at);
    const source=value.source_operation,chain=value.operation_chain,caseReceipt=value.case_receipt;
    need(plain(source)&&source.id===value.source_operation_id&&source.draft_id===saved.id&&source.receipt_available===true&&
      (!source.review_digest||source.review_digest===saved.digest)&&source.kind!=='record',
      'The native receipt lost its exact original draft operation.');
    need(Array.isArray(chain)&&chain.length>0&&chain[0].id===value.operation_id&&hash(chain.at(-1))===hash(source)&&
      new Set(chain.map(op=>op.id)).size===chain.length,'Retain the complete selected receipt-operation lineage.');
    for(let i=0;i<chain.length;i++){
      const op=chain[i];
      need(op.draft_id===saved.id&&(!op.review_digest||op.review_digest===saved.digest),
        'A retained receipt operation belongs to another draft.');
      if(i+1<chain.length)need(op.kind==='record'&&op.source_operation===chain[i+1].id,
        'Retain each original record alias and source operation.');
      for(const observed of [op.message_id,op.result?.message_id,op.result?.ledger?.message_id])
        need(observed===undefined||observed===value.message_id,'A retained native operation identifies another message.');
      need(!op.result?.ledger?.case_id||op.result.ledger.case_id===row.case_id,'The native operation saved another case.');
    }
    need((value.ledger.message_id===value.message_id||source.result?.message_id===value.message_id)&&
      (!value.ledger.case_id||value.ledger.case_id===row.case_id)&&
      caseReceipt?.case_id===row.case_id&&caseReceipt.message_id===value.message_id&&caseReceipt.record?.id===row.case_id&&
      hash(caseReceipt.record)===caseReceipt.sha256&&
      (!value.ledger.revision||caseReceipt.revision===value.ledger.revision)&&
      (!value.ledger.store_id||caseReceipt.store_id===value.ledger.store_id),
      'Keep the original native case commitment and its complete selected record.');
    for(const key of ['campaign_key','buyer','partner'])
      need(caseReceipt.record[key]===saved.preview.case[key],'The original received case identity changed.');
    need(caseReceipt.record.events?.some(e=>e.type==='SENT'&&e.provider_id===value.message_id&&
      e.recipient_email===value.recipient&&(!e.mailbox||e.mailbox===value.mailbox)),
      'The retained case commitment does not contain this original SENT message.');
    need(typeof value.message_id==='string'&&value.message_id&&value.delivery?.provider_id===value.message_id&&
      value.delivery.destination===value.recipient&&value.delivery.delivered_at===value.occurred_at&&
      value.delivery.edition_id===row.edition_id&&value.delivery.customer_package_id===row.customer_package_id&&
      value.delivery.customer_package_sha256===row.customer_package_sha256,
      'The recorded delivery lost its exact native message or selected package.');
    const file=value.coverage;
    need(file?.sha256===row.package.archive.sha256&&file.bytes===row.package.archive.bytes&&
      file.filename===row.package.archive.filename,'The native receipt does not cover the whole selected package.');
  }
  function validate(root){
    need(root.customer_contacts===undefined||Array.isArray(root.customer_contacts),'Keep the complete customer contact list.');
    const rows=root.customer_contacts||[];need(new Set(rows.map(r=>r.id)).size===rows.length,'A customer contact identity is repeated.');
    for(const row of rows){validateOne(root,row);
      for(const e of row.events.filter(e=>e.kind==='RECEIVED')){
        const d=root.deliveries.find(d=>d.id===e.value.delivery.id);
        need(d&&hash(d)===hash(e.value.delivery),'Keep the exact original delivery with its native receipt.');
      }
    }
  }
  function create(root,basis){
    const row=seal({...clone(basis),version:VERSION,events:[]});validateOne(root,row);return row;
  }
  function append(root,row,kind,value,at){
    const body={id:'package-event-'+hash({contact_id:row.id,kind,value}).slice(0,40),kind,at,value:clone(value),
      previous_sha256:row.events.at(-1)?.sha256||hash(Object.fromEntries(Object.entries(row).filter(([k])=>!['sha256','events'].includes(k))))};
    const prior=row.events.find(e=>e.id===body.id);if(prior){need(hash(prior.value)===hash(value),'The original event changed.',409);return row;}
    const {sha256,...old}=row,next=seal({...old,events:[...row.events,seal(body)]});validateOne(root,next);return next;
  }
  function receivedDelivery(root,delivery){
    return (root.customer_contacts||[]).some(row=>row.events.some(e=>e.kind==='RECEIVED'&&
      e.value.delivery.id===delivery.id&&hash(e.value.delivery)===hash(delivery)));
  }
  function forPack(root,packId){return root.customer_contacts===undefined?{}:{customer_contacts:clone(root.customer_contacts.filter(r=>r.pack_id===packId))};}
  function merge(root,bundle,report){
    if(bundle.customer_contacts===undefined)return;
    root.customer_contacts??=[];report.added.customer_contacts??=0;report.advanced.customer_contacts??=0;
    for(const incoming of bundle.customer_contacts){
      const current=root.customer_contacts.find(r=>r.id===incoming.id);
      if(!current){root.customer_contacts.push(clone(incoming));report.added.customer_contacts++;report.records.push({entity:'customer_contacts',id:incoming.id,name:incoming.customer_package_id,action:'add'});continue;}
      const basis=row=>Object.fromEntries(Object.entries(row).filter(([k])=>!['sha256','events'].includes(k)));
      const overlap=Math.min(current.events.length,incoming.events.length);
      if(hash(basis(current))!==hash(basis(incoming))||hash(current.events.slice(0,overlap))!==hash(incoming.events.slice(0,overlap))){
        report.conflicts.push({entity:'customer_contacts',id:incoming.id,reason:'The same package contact has divergent original requests or event history.'});continue;
      }
      if(incoming.events.length>current.events.length){root.customer_contacts[root.customer_contacts.indexOf(current)]=clone(incoming);report.advanced.customer_contacts++;}
      else report.unchanged++;
    }
    try{validate(root);}catch(error){report.conflicts.push({entity:'customer_contacts',id:bundle.pack?.id||'',reason:error.message});}
  }
  function summary(row,{receivedCopy=false}={}){
    const prepared=event(row,'PREVIEWED')?.value,review=event(row,'INSTALL_REVIEW')?.value;
    return {id:row.id,pack_id:row.pack_id,customer_package_id:row.customer_package_id,case_id:row.case_id,
      state:row.events.at(-1)?.kind||'SELECTED',created_at:row.created_at,archive:clone(row.package.archive),
      review_sha256:review?.review_sha256||null,draft_id:prepared?.id||null,draft_digest:prepared?.digest||null,
      contact_url:'/contact?case_id='+encodeURIComponent(row.case_id)+(prepared?'&draft_id='+encodeURIComponent(prepared.id):''),
      receipt_count:row.events.filter(e=>e.kind==='RECEIVED').length,received_copy:receivedCopy};
  }
  return {FIELDS,VERSION,create,append,event,validate,validateOne,validateDraft,validateReceipt,forPack,merge,summary,receivedDelivery};
}
module.exports={createLeadPackageContacts};
