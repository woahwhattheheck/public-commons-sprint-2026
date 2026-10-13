'use strict';
/** Exact retained customer exports, separate from historical package selections. */
const hashes=require('../../host/connected_sha256.cjs');
const archiveCore=require('./lead_customer_archive_core.cjs');
const {readLeadCustomerArchive}=archiveCore.createLeadCustomerArchive(hashes);
function createPackageRetention({hash,decodeBase64,packageHandover}){
  const VERSION='dealscout.lead-customer-package-export.v1';
  const error=message=>Object.assign(new Error(message),{status:422,code:'LEAD_CUSTOMER_PACKAGE_RETENTION'});
  const need=(value,message)=>{if(!value)throw error(message);};
  const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const clone=x=>JSON.parse(JSON.stringify(x));
  function text(value,label,max=4000){
    need(typeof value==='string'&&value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value),'Retain the complete '+label+'.');
    return value;
  }
  function identity(file,label){
    need(plain(file),'Retain the complete '+label+'.');
    const content=decodeBase64(file.content_base64),actual=hashes.sha256Bytes(content);
    need(file.bytes===actual.bytes&&file.sha256===actual.sha256,'The retained '+label+' bytes changed.');
    return content;
  }
  function utf8(content){
    // Pure original UTF-8 reader, including non-ASCII customer content.
    let result='';
    for(let i=0;i<content.length;){
      const a=content[i++];let point,n,min;
      if(a<128){point=a;n=0;min=0;}
      else if(a>=194&&a<=223){point=a&31;n=1;min=128;}
      else if(a>=224&&a<=239){point=a&15;n=2;min=2048;}
      else if(a>=240&&a<=244){point=a&7;n=3;min=65536;}
      else throw error('A retained customer document is not complete UTF-8.');
      need(i+n<=content.length,'A retained customer document is truncated.');
      for(let j=0;j<n;j++){const b=content[i++];need((b&192)===128,'A retained customer document is not complete UTF-8.');point=(point<<6)|(b&63);}
      need(point>=min&&point<=0x10ffff&&!(point>=0xd800&&point<=0xdfff),'A retained customer document has invalid UTF-8.');
      result+=String.fromCodePoint(point);
    }
    return result;
  }
  const archives=new Map();let archiveCharacters=0;
  function originalArchive(record){
    const input=record.archive;
    need(plain(input),'Retain the complete ZIP.');
    let saved=archives.get(input.content_base64);
    if(saved){need(input.bytes===saved.bytes&&input.sha256===saved.sha256,'The retained ZIP identity changed.');return saved;}
    const archive=identity(input,'ZIP'),files=readLeadCustomerArchive(archive);
    saved={archive,files,bytes:input.bytes,sha256:input.sha256};
    if(input.content_base64.length<=8*1024*1024){
      while(archives.size&&(archives.size>=32||archiveCharacters+input.content_base64.length>16*1024*1024)){
        const first=archives.keys().next().value;archiveCharacters-=first.length;archives.delete(first);
      }
      archives.set(input.content_base64,saved);archiveCharacters+=input.content_base64.length;
    }
    return saved;
  }
  /** The caller obtains this record through the fully validated original selection. */
  function read(record){
    const {archive,files}=originalArchive(record),byName=new Map(files.map(row=>[row.name,row]));
    const parsed=name=>JSON.parse(utf8(byName.get(name).content));
    return {archive:archive.slice(),files:files.map(row=>({...row,content:row.content.slice()})),
      manifest:parsed('manifest.json'),customerPackage:parsed('customer-package.json'),
      html:record.html?utf8(identity(record.html,'HTML export')):utf8(byName.get('lead-pack.html').content),
      customerPackageJSON:utf8(byName.get('customer-package.json').content)};
  }
  function inspect(record,selection,root){
    need(plain(record)&&record.version===VERSION,'Choose a complete retained customer-package export.');
    const {packet}=selection,{sha256,...body}=record;
    need(sha256===hash(body),'The complete retained customer export changed.');
    need(record.id===packet.id&&record.package_id===packet.id&&record.pack_id===packet.pack_id&&
      record.package_sha256===packet.sha256&&record.edition_id===packet.edition_id&&record.edition_sha256===packet.edition_sha256,
      'Keep the retained export with its exact original package and lead edition.');
    need(typeof record.retained_at==='string'&&Number.isFinite(Date.parse(record.retained_at))&&
      new Date(record.retained_at).toISOString()===record.retained_at&&Date.parse(record.retained_at)>=Date.parse(packet.prepared_at),
      'Retain the actual export recording time after its package preparation.');
    need(plain(record.provenance)&&['prepared','original-source'].includes(record.provenance.kind),'Retain the actual preparation or original-archive provenance.');
    text(record.provenance.source,'export source');
    need(record.archive?.type==='application/zip'&&/^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/.test(record.archive.name),
      'Retain the original ordinary ZIP filename and media type.');
    const {archive,files}=originalArchive(record);
    const byName=new Map(files.map(file=>[file.name,file]));
    const json=name=>{const file=byName.get(name);need(file,'The complete retained package is missing '+name+'.');
      try{return JSON.parse(utf8(file.content));}catch(cause){throw error('The retained '+name+' is not complete JSON.');}};
    for(const name of ['manifest.json','START_HERE.txt','lead-pack.html','leads.csv','leads.json','supporting-files.html','customer-package.json'])
      need(byName.has(name),'The complete retained package is missing '+name+'.');
    need(typeof packageHandover==='function','Receive the maintained customer-edition projection with this retained export.');
    const projected=packageHandover(root,packet),edition=projected.edition,manifest=json('manifest.json'),customerPackage=json('customer-package.json');
    need(hash(json('leads.json'))===hash(edition),'The retained archive has another customer lead edition.');
    const listed=selection.files.map(({document:d})=>({name:d.name,title:d.title,description:d.description,type:d.type,
      bytes:d.bytes,sha256:d.sha256,companies:d.lead_ids.map(id=>selection.edition.leads.find(row=>row.id===id).document.organization),source_url:d.source_url}));
    const expected={version:'dealscout.customer-supporting-package.v1',customer:edition.customer,title:packet.title,
      prepared_at:packet.prepared_at,lead_prepared_at:edition.prepared_at,delivery_type:edition.delivery_type,
      quantity:edition.quantity,currency:edition.currency,price_minor:edition.price_minor,instructions:packet.instructions,files:listed};
    need(hash(customerPackage)===hash(expected),'The retained archive lost the original package instructions or file selection.');
    need(manifest.version==='dealscout.lead-supporting-bundle.v1'&&manifest.customer===edition.customer&&manifest.title===packet.title&&
      manifest.prepared_at===packet.prepared_at&&manifest.delivery_type===edition.delivery_type&&manifest.lead_count===edition.quantity&&
      manifest.currency===edition.currency&&manifest.price_minor===edition.price_minor&&hash(manifest.handover)===hash(projected.handover)&&
      manifest.customer_edition_sha256===byName.get('leads.json').sha256,'The retained archive manifest belongs to another source edition.');
    const actualMembers=files.filter(file=>file.name!=='manifest.json').map(({name,bytes,sha256})=>({name,bytes,sha256}));
    need(hash(manifest.files)===hash(actualMembers)&&files.length===7+selection.files.length,
      'The retained package manifest does not enumerate every original member exactly.');
    for(const {document:d}of selection.files){
      const file=byName.get(d.name);
      need(file&&file.bytes===d.bytes&&file.sha256===d.sha256,'A retained supporting file differs from its selected revision.');
    }
    let html=utf8(byName.get('lead-pack.html').content);
    if(record.html!==undefined)html=utf8(identity(record.html,'HTML export'));
    return {archive,files,manifest,customerPackage,html,customerPackageJSON:utf8(byName.get('customer-package.json').content),
      handover:projected.handover,edition_sha256:packet.edition_sha256};
  }
  function retain(root,input,at,selection,{prepared=false}={}){
    const packet=selection.packet,raw=input.export;
    need(plain(raw),'Supply the complete actual original package export.');
    need(raw.provenance?.kind===(prepared?'prepared':'original-source'),'Use original-source provenance for an existing saved archive.');
    const body={version:VERSION,id:packet.id,pack_id:packet.pack_id,package_id:packet.id,package_sha256:packet.sha256,
      edition_id:packet.edition_id,edition_sha256:packet.edition_sha256,retained_at:at,
      provenance:clone(raw.provenance),archive:clone(raw.archive),...(raw.html===undefined?{}:{html:clone(raw.html)})};
    const record={...body,sha256:hash(body)};
    inspect(record,selection,root);
    const existing=(root.customer_package_exports||[]).find(row=>row.id===record.id);
    if(existing){
      need(existing.archive.sha256===record.archive.sha256&&existing.archive.bytes===record.archive.bytes&&
        hash(existing.html??null)===hash(record.html??null),'This package already retains different original export bytes. Prepare a new package instead.');
      return existing;
    }
    (root.customer_package_exports??=[]).push(record);return record;
  }
  const metadata=record=>record?{status:'retained',sha256:record.sha256,retained_at:record.retained_at,
    provenance:clone(record.provenance),archive:{name:record.archive.name,bytes:record.archive.bytes,sha256:record.archive.sha256}}:
    {status:'legacy-current-renderer',source:'Saved selection; original rendered export bytes have not been received.'};
  return {VERSION,inspect,retain,metadata,utf8,read};
}
module.exports={createPackageRetention};
