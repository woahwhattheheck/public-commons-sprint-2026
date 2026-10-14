/** Email document preparation over an immutable complete customer package. */
import hashes from '../../host/connected_sha256.cjs';
import valueMessage from './lead_value_message_core.cjs';
import attachments from '../../host/connected_contact_attachments.cjs';
import {leadCustomerFileArchive} from './lead_fulfillment_bundle.mjs';

const {reviewGmailAttachment,CONTACT_ATTACHMENT_LIMIT_BYTES,CONTACT_ATTACHMENT_COUNT}=attachments;
const json=value=>JSON.stringify(value,null,2)+'\n';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const issue=(status,message)=>Object.assign(new Error(message),{status,code:'LEAD_CUSTOMER_MAIL'});
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const types={txt:'text/plain',md:'text/markdown',csv:'text/csv',json:'application/json',html:'text/html',htm:'text/html',
  pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',svg:'image/svg+xml',zip:'application/zip',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
const bytes=content=>typeof content==='string'?new Uint8Array(Buffer.from(content,'utf8')):new Uint8Array(content);
const type=name=>types[name.split('.').at(-1).toLowerCase()]||'application/octet-stream';
const stem=prepared=>(prepared.customerPackage.customer+' '+prepared.packet.title).normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100)||'Customer-package';
const textFile=(name,content)=>({name,content,...hashes.sha256Utf8(content)});
const href=name=>name.split('/').map(encodeURIComponent).join('/');
export function leadCustomerPackageMembers(prepared){
  const names=new Set();
  return prepared.files.map(file=>{
    if(typeof file.name!=='string'||!file.name||names.has(file.name))throw issue(422,'The complete package must retain one original member for each filename.');
    names.add(file.name);
    const content=bytes(file.content),identity=hashes.sha256Bytes(content);
    if(identity.bytes!==file.bytes||identity.sha256!==file.sha256)throw issue(409,'Reopen the complete original bytes for '+file.name+'.');
    const supporting=prepared.customerPackage.files.find(row=>row.name===file.name);
    return {name:file.name,type:supporting?.type||type(file.name),content,...identity};
  });
}
const label=review=>review.decision==='GMAIL_FILENAME_OR_ENCRYPTION_MATCH'?'Published filename or encryption match':
  review.decision==='ARCHIVE_REVIEW_INCOMPLETE'?'Archive contents need further review':'No published filename match';
const details=review=>[...review.findings.map(row=>row.path+': '+(row.extension?row.extension:row.kind.replaceAll('_',' '))),
  ...review.uninspected_archives.map(row=>row.path+': '+row.reason)].join('\n');
export function leadCustomerMailReview(prepared){
  const files=leadCustomerPackageMembers(prepared);
  const members=files.map(file=>{
    const review=reviewGmailAttachment({filename:file.name,data:file.content});
    return {name:file.name,type:file.type,bytes:file.bytes,sha256:file.sha256,review,
      ordinary_document:review.decision==='NO_PUBLISHED_FILENAME_MATCH'};
  });
  const archive=leadCustomerFileArchive(files);
  const archiveName=stem(prepared)+'-'+prepared.packet.prepared_at.slice(0,10)+'-'+prepared.packet.sha256.slice(0,10)+'.zip';
  return {version:'dealscout.customer-mail-review.v1',
    customer:prepared.customerPackage.customer,title:prepared.packet.title,pack_id:prepared.packet.pack_id,
    package_id:prepared.packet.id,customer_package_sha256:prepared.packet.sha256,
    edition_id:prepared.packet.edition_id,edition_sha256:prepared.edition_sha256,
    prepared_at:prepared.packet.prepared_at,
    complete_package:{name:archiveName,type:'application/zip',...hashes.sha256Bytes(archive),
      review:reviewGmailAttachment({filename:archiveName,data:archive})},
    members,limits:{individual_attachment_bytes:CONTACT_ATTACHMENT_LIMIT_BYTES,
      combined_attachment_bytes:CONTACT_ATTACHMENT_LIMIT_BYTES,attachment_count:CONTACT_ATTACHMENT_COUNT},
    interpretation:'The original Gmail filename and archive rules are assessed. The receiving mail provider decides acceptance. Keep the complete package for all project files and relative dependencies.'};
}
function selectedMembers(review,names){
  if(typeof names==='string'){try{names=JSON.parse(names);}catch{throw issue(422,'Use a JSON array of exact original member names.');}}
  if(!Array.isArray(names)||!names.length||names.some(name=>typeof name!=='string')||new Set(names).size!==names.length)
    throw issue(422,'Select each exact original document once.');
  const lookup=new Map(review.members.map(row=>[row.name,row]));
  return names.map(name=>{
    const member=lookup.get(name);if(!member)throw issue(404,'The selected member is absent from this complete package: '+name);
    if(!member.ordinary_document)throw issue(422,'Review '+name+' through its original complete-file route; its mail filename/archive finding remains unresolved.');
    return member;
  });
}
function page(title,body){
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title>'+
    '<style>body{font:16px/1.5 system-ui,sans-serif;color:#171717;background:#fff;max-width:1100px;margin:2rem auto;padding:0 1rem}a{color:#202020}table{border-collapse:collapse;width:100%}th,td{vertical-align:top;text-align:left;border-bottom:1px solid #bbb;padding:.65rem}code,small{overflow-wrap:anywhere}pre{white-space:pre-wrap}h1,h2{line-height:1.2}@media print{body{font-size:10pt;max-width:none;margin:0}tr{break-inside:avoid}}</style></head><body>'+body+'</body></html>';
}
export function renderLeadCustomerMailReview(review){
  return page(review.customer+' — package attachment review','<h1>'+esc(review.customer)+'</h1><h2>'+esc(review.title)+'</h2>'+
    '<p>'+esc(review.interpretation)+'</p><p>Complete ZIP: '+esc(label(review.complete_package.review))+'</p>'+
    '<pre>'+esc(details(review.complete_package.review))+'</pre><table><thead><tr><th>Original member</th><th>Complete bytes</th><th>Mail review</th></tr></thead><tbody>'+
    review.members.map(row=>'<tr><td>'+esc(row.name)+'<br><small>'+esc(row.type)+'</small></td><td>'+row.bytes.toLocaleString('en')+
      '</td><td>'+esc(label(row.review))+'<pre>'+esc(details(row.review))+'</pre></td></tr>').join('')+'</tbody></table>'+
    '<p>Explicit document selection keeps these exact original filenames and contents. The original full package continues to carry all project dependencies.</p>');
}
function selectionPage(review,members,excluded){
  return page(review.customer+' — selected email documents','<h1>'+esc(review.customer)+'</h1><h2>'+esc(review.title)+' — selected email documents</h2>'+
    '<p>This selection contains '+members.length+' original documents from the complete customer package. The complete package remains the source for all other project files and relative dependencies.</p>'+
    '<table><thead><tr><th>Selected document</th><th>Original bytes</th></tr></thead><tbody>'+
    members.map(row=>'<tr><td><a href="'+esc(href(row.name))+'">'+esc(row.name)+'</a></td><td>'+row.bytes.toLocaleString('en')+'</td></tr>').join('')+'</tbody></table>'+
    '<h2>Other files in the complete package</h2><ul>'+excluded.map(row=>'<li>'+esc(row.name)+' — '+esc(label(row.review))+'</li>').join('')+'</ul>');
}
export function leadCustomerMailSelection(prepared,{memberNames=[]}={}){
  const review=leadCustomerMailReview(prepared),members=selectedMembers(review,memberNames);
  const originalsByName=new Map(leadCustomerPackageMembers(prepared).map(row=>[row.name,row]));
  const selected=members.map(row=>originalsByName.get(row.name)),names=new Set(members.map(row=>row.name));
  const excluded=review.members.filter(row=>!names.has(row.name));
  const selectedBytes=selected.reduce((sum,row)=>sum+row.bytes,0);
  const record={version:'dealscout.customer-mail-selection.v1',
    customer:review.customer,title:review.title,pack_id:review.pack_id,package_id:review.package_id,
    customer_package_sha256:review.customer_package_sha256,edition_id:review.edition_id,edition_sha256:review.edition_sha256,
    complete_package:review.complete_package,
    selected_members:selected.map(row=>({name:row.name,type:row.type,bytes:row.bytes,sha256:row.sha256,
      content_base64:Buffer.from(row.content).toString('base64')})),
    other_members:excluded,selected_bytes:selectedBytes,
    individual_attachments_within_existing_limits:members.length<=CONTACT_ATTACHMENT_COUNT&&selectedBytes<=CONTACT_ATTACHMENT_LIMIT_BYTES,
    limits:review.limits,interpretation:review.interpretation};
  // A dedicated, collision-free index name preserves all customer filenames.
  let indexName='EMAIL_DOCUMENTS.html',manifestName='email-document-selection.json',suffix=1;
  while(names.has(indexName)||names.has(manifestName)){indexName='EMAIL_DOCUMENTS-'+suffix+'.html';manifestName='email-document-selection-'+suffix+'.json';suffix++;}
  const html=selectionPage(review,members,excluded);
  const files=[textFile(indexName,html),textFile(manifestName,json({...record,selected_members:members.map(({review,ordinary_document,...row})=>row)})),...selected];
  const archive=leadCustomerFileArchive(files);
  const archiveName=stem(prepared)+'-email-documents-'+hashes.sha256Utf8(json(members.map(row=>({name:row.name,sha256:row.sha256})))).sha256.slice(0,12)+'.zip';
  const archiveReview=reviewGmailAttachment({filename:archiveName,data:archive});
  return {review,record,files,archive,archiveName,archiveReview,html,
    archive_within_existing_limit:archive.length<=CONTACT_ATTACHMENT_LIMIT_BYTES};
}
/** Complete unsent body from one exact customer JSON already in this package. */
export function leadCustomerValueMessage(prepared,{recipe,memberName='leads.json'}={}){
  if(memberName!=='leads.json')throw issue(422,'Select the maintained leads.json from this complete customer package.');
  const member=leadCustomerPackageMembers(prepared).find(row=>row.name===memberName);
  if(!member)throw issue(404,'Select the exact customer JSON in the original package.');
  if(prepared.manifest?.customer_edition_sha256!==member.sha256)throw issue(409,'The selected JSON is not this package\'s original customer edition.');
  const editionText=Buffer.from(member.content).toString('utf8');
  if(!Buffer.from(editionText,'utf8').equals(Buffer.from(member.content)))throw issue(422,'The original customer JSON is not well-formed UTF-8.');
  const composer=valueMessage.createLeadValueMessage(hashes);
  const record=composer.compose({editionText,recipe});
  if(['customer','delivery_type','quantity','currency','price_minor'].some(key=>record.source[key]!==prepared.customerPackage[key]))throw issue(409,'The message belongs to another selected customer package.');
  return {record,files:composer.files(record),member_name:member.name,customer_package_sha256:prepared.packet.sha256,edition_sha256:prepared.edition_sha256};
}
/** Reopen a full selection against its exact original immutable package. */
export function receiveLeadCustomerMailSelection(prepared,record){
  if(record?.version!=='dealscout.customer-mail-selection.v1'||record.package_id!==prepared.packet.id||
    record.pack_id!==prepared.packet.pack_id||record.customer_package_sha256!==prepared.packet.sha256||
    record.edition_id!==prepared.packet.edition_id||record.edition_sha256!==prepared.edition_sha256||
    !Array.isArray(record.selected_members))throw issue(409,'Reopen this selection with its original saved customer package.');
  const result=leadCustomerMailSelection(prepared,{memberNames:record.selected_members.map(row=>row.name)});
  if(json(canonical(result.record))!==json(canonical(record)))throw issue(409,'The complete retained selection differs from the original package members.');
  return result;
}
export function leadCustomerMailExportFromDocuments(prepared,{format='customer-mail-review',memberName='',memberSha256='',memberNames=[],selectionRecord=null,messageRecipe=null}={}){
  let content,name,mimeType;
  if(['customer-value-message','customer-value-message-text','customer-value-message-html'].includes(format)){
    const result=leadCustomerValueMessage(prepared,{recipe:messageRecipe,memberName:memberName||'leads.json'});
    const selected=format==='customer-value-message'?result.files.find(f=>f.path==='prepared-message.json'):result.files.find(f=>f.path===(format.endsWith('-text')?'message.txt':'message.html'));
    return {name:stem(prepared)+'-'+selected.path,type:format==='customer-value-message'?'application/json; charset=utf-8':format.endsWith('-text')?'text/plain; charset=utf-8':'text/html; charset=utf-8',
      content:selected.content,bytes:selected.bytes,sha256:selected.sha256,state:'PREPARED_UNSENT',customer_package_sha256:result.customer_package_sha256,edition_sha256:result.edition_sha256};
  }
  if(format==='customer-package-member'){
    const original=leadCustomerPackageMembers(prepared).find(row=>row.name===memberName);
    if(!original)throw issue(404,'Choose an exact original member from this customer package.');
    if(memberSha256&&memberSha256!==original.sha256)throw issue(409,'The selected member differs from the original saved download.');
    return {name:original.name.split('/').at(-1),member_name:original.name,type:original.type,content:original.content,
      bytes:original.bytes,sha256:original.sha256,customer_package_sha256:prepared.packet.sha256,edition_sha256:prepared.edition_sha256};
  }
  if(format==='customer-mail-review'||format==='customer-mail-review-html'){
    const review=leadCustomerMailReview(prepared);
    content=format==='customer-mail-review'?json(review):renderLeadCustomerMailReview(review);
    name=stem(prepared)+'-attachment-review.'+(format==='customer-mail-review'?'json':'html');
    mimeType=format==='customer-mail-review'?'application/json; charset=utf-8':'text/html; charset=utf-8';
  }else{
    const selected=selectionRecord?receiveLeadCustomerMailSelection(prepared,selectionRecord):leadCustomerMailSelection(prepared,{memberNames});
    if(format==='customer-mail-selection'){content=json(selected.record);name=stem(prepared)+'-email-selection.json';mimeType='application/json; charset=utf-8';}
    else if(format==='customer-mail-zip'){content=selected.archive;name=selected.archiveName;mimeType='application/zip';}
    else throw issue(422,'Choose a package review, exact member, complete selection record or selected-document ZIP.');
  }
  return {name,type:mimeType,content,...(typeof content==='string'?hashes.sha256Utf8(content):hashes.sha256Bytes(content)),
    customer_package_sha256:prepared.packet.sha256,edition_sha256:prepared.edition_sha256};
}
