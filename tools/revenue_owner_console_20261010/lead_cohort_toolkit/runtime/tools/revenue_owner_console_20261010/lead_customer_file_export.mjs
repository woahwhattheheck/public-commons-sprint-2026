/** Complete supporting packages over the original customer documents and ZIP writer. */
import core from './lead_fulfillment_core.cjs';
import hashes from '../../host/connected_sha256.cjs';
import {leadCustomerMailExportFromDocuments} from './lead_customer_mail.mjs';
import model from './lead_customer_files.cjs';
import retentionCore from './lead_customer_package_retention.cjs';
import Zip from '../../host/connected_zip.cjs';
import {leadPackCustomerDocuments,leadCustomerFileArchive} from './lead_fulfillment_bundle.mjs';

const filesModel=model.createLeadCustomerFiles({hash:core.hash,...hashes});
const retention=retentionCore.createPackageRetention({hash:core.hash,decodeBase64:filesModel.decodeBase64});
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=value=>JSON.stringify(value,null,2)+'\n';
const date=value=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value));
const textFile=(name,content)=>({name,content,...hashes.sha256Utf8(content)});
const filename=title=>(title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,100)||'Customer-package');
function customerFiles(selection){
  return selection.files.map(row=>{
    const d=row.document;
    return {name:d.name,title:d.title,description:d.description,type:d.type,bytes:d.bytes,sha256:d.sha256,
      companies:d.lead_ids.map(leadId=>selection.edition.leads.find(lead=>lead.id===leadId).document.organization),
      source_url:d.source_url};
  });
}
function supportingHTML(packet,files,{archive=false}={}){
  return '<section class="summary"><h2>'+esc(packet.title)+'</h2><p>Complete customer package prepared '+esc(date(packet.prepared_at))+'.</p>'+
    '<p>'+esc(packet.instructions).replace(/\n/g,'<br>')+'</p><h3>Supporting files</h3>'+
    '<p>Extract the complete ZIP to keep the documents and their relative links together.</p>'+
    '<table><thead><tr><th>File</th><th>For</th><th>Use</th></tr></thead><tbody>'+
    files.map(row=>'<tr><td>'+(archive?'<a href="'+esc(row.name.split('/').map(encodeURIComponent).join('/'))+'">'+esc(row.title)+'</a>':esc(row.title))+
      '<br><small>'+esc(row.name)+' · '+esc(row.type)+' · '+esc(row.bytes.toLocaleString('en'))+' bytes</small></td>'+
      '<td>'+esc(row.companies.length?row.companies.join('; '):'Common customer instructions')+'</td>'+
      '<td>'+esc(row.description)+(row.source_url?'<br><a href="'+esc(row.source_url)+'">Original source</a>':'')+'</td></tr>').join('')+
    '</tbody></table></section>';
}
function indexHTML(customer,packet,files){
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+esc(packet.title)+' · supporting files</title><style>#lead-supporting-report,#lead-supporting-report *{box-sizing:border-box}#lead-supporting-report{color-scheme:light;font:16px/1.5 system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#171717;background:#fff}#lead-supporting-report :is(h1,h2,h3,p,small,th,td,strong,span){color:#171717}#lead-supporting-report :is(header,section,table,tbody,tr){color:#171717;background:#fff}#lead-supporting-report a{color:#202020;overflow-wrap:anywhere}#lead-supporting-report a:focus-visible{outline:2px solid #333;outline-offset:3px}#lead-supporting-report table{border-collapse:collapse;width:100%}#lead-supporting-report th,#lead-supporting-report td{text-align:left;vertical-align:top;border-bottom:1px solid #bbb;padding:.7rem}#lead-supporting-report thead,#lead-supporting-report th{color:#171717;background:#f4f4f4}#lead-supporting-report small{overflow-wrap:anywhere}#lead-supporting-report h1,#lead-supporting-report h2,#lead-supporting-report h3{line-height:1.2}@media(max-width:650px){#lead-supporting-report table,#lead-supporting-report thead,#lead-supporting-report tbody,#lead-supporting-report tr,#lead-supporting-report th,#lead-supporting-report td{display:block}#lead-supporting-report thead{position:absolute;left:-9999px}#lead-supporting-report tr{border-bottom:1px solid #777}#lead-supporting-report td{border:0;padding:.4rem}}@media print{#lead-supporting-report{max-width:none;margin:0;font-size:10pt}#lead-supporting-report tr{break-inside:avoid}}</style></head><body><main id="lead-supporting-report">'+
    '<header><h1>'+esc(customer)+'</h1><p><a href="lead-pack.html">Open the complete lead pack</a></p></header>'+
    supportingHTML(packet,files,{archive:true})+'</main></body></html>';
}
export function leadCustomerPackageDocuments(ledger,{packId,packageId}={}){
  const selection=core.leadCustomerPackageSelection(ledger,packageId,packId),{packet}=selection;
  if(selection.retained_export)return leadCustomerPackageDocumentsFromSelection(selection);
  const base=leadPackCustomerDocuments(ledger,{packId:packet.pack_id,editionId:packet.edition_id});
  return leadCustomerPackageDocumentsFromSelection(selection,base);
}
/** Render the original package from an already validated, detached saved selection. */
export function leadCustomerPackageDocumentsFromSelection(selection,base){
  const {packet}=selection;
  if(selection.retained_export){
    const saved=selection.retained_export,original=retention.read(saved);
    return {...original,packet,edition_sha256:packet.edition_sha256,retained_export:saved,
      archive_name:saved.archive.name,export_provenance:retention.metadata(saved)};
  }
  const listed=customerFiles(selection),table=supportingHTML(packet,listed,{archive:true});
  const plainTable=supportingHTML(packet,listed);
  const originalHTML=base.files.find(row=>row.name==='lead-pack.html').content;
  const files=base.files.map(row=>row.name==='lead-pack.html'?textFile(row.name,originalHTML.replace('</header>',()=>'</header>'+table)):
    row.name==='START_HERE.txt'?textFile(row.name,row.content+'\nSUPPORTING CUSTOMER FILES\n\n'+packet.instructions+
      '\n\nOpen supporting-files.html for the complete file index and each original source.\n'+
      listed.map(file=>file.name+' — '+file.title).join('\n')+'\n'):row);
  files.push(textFile('supporting-files.html',indexHTML(base.edition.customer,packet,listed)));
  const customerPackage={version:'dealscout.customer-supporting-package.v1',customer:base.edition.customer,title:packet.title,
    prepared_at:packet.prepared_at,lead_prepared_at:base.edition.prepared_at,delivery_type:base.edition.delivery_type,
    quantity:base.edition.quantity,currency:base.edition.currency,price_minor:base.edition.price_minor,instructions:packet.instructions,
    files:listed};
  files.push(textFile('customer-package.json',json(customerPackage)));
  for(const row of selection.files){
    const d=row.document,content=filesModel.decodeBase64(d.content_base64);
    files.push({name:d.name,content,bytes:d.bytes,sha256:d.sha256});
  }
  const manifest={version:'dealscout.lead-supporting-bundle.v1',customer:base.edition.customer,title:packet.title,
    prepared_at:packet.prepared_at,delivery_type:base.edition.delivery_type,lead_count:base.edition.quantity,
    currency:base.edition.currency,price_minor:base.edition.price_minor,handover:base.handover,
    customer_edition_sha256:base.files.find(row=>row.name==='leads.json').sha256,
    files:files.map(({name,bytes,sha256})=>({name,bytes,sha256}))};
  return {packet,customerPackage,manifest,files:[textFile('manifest.json',json(manifest)),...files],
    html:originalHTML.replace('</header>',()=>'</header>'+plainTable),edition_sha256:base.edition_sha256,
    export_provenance:retention.metadata(null)};
}
export function leadCustomerPackageExport(ledger,{packId,packageId,format='customer-package-zip',memberName='',memberSha256='',memberNames=[],selectionRecord=null,messageRecipe=null}={}){
  return leadCustomerPackageExportFromDocuments(leadCustomerPackageDocuments(ledger,{packId,packageId}),{format,memberName,memberSha256,memberNames,selectionRecord,messageRecipe});
}
/** Preserve the standard package formats while sharing one complete document set. */
export function leadCustomerPackageExportFromDocuments(prepared,{format='customer-package-zip',memberName='',memberSha256='',memberNames=[],selectionRecord=null,messageRecipe=null}={}){
  if(format.startsWith('customer-mail-')||format.startsWith('customer-value-message')||format==='customer-package-member')return leadCustomerMailExportFromDocuments(prepared,{format,memberName,memberSha256,memberNames,selectionRecord,messageRecipe});
  const {packet}=prepared;
  const stem=filename(prepared.customerPackage.customer+' '+packet.title)+'-'+packet.prepared_at.slice(0,10)+'-'+packet.sha256.slice(0,10);
  let content,type,extension;
  if(format==='customer-package-zip'){
    content=prepared.retained_export?prepared.archive.slice():leadCustomerFileArchive(prepared.files);type='application/zip';extension='zip';
  }else if(format==='customer-package-html'){
    content=prepared.html;type='text/html; charset=utf-8';extension='html';
  }else if(format==='customer-package-json'){
    content=prepared.customerPackageJSON??json(prepared.customerPackage);type='application/json; charset=utf-8';extension='json';
  }else throw Object.assign(new Error('Choose the complete customer package ZIP, HTML or JSON.'),{status:422});
  const identity=typeof content==='string'?hashes.sha256Utf8(content):hashes.sha256Bytes(content);
  return {name:format==='customer-package-zip'&&prepared.retained_export?prepared.archive_name:stem+'.'+extension,type,content,...identity,edition_sha256:prepared.edition_sha256,
    customer_package_sha256:packet.sha256,export_provenance:prepared.export_provenance,
    ...(prepared.retained_export?{customer_package_export_sha256:prepared.retained_export.sha256}:{})};
}
export function leadCustomerSourceFileExport(ledger,{packId,fileId,fileRevision,fileSha256}={}){
  const selected=core.leadCustomerFileSelection(ledger,{packId,id:fileId,revision:Number(fileRevision),sha256:fileSha256});
  return leadCustomerSourceFileFromSelection(selected);
}
export function leadCustomerSourceFileFromSelection(selected){
  const d=selected.document,content=filesModel.decodeBase64(d.content_base64);
  return {name:d.name.split('/').at(-1),type:d.type,content,bytes:d.bytes,sha256:d.sha256,
    file_revision:selected.revision,file_source_sha256:selected.sha256};
}

/** Capture one actual new preparation inside its original workspace transaction. */
export function captureLeadCustomerPackage(ledger,options){
  const prepared=leadCustomerPackageDocuments(ledger,options);
  const archive=leadCustomerPackageExportFromDocuments(prepared,{format:'customer-package-zip'});
  const html=leadCustomerPackageExportFromDocuments(prepared,{format:'customer-package-html'});
  return {provenance:{kind:'prepared',source:'Maintained customer-package-prepare renderer; complete original bytes retained at preparation.'},
    archive:{name:archive.name,type:archive.type,bytes:archive.bytes,sha256:archive.sha256,content_base64:Zip.base64(archive.content)},
    html:{bytes:html.bytes,sha256:html.sha256,content_base64:Zip.base64(Zip.utf8(html.content))}};
}
/** Bind a supplied original archive to the existing package; the model validates every member. */
export function originalLeadCustomerPackageExport({archive,archiveName,source,html}){
  if(!(archive instanceof Uint8Array))throw Object.assign(new Error('Read the complete original customer ZIP bytes.'),{status:422});
  return {provenance:{kind:'original-source',source},
    archive:{name:archiveName,type:'application/zip',...hashes.sha256Bytes(archive),content_base64:Zip.base64(archive)},
    ...(html===undefined?{}:{html:{...hashes.sha256Bytes(typeof html==='string'?Zip.utf8(html):html),
      content_base64:Zip.base64(typeof html==='string'?Zip.utf8(html):html)}})};
}
