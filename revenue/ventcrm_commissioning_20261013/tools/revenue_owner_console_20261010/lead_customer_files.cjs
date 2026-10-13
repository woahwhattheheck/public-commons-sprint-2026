'use strict';
/** Complete customer files and explicit packages over original lead editions. */
function createLeadCustomerFiles({hash,sha256Bytes,utf8ByteLength}){
  const FIELDS=['customer_files','customer_packages'];
  const PACKAGE='dealscout.lead-customer-package.v1';
  const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const issue=(message,status=422,details)=>Object.assign(new Error(message),{status,code:'LEAD_CUSTOMER_FILES',...(details?{details}:{})});
  const need=(value,message,status=422,details)=>{if(!value)throw issue(message,status,details);};
  function text(value,label,max=8000,required=false){
    need(typeof(value??'')==='string',label+' must be text.');
    const result=(value??'').trim();
    need(result.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result),label+' contains unsupported text.');
    need(!required||result,'Enter '+label+'.');utf8ByteLength(result);return result;
  }
  function id(value,label='record ID'){
    const result=text(value,label,160,true);
    need(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result),'Use an ordinary '+label+'.');return result;
  }
  function instant(value,label){
    const result=text(value,label,40,true);
    need(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(result)&&Number.isFinite(Date.parse(result)),label+' needs its original date, time and timezone.');
    return new Date(result).toISOString();
  }
  function digest(value,label){need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),label+' needs its original SHA-256.');return value;}
  function sourceURL(value){
    const result=text(value,'public file source',4000);
    need(!result||/^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:[/?#][^\s<>"'\\]*)?$/i.test(result),'Use the original public HTTP or HTTPS source.');return result;
  }
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function decodeBase64(value){
    need(typeof value==='string'&&value.length%4===0,'Supply complete canonical base64 file bytes.');
    const length=value.length,padding=length?(value.endsWith('==')?2:value.endsWith('=')?1:0):0;
    const bytes=new Uint8Array(length/4*3-padding);
    let offset=0;
    for(let i=0;i<length;i+=4){
      const final=i+4===length,parts=[];
      for(let j=0;j<4;j++){
        const char=value[i+j];
        if(char==='='){need(final&&j>=4-padding,'Keep base64 padding at the end of the file.');parts.push(0);}
        else{const part=alphabet.indexOf(char);need(part>=0,'Supply complete canonical base64 file bytes.');parts.push(part);}
      }
      if(final&&padding===2)need((parts[1]&15)===0,'The file has noncanonical base64 padding.');
      if(final&&padding===1)need((parts[2]&3)===0,'The file has noncanonical base64 padding.');
      const word=(parts[0]<<18)|(parts[1]<<12)|(parts[2]<<6)|parts[3];
      if(offset<bytes.length)bytes[offset++]=(word>>>16)&255;
      if(offset<bytes.length)bytes[offset++]=(word>>>8)&255;
      if(offset<bytes.length)bytes[offset++]=word&255;
    }
    return bytes;
  }
  // Exact base64 strings are immutable. Reuse only their already verified byte
  // identities; keep this process cache smaller than one original save request.
  const byteIdentities=new Map();let cachedCharacters=0;
  function fileIdentity(content){
    const saved=byteIdentities.get(content);if(saved)return saved;
    const identity=Object.freeze(sha256Bytes(decodeBase64(content)));
    if(content.length<=1024*1024){
      while(byteIdentities.size&&(byteIdentities.size>=128||cachedCharacters+content.length>4*1024*1024)){
        const first=byteIdentities.keys().next().value;cachedCharacters-=first.length;byteIdentities.delete(first);
      }
      byteIdentities.set(content,identity);cachedCharacters+=content.length;
    }
    return identity;
  }
  function normalizeFile(input){
    need(plain(input),'Supply the complete customer file.');
    const name=text(input.name,'relative customer filename',240,true);
    need(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)&&!name.split('/').some(part=>!part||part==='.'||part==='..'),
      'Use an ordinary relative filename without parent or empty path segments.');
    need(name.split('/').every(part=>!/[. ]$/.test(part)&&!/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)),
      'Use a filename that the customer can extract on ordinary desktop systems.');
    const type=text(input.type||'application/octet-stream','file media type',160,true).toLowerCase();
    need(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type),'Use the file media type without header parameters.');
    need(Array.isArray(input.lead_ids),'Select the complete file scope; an empty lead list means common customer instructions.');
    const leadIds=input.lead_ids.map(value=>id(value,'file lead ID'));
    need(new Set(leadIds).size===leadIds.length,'List each original lead once in the file scope.');
    const identity=fileIdentity(input.content_base64);
    need(input.bytes===identity.bytes&&input.sha256===identity.sha256,'The file bytes differ from their original length or SHA-256.');
    return {name,title:text(input.title,'customer file title',300,true),
      description:text(input.description,'customer file description',8000,true),type,
      lead_ids:leadIds,source_url:sourceURL(input.source_url),
      content_base64:input.content_base64,bytes:identity.bytes,sha256:identity.sha256};
  }
  function versions(row){return [...row.history,{revision:row.revision,document:row.document,sha256:row.sha256,updated_at:row.updated_at}];}
  function version(root,reference,packId){
    need(plain(reference),'Select a complete saved file revision.');
    id(reference.id,'customer file ID');
    need(Number.isSafeInteger(reference.revision)&&reference.revision>0,'Select the original file revision.');
    digest(reference.sha256,'The saved file revision');
    const row=(root.customer_files||[]).find(value=>value.id===reference.id);
    need(row&&row.pack_id===packId,'The selected file belongs to another or missing customer brief.');
    const selected=versions(row).find(value=>value.revision===reference.revision);
    need(selected&&selected.sha256===reference.sha256,'Receive the complete original file history before selecting this revision.');
    return {id:row.id,pack_id:row.pack_id,...selected};
  }
  function edition(root,editionId,packId){
    const selected=root.editions.find(row=>row.id===editionId);
    need(selected&&selected.pack_id===packId,'Select the original lead edition from this customer brief.');return selected;
  }
  function eligible(document,selected){
    return document.lead_ids.every(leadId=>selected.leads.some(row=>row.id===leadId));
  }
  function selectedFiles(root,packet){
    const selected=edition(root,packet.edition_id,packet.pack_id),names=new Set(['manifest.json','start_here.txt','lead-pack.html','leads.csv','leads.json','supporting-files.html','customer-package.json']),files=[];
    need(selected.sha256===packet.edition_sha256,'The customer package lost its original lead edition.');
    for(const reference of packet.files){
      const row=version(root,reference,packet.pack_id),name=row.document.name.toLowerCase();
      need(Date.parse(row.updated_at)<=Date.parse(packet.prepared_at),'The selected file revision was saved after this package.');
      need(eligible(row.document,selected),'A selected file contains a lead outside this customer edition.',422,
        {file_id:row.id,filename:row.document.name,lead_ids:row.document.lead_ids,edition_id:selected.id});
      need(!names.has(name),'A selected filename duplicates another file or an original generated customer document. Retain the file under its intended supporting path.');
      for(const other of names)need(!name.startsWith(other+'/')&&!other.startsWith(name+'/'),
        'A selected filename is also another selected file’s parent directory.');
      names.add(name);files.push(row);
    }
    return files;
  }
  function validate(root){
    for(const key of FIELDS){
      need(root[key]===undefined||Array.isArray(root[key]),'Keep the complete '+key+' list.');
      const rows=root[key]||[];
      need(new Set(rows.map(row=>row.id)).size===rows.length,'The '+key+' list repeats a saved identity.');
      for(const row of rows){need(plain(row),'Keep complete saved customer file records.');id(row.id);}
    }
    for(const row of root.customer_files||[]){
      need(root.packs.some(pack=>pack.id===row.pack_id),'A customer file lost its original brief.');
      need(Number.isSafeInteger(row.revision)&&row.revision>0&&Array.isArray(row.history)&&row.history.length===row.revision-1,
        'Keep the complete original file revision history.');
      for(const [index,saved]of versions(row).entries()){
        need(saved.revision===index+1&&saved.sha256===hash(saved.document)&&hash(normalizeFile(saved.document))===saved.sha256,
          'A saved customer file revision changed.');
        instant(saved.updated_at,'file revision time');
        need(saved.document.lead_ids.every(leadId=>root.leads.some(lead=>lead.id===leadId&&lead.pack_id===row.pack_id)),
          'A file scope lost its original lead.');
      }
    }
    const successors=new Map();
    for(const packet of root.customer_packages||[]){
      const {sha256,...document}=packet;
      need(packet.version===PACKAGE&&sha256===hash(document),'The complete customer package changed.');
      id(packet.pack_id,'customer pack ID');id(packet.edition_id,'lead edition ID');
      text(packet.title,'customer package title',300,true);text(packet.instructions,'customer instructions',16000,true);
      instant(packet.prepared_at,'customer package preparation time');digest(packet.edition_sha256,'The original lead edition');
      need(Array.isArray(packet.files)&&packet.files.length&&new Set(packet.files.map(row=>row.id)).size===packet.files.length,
        'Select distinct complete supporting files for the customer package.');
      const selected=edition(root,packet.edition_id,packet.pack_id);
      need(Date.parse(packet.prepared_at)>=Date.parse(selected.prepared_at),'The package precedes its original lead edition.');
      selectedFiles(root,packet);
      if(packet.supersedes){
        const previous=(root.customer_packages||[]).find(row=>row.id===packet.supersedes);
        need(previous&&previous.pack_id===packet.pack_id&&Date.parse(previous.prepared_at)<=Date.parse(packet.prepared_at),
          'Keep the earlier complete package with this same customer.');
        // Continue the exact lead edition or its actual replacement ancestry.
        let current=selected;const seen=new Set();
        while(current&&current.id!==previous.edition_id){
          need(!seen.has(current.id),'The original replacement history contains a cycle.');
          seen.add(current.id);current=root.editions.find(row=>row.id===current.replaces);
        }
        need(current,'A package successor must retain this lead edition or its original replacement ancestry.');
        need(!successors.has(previous.id),'Two customer packages replace the same earlier package.');
        successors.set(previous.id,packet.id);text(packet.reason,'package revision reason',4000,true);
      }else need(!packet.reason,'Keep a revision reason with its selected earlier package.');
    }
    for(const packet of root.customer_packages||[]){
      const seen=new Set();let current=packet;
      while(current?.supersedes){
        need(!seen.has(current.id),'The customer package history contains a cycle.');
        seen.add(current.id);current=(root.customer_packages||[]).find(row=>row.id===current.supersedes);
      }
    }
    for(const delivery of root.deliveries||[]){
      if(delivery.customer_package_id===undefined&&delivery.customer_package_sha256===undefined)continue;
      const packet=(root.customer_packages||[]).find(row=>row.id===delivery.customer_package_id);
      need(packet&&packet.edition_id===delivery.edition_id&&packet.sha256===delivery.customer_package_sha256,
        'The delivery lost its complete original customer package.');
      need(Date.parse(delivery.delivered_at)>=Date.parse(packet.prepared_at),'The delivery precedes its selected customer package.');
    }
  }
  function apply(root,kind,input,at){
    const packId=id(input.pack_id,'customer pack ID');
    need(root.packs.some(row=>row.id===packId),'Save the original customer brief first.');
    if(kind==='customer-files-save'){
      need(Array.isArray(input.files)&&input.files.length,'Supply the complete customer files.');
      need(new Set(input.files.map(row=>row.id)).size===input.files.length,'Use distinct original file IDs.');
      const result=[];root.customer_files??=[];
      for(const item of input.files){
        const fileId=id(item.id,'customer file ID'),document=normalizeFile(item.document??item);
        need(document.lead_ids.every(leadId=>root.leads.some(row=>row.id===leadId&&row.pack_id===packId)),
          'Select original leads from this customer brief for the file scope.');
        const previous=root.customer_files.find(row=>row.id===fileId);
        need(!previous||previous.pack_id===packId,'This file ID belongs to another customer.',409);
        need(!previous||Date.parse(at)>=Date.parse(previous.updated_at),'The file revision precedes its retained history.');
        const sha256=hash(document);
        if(previous?.sha256===sha256){result.push({id:fileId,revision:previous.revision,sha256});continue;}
        const saved={id:fileId,pack_id:packId,revision:(previous?.revision||0)+1,document,sha256,updated_at:at,
          history:previous?versions(previous):[]};
        if(previous)root.customer_files[root.customer_files.indexOf(previous)]=saved;else root.customer_files.push(saved);
        result.push({id:fileId,revision:saved.revision,sha256});
      }
      return {pack_id:packId,file_ids:result.map(row=>row.id),file_revisions:result};
    }
    need(kind==='customer-package-prepare','Choose a supported customer file operation.');
    const packetId=id(input.id,'customer package ID');
    need(!(root.customer_packages||[]).some(row=>row.id===packetId),'That customer package ID already exists.',409);
    const selected=edition(root,id(input.edition_id,'lead edition ID'),packId);
    need(!root.withdrawals.some(row=>row.edition_id===selected.id),'Select an active original lead edition.');
    need(Array.isArray(input.files)&&input.files.length,'Select complete saved file revisions.');
    const files=input.files.map(reference=>{
      const row=version(root,reference,packId);return {id:row.id,revision:row.revision,sha256:row.sha256};
    });
    const document={version:PACKAGE,id:packetId,pack_id:packId,edition_id:selected.id,edition_sha256:selected.sha256,
      title:text(input.title,'customer package title',300,true),instructions:text(input.instructions,'customer instructions',16000,true),
      prepared_at:at,files,supersedes:input.supersedes?id(input.supersedes,'earlier customer package ID'):'',
      reason:text(input.reason,'package revision reason',4000)};
    const packet={...document,sha256:hash(document)};
    (root.customer_packages??=[]).push(packet);validate(root);
    return {pack_id:packId,edition_id:selected.id,customer_package_id:packet.id,customer_package_sha256:packet.sha256,
      file_count:files.length,file_bytes:selectedFiles(root,packet).reduce((sum,row)=>sum+row.document.bytes,0)};
  }
  function forPack(root,packId){
    return Object.fromEntries(FIELDS.filter(key=>root[key]!==undefined).map(key=>[key,clone(root[key].filter(row=>row.pack_id===packId))]));
  }
  function merge(root,bundle,report){
    if(bundle.customer_files!==undefined){
      root.customer_files??=[];
      report.added.customer_files??=0;report.advanced.customer_files??=0;
      for(const incoming of bundle.customer_files){
        const current=root.customer_files.find(row=>row.id===incoming.id);
        const record=action=>report.records.push({entity:'customer_files',id:incoming.id,name:incoming.document.title,action,revision:incoming.revision});
        if(!current){root.customer_files.push(clone(incoming));report.added.customer_files++;record('add');continue;}
        if(current.pack_id!==incoming.pack_id){report.conflicts.push({entity:'customer_files',id:incoming.id,reason:'The file identity belongs to another customer.'});continue;}
        const left=versions(current),right=versions(incoming),diverged=left.findIndex((row,index)=>index<right.length&&hash(row)!==hash(right[index]));
        if(diverged!==-1){report.conflicts.push({entity:'customer_files',id:incoming.id,reason:'The file copies differ at revision '+(diverged+1)+'.',local_revision:current.revision,incoming_revision:incoming.revision});continue;}
        if(right.length>left.length){root.customer_files[root.customer_files.indexOf(current)]=clone(incoming);report.advanced.customer_files++;record('advance');}
        else if(right.length<left.length){report.kept_current++;record('keep_current');}
        else{report.unchanged++;record('unchanged');}
      }
    }
    if(bundle.customer_packages!==undefined){
      root.customer_packages??=[];report.added.customer_packages??=0;
      for(const packet of bundle.customer_packages){
        const current=root.customer_packages.find(row=>row.id===packet.id);
        if(!current){root.customer_packages.push(clone(packet));report.added.customer_packages++;report.records.push({entity:'customer_packages',id:packet.id,name:packet.title,action:'add'});}
        else if(hash(current)!==hash(packet))report.conflicts.push({entity:'customer_packages',id:packet.id,reason:'The same prepared customer package contains different complete files.'});
        else report.unchanged++;
      }
    }
    try{validate(root);}catch(error){report.conflicts.push({entity:'customer_packages',id:bundle.pack.id,reason:error.message});}
  }
  function metadata(row){
    const {content_base64,...document}=row.document;
    return {id:row.id,pack_id:row.pack_id,revision:row.revision,sha256:row.sha256,updated_at:row.updated_at,document};
  }
  function view(root,packId){
    return {files:(root.customer_files||[]).filter(row=>row.pack_id===packId).map(row=>({...metadata(row),
      history:row.history.map(saved=>metadata({id:row.id,pack_id:row.pack_id,...saved}))})),
      packages:(root.customer_packages||[]).filter(row=>row.pack_id===packId).map(packet=>({...clone(packet),
        files:selectedFiles(root,packet).map(metadata),successor_id:(root.customer_packages||[]).find(row=>row.supersedes===packet.id)?.id||''}))};
  }
  function packageSelection(root,packetId,packId=''){
    const packet=(root.customer_packages||[]).find(row=>row.id===packetId);
    need(packet&&(!packId||packet.pack_id===packId),'Select the complete customer package from this brief.',404);
    return {packet:clone(packet),edition:edition(root,packet.edition_id,packet.pack_id),files:selectedFiles(root,packet)};
  }
  function deliveryFields(root,input,editionId,deliveredAt){
    if(!input.customer_package_id)return {};
    const {packet}=packageSelection(root,id(input.customer_package_id,'customer package ID'));
    need(packet.edition_id===editionId,'Keep the delivery with this original lead edition and its selected package.');
    need(Date.parse(deliveredAt)>=Date.parse(packet.prepared_at),'The delivery precedes its selected customer package.');
    return {customer_package_id:packet.id,customer_package_sha256:packet.sha256};
  }
  return {FIELDS,PACKAGE,normalizeFile,decodeBase64,validate,apply,forPack,merge,view,packageSelection,version,deliveryFields};
}
module.exports={createLeadCustomerFiles};
