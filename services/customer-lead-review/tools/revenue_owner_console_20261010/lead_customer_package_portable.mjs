/** Complete original customer packages for a portable Page or offline opening. */
import hashes from '../../host/connected_sha256.cjs';
import Zip from '../../host/connected_zip.cjs';
import CustomerReview from './lead_customer_review.cjs';
import {mountPortableLeadCustomerReview,CUSTOMER_REVIEW_STYLE} from './lead_customer_review_ui.mjs';
import {compactInlinePayload} from '../../host/connected_inline_payload.mjs';
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail=message=>{throw Object.assign(new Error(message),{status:422,code:'LEAD_PACKAGE_PREVIEW'});};
const mime=name=>({html:'text/html',htm:'text/html',csv:'text/csv',json:'application/json',txt:'text/plain',md:'text/plain',css:'text/css',js:'text/javascript',mjs:'text/javascript',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf'}[name.split('.').at(-1).toLowerCase()]||'application/octet-stream');
/** The original complete-source planner has already received the customer and ZIP manifests. */
export function selectPortableLeadPackages(prepared,{customerKey}={}){
 if(prepared?.version!=='commons.complete-customer-directory.v1'||!Array.isArray(prepared.files))fail('Receive the complete original customer sources first.');
 const matches=prepared.customers.filter(c=>c.key===customerKey);
 if(matches.length!==1)fail('Choose one original customer from the complete source.');
 const customer=matches[0],files=new Map(prepared.files.map(f=>[f.path,f]));
 const exact=(path,bytes,sha256)=>{
  const f=files.get(path);
  if(!f||!(f.content instanceof Uint8Array))fail('The complete original file is missing: '+path);
  const actual=hashes.sha256Bytes(f.content);
  if(actual.bytes!==bytes||actual.sha256!==sha256||f.bytes!==bytes||f.sha256!==sha256)fail('The selected original file changed: '+path);
  return {bytes,sha256,base64:Zip.base64(f.content)};
 };
 return {version:'commons.customer-package-preview.v1',customer:customer.name,customer_key:customer.key,
  packages:customer.packages.map(p=>({
   id:p.package_id,package_sha256:p.package_sha256,edition_id:p.edition_id,title:p.title,
   delivery_type:p.delivery_type,quantity:p.quantity,currency:p.currency,price_minor:p.price_minor,
   prepared_at:p.prepared_at,instructions:p.instructions,
   archive:{name:p.archive_path.split('/').at(-1),type:'application/zip',...exact(p.archive_path,p.archive_bytes,p.archive_sha256)},
   files:p.members.map(m=>{if(!m.path.startsWith(p.directory+'/'))fail('A member leaves its original package.');
    const name=m.path.slice(p.directory.length+1),source=p.files.find(f=>f.path===m.path);
    const original=exact(m.path,m.bytes,m.sha256);
    return {name,title:source?.title||({'lead-pack.html':'Lead pack','supporting-files.html':'Supporting files','START_HERE.txt':'Opening instructions','manifest.json':'Original file manifest','customer-package.json':'Package details','leads.csv':'Lead spreadsheet','leads.json':'Structured leads'}[name]||name),type:source?.type||mime(name),bytes:original.bytes,sha256:original.sha256};
   })
  }))};
}
/** Resolves only members of the selected archive. Fragments keep their original meaning. */
export function resolvePortablePackageLink(from,href,names){
 if(typeof href!=='string'||!href||/[\u0000-\u001f\\]/.test(href))throw new Error('Choose an ordinary package link.');
 const trimmed=href.trim();
 if(/^(https?:|mailto:|tel:)/i.test(trimmed))return {external:true,href:trimmed};
 if(trimmed.startsWith('//')||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)||trimmed.startsWith('/'))throw new Error('That address is outside this package.');
 const hashAt=trimmed.indexOf('#'),fragment=hashAt<0?'':trimmed.slice(hashAt),raw=(hashAt<0?trimmed:trimmed.slice(0,hashAt)).split('?')[0];
 if(!raw)return {name:from,fragment};
 const parts=from.split('/').slice(0,-1);
 for(const encoded of raw.split('/')){const part=decodeURIComponent(encoded);
  if(!part||part==='.')continue;
  if(part==='..'){if(!parts.length)throw new Error('That link leaves the original package.');parts.pop();}
  else{if(/[\/\\:\u0000-\u001f]/.test(part))throw new Error('The package link contains an invalid path.');parts.push(part);}
 }
 const name=parts.join('/');
 if(!names.includes(name))throw new Error('This file is not in the selected package: '+name);
 return {name,fragment};
}
function startPortableLeadPackages(Payload,Bytes,Archive,Hashes,resolveLink,createReview,mountReview){
 'use strict';
 const $=id=>document.getElementById(id),select=$('package'),members=$('member'),frame=$('document'),plain=$('plain'),
  status=$('status'),error=$('error'),back=$('back'),packageLabel=$('package-label'),details=$('details');
 let selected=null,current='',history=[],token='',assetURLs=[],downloadURLs=[],view=0;
 const originalTemplate=document.documentElement.cloneNode(true),originalPayload=JSON.parse(JSON.stringify(Payload));
 let reviewDesk=null;
 const reviewContainer=$('customer-review');
 const embeddedReview=document.getElementById('lead-package-review-state');
 let initialReviews={},reviewStateError=false;try{if(embeddedReview)initialReviews=JSON.parse(embeddedReview.textContent);if(!initialReviews||typeof initialReviews!=='object'||Array.isArray(initialReviews))throw new Error('Invalid saved review state');}catch{reviewStateError=true;reviewContainer.textContent='The saved review state could not be opened. Keep this original file for recovery; original package documents remain available.';}
 const money=p=>{const format=new Intl.NumberFormat('en-US',{style:'currency',currency:p.currency});return format.format(p.price_minor/10**format.resolvedOptions().maximumFractionDigits);};
 const bytes=file=>Bytes.fromBase64(file.base64);
 const message=(value,bad=false)=>{error.hidden=!bad;error.textContent=bad?value:'';status.textContent=bad?'':value;};
 function saveEditablePage(states){
  const dom=originalTemplate.cloneNode(true);
  for(const script of dom.querySelectorAll('script'))script.remove();
  const safeJSON=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const data=document.createElement('script');data.id='lead-package-data';data.type='application/json';data.textContent=safeJSON(originalPayload);dom.querySelector('body').appendChild(data);
  const saved=document.createElement('script');saved.id='lead-package-review-state';saved.type='application/json';saved.textContent=safeJSON(states);dom.querySelector('body').appendChild(saved);
  const application=document.createElement('script');application.textContent=('(()=>{\n'+originalPayload.bootstrap+'\n})();').replace(/<\/script/gi,'<\\/script');dom.querySelector('body').appendChild(application);
  // Serialize complete original payload and executable source once. No saved blob URLs or regenerated package members.
  const html='<!doctype html>\n'+dom.outerHTML;
  const url=URL.createObjectURL(new Blob([html],{type:'text/html'}));downloadURLs.push(url);
  const a=document.createElement('a');a.href=url;a.download=Payload.customer_key+'-editable-review.html';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>{URL.revokeObjectURL(url);downloadURLs=downloadURLs.filter(x=>x!==url);},60000);
 }
 if(reviewContainer&&!reviewStateError&&typeof createReview==='function'&&typeof mountReview==='function'){
  try{reviewDesk=mountReview({container:reviewContainer,model:createReview(Hashes),utf8ByteLength:Hashes.utf8ByteLength,initialStates:initialReviews,saveEditablePage,
   readDocument:pack=>{const file=pack.files.find(f=>f.name==='leads.json');if(!file)return null;if(file.bytes>512*1024)throw new Error('This structured lead selection is too large for a portable review. Keep using its complete original package and contact the sender with your observations.');return JSON.parse(Bytes.utf8Text(Bytes.fromBase64(file.base64)));}});}
  catch(e){reviewContainer.textContent='Review controls could not open: '+e.message+'. Original package documents remain available.';}
 }
 function ready(value){members.disabled=!value;for(const id of ['open-supporting','open-leads','download-zip','download-member'])$(id).disabled=!value;back.disabled=!value||history.length===0;}
 const escaped=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function revoke(){for(const url of assetURLs)URL.revokeObjectURL(url);assetURLs=[];}
 function download(file){
  const url=URL.createObjectURL(new Blob([bytes(file)],{type:file.type}));downloadURLs.push(url);
  const a=document.createElement('a');a.href=url;a.download=file.name.split('/').at(-1);document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>{URL.revokeObjectURL(url);downloadURLs=downloadURLs.filter(x=>x!==url);},60000);
  message('Downloaded '+file.name+'. Keep the complete ZIP together when reopening its files.');
 }
 function scrollFragment(fragment){if(!fragment)return '';return 'try{const id=decodeURIComponent('+JSON.stringify(fragment.slice(1))+');(document.getElementById(id)||document.getElementsByName(id)[0])?.scrollIntoView();}catch{}';}
 function frameHTML(file,fragment){
  const html=Bytes.utf8Text(bytes(file)),dom=new DOMParser().parseFromString(html,'text/html'),names=selected.files.map(f=>f.name);
  // A Page has no original directory. Keep local assets inside this selected archive.
  for(const el of dom.querySelectorAll('[src],link[href]')){
   const attr=el.hasAttribute('src')?'src':'href',value=el.getAttribute(attr);
   if(!value||/^(data:|blob:|https?:|\/\/|#)/i.test(value))continue;
   try{const link=resolveLink(file.name,value,names);if(link.external)continue;const target=selected.files.find(f=>f.name===link.name);
    const url=URL.createObjectURL(new Blob([bytes(target)],{type:target.type}));assetURLs.push(url);el.setAttribute(attr,url+link.fragment);
   }catch{el.removeAttribute(attr);}
  }
  const bridge=document.createElement('script');
  bridge.textContent='document.addEventListener("click",function(e){if(e.defaultPrevented)return;const a=e.target.closest&&e.target.closest("a[href]");if(!a)return;const h=a.getAttribute("href");if(!h||h[0]==="#"||a.hasAttribute("download")&&/^(blob:|data:)/i.test(h))return;if(/^(https?:|mailto:|tel:)/i.test(h)){a.target="_blank";a.rel="noopener noreferrer";return;}e.preventDefault();parent.postMessage({kind:"lead-package-link",token:'+JSON.stringify(token)+',href:h,download:a.hasAttribute("download")},"*");});'+scrollFragment(fragment);
  dom.body.appendChild(bridge);
  return '<!doctype html>\n'+dom.documentElement.outerHTML;
 }
 function open(name,fragment='',remember=true){
  try{
   const file=selected.files.find(f=>f.name===name);if(!file)throw new Error('Choose a file from this package.');
   if(remember&&current&&current!==name)history.push(current);current=name;token=String(++view)+'-'+Math.random().toString(36).slice(2);revoke();
   members.value=name;back.disabled=history.length===0;frame.hidden=true;plain.hidden=true;
   $('download-member').disabled=false;message('Opening '+file.title+'…');
   if(/^(text\/html)/.test(file.type)){
    frame.title=Payload.customer+' — '+file.title;
    const pending=token;frame.onload=()=>{if(token===pending)message(file.title+' · Original '+file.name);};
    frame.srcdoc=frameHTML(file,fragment);frame.hidden=false;
   }else if(file.type.startsWith('image/')){
    const url=URL.createObjectURL(new Blob([bytes(file)],{type:file.type}));assetURLs.push(url);
    frame.srcdoc='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;background:white;color:#202020}img{display:block;max-width:100%;height:auto}</style></head><body><img alt="'+escaped(file.title)+'" src="'+escaped(url)+'"></body></html>';frame.hidden=false;message(file.title);
   }else if(/^(text\/|application\/json)/.test(file.type)){
    frame.removeAttribute('srcdoc');plain.textContent=Bytes.utf8Text(bytes(file));plain.hidden=false;message(file.title+' · Download the original file to edit and reopen it.');
   }else{
    frame.removeAttribute('srcdoc');plain.textContent='Download '+file.name+' to open it in its original application.';plain.hidden=false;message(file.title);
   }
  }catch(e){message(e.message,true);}
 }
 function choose(index){
  const pack=Payload.packages[index];if(!pack)throw new Error('Choose an original saved package.');
  if(!pack.opened){
   const original=Bytes.fromBase64(pack.archive.base64),identity=Hashes.sha256Bytes(original);
   if(identity.bytes!==pack.archive.bytes||identity.sha256!==pack.archive.sha256)throw new Error('The complete selected archive changed.');
   const received=Archive.readLeadCustomerArchive(original,{maxBytes:64*1024*1024,maxFiles:1000});
   if(received.length!==pack.files.length)throw new Error('The selected archive inventory changed.');
   for(const file of pack.files){const member=received.find(m=>m.name===file.name);
    if(!member||member.bytes!==file.bytes||member.sha256!==file.sha256)throw new Error('The original selected member changed: '+file.name);
    file.base64=Bytes.base64(member.content);
   }
   pack.opened=true;
  }
  selected=pack;history=[];current='';members.replaceChildren();ready(true);
  for(const file of pack.files){const option=document.createElement('option');option.value=file.name;option.textContent=file.title+' — '+file.name;members.appendChild(option);}
  packageLabel.textContent=(pack.delivery_type==='sample'?'Free sample':pack.delivery_type==='paid'?'Paid selection':'Replacement')+' · '+pack.quantity+' '+(pack.quantity===1?'buyer':'buyers')+' · '+money(pack);
  $('instructions').textContent=pack.instructions;
  details.textContent='Prepared '+new Date(pack.prepared_at).toISOString().slice(0,10)+'\nEdition: '+pack.edition_id+'\nPackage: '+pack.id+'\nZIP: '+pack.archive.name+'\nSHA-256: '+pack.archive.sha256;
  open('lead-pack.html');
  reviewDesk?.selectPackage(pack);
 }
 for(const [i,pack]of Payload.packages.entries()){const option=document.createElement('option');option.value=i;option.textContent=pack.title;select.appendChild(option);}
 function changeSelection(index){try{choose(index);select.value=String(index);}catch(e){if(selected)select.value=String(Payload.packages.indexOf(selected));else select.selectedIndex=-1;ready(Boolean(selected));message(e.message,true);}}
 select.addEventListener('change',()=>changeSelection(Number(select.value)));
 members.addEventListener('change',()=>open(members.value));
 back.addEventListener('click',()=>{const last=history.pop();if(last)open(last,'',false);});
 $('download-member').addEventListener('click',()=>{const file=selected.files.find(f=>f.name===current);if(file)download(file);});
 $('download-zip').addEventListener('click',()=>{if(selected)download(selected.archive);});
 $('open-supporting').addEventListener('click',()=>open('supporting-files.html'));
 $('open-leads').addEventListener('click',()=>open('lead-pack.html'));
 window.addEventListener('message',event=>{
  if(event.source!==frame.contentWindow||event.data?.kind!=='lead-package-link'||event.data.token!==token)return;
  try{const link=resolveLink(current,event.data.href,selected.files.map(f=>f.name));if(link.external)return;
   if(event.data.download)download(selected.files.find(f=>f.name===link.name));else open(link.name,link.fragment);
  }catch(e){message(e.message,true);}
 });
 window.addEventListener('pagehide',event=>{revoke();if(!event.persisted)reviewDesk?.dispose();for(const url of downloadURLs)URL.revokeObjectURL(url);});
 ready(false);
 if(!Payload.packages.length){message('This customer source has no saved package.',true);return;}
 changeSelection(0);
}
const STYLE=".lead-package-viewer{color-scheme:light;background:#f5f5f5;color:#202020;font:16px/1.5 system-ui,sans-serif;max-width:1220px;min-width:0;margin:0 auto;padding:24px;text-align:left}.lead-package-viewer,.lead-package-viewer *{box-sizing:border-box}.lead-package-viewer header{margin-bottom:20px;color:#202020}.lead-package-viewer h1{color:#202020;font:600 27px/1.25 system-ui,sans-serif;margin:0 0 8px}.lead-package-viewer p{color:#202020;font:inherit;margin:8px 0}.lead-package-viewer .controls{background:#fff;color:#202020;border:1px solid #aaa;padding:18px}.lead-package-viewer .grid{display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,2fr);gap:16px}.lead-package-viewer label{display:block;color:#202020;font-weight:600;margin-bottom:5px}.lead-package-viewer select,.lead-package-viewer button{font:inherit;background:#fff;color:#222;border:1px solid #777;border-radius:2px;padding:9px 11px;max-width:100%}.lead-package-viewer select{width:100%;min-width:0}.lead-package-viewer select option{background:#fff;color:#222}.lead-package-viewer .actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:15px}.lead-package-viewer button{cursor:pointer}.lead-package-viewer button:disabled,.lead-package-viewer select:disabled{color:#666;background:#eee;border-color:#bbb;cursor:default}.lead-package-viewer button:focus-visible,.lead-package-viewer select:focus-visible,.lead-package-viewer summary:focus-visible{outline:3px solid #333;outline-offset:3px}.lead-package-viewer .muted{font-size:14px;color:#505050}.lead-package-viewer #status{min-height:1.5em}.lead-package-viewer #error{color:#202020;background:#fff;border:2px solid #555;padding:12px;white-space:pre-wrap}.lead-package-viewer iframe{width:100%;height:900px;min-height:65vh;border:1px solid #aaa;background:#fff;display:block}.lead-package-viewer pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;font:13px/1.6 ui-monospace,monospace;background:#fff;color:#222;padding:20px;border:1px solid #aaa}.lead-package-viewer details{margin-top:15px;color:#202020}.lead-package-viewer summary{color:#202020;font:inherit;cursor:pointer}.lead-package-viewer details pre{border:0;padding:12px 0}.lead-package-viewer [hidden]{display:none!important}@media(max-width:600px){.lead-package-viewer{padding:14px 10px}.lead-package-viewer .controls{padding:13px}.lead-package-viewer .grid{grid-template-columns:1fr;gap:12px}.lead-package-viewer h1{font-size:23px}.lead-package-viewer .actions button{flex:1 1 145px}.lead-package-viewer iframe{height:950px}.lead-package-viewer pre{padding:12px}}";
export function renderPortableLeadPackages(prepared,{customerKey,zipSource,gzipSource,archiveSource,hashSource,maxHtmlBytes=262144}={}){
 if([zipSource,gzipSource,archiveSource,hashSource].some(s=>typeof s!=='string'||!s))fail('Supply the maintained complete ZIP, DEFLATE, customer archive and hash sources.');
 const payload=selectPortableLeadPackages(prepared,{customerKey});
 const bootstrap='('+startPortableLeadPackages.toString()+')(JSON.parse(document.getElementById("lead-package-data").textContent),PackageBytes,PackageArchive,PackageHashes,'+resolvePortablePackageLink.toString()+','+CustomerReview.createLeadCustomerReview.toString()+','+mountPortableLeadCustomerReview.toString()+');';
 const moduleFactory=(name,source)=>'const '+name+'=(()=>{const module={exports:{}};const exports=module.exports;\n'+source+'\nreturn module.exports;})();\n';
 const zipFactory=moduleFactory('PackageBytes',zipSource)+moduleFactory('PackageHashes',hashSource)+moduleFactory('PackageArchiveCore',archiveSource)+'const PackageArchive=PackageArchiveCore.createLeadCustomerArchive(PackageHashes);\n';
 payload.bootstrap=zipFactory+bootstrap;
 const safeJSON=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 const html='<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHTML(payload.customer)+' — complete customer packages</title><style>'+STYLE+CUSTOMER_REVIEW_STYLE+'</style></head><body><main class="lead-package-viewer"><header><h1>'+escapeHTML(payload.customer)+'</h1><p>Lead packs, activation guides and original customer files.</p></header><section class="controls" aria-label="Customer package selection"><div class="grid"><div><label for="package">Saved package</label><select id="package"></select></div><div><label for="member">Open a document</label><select id="member"></select></div></div><p id="package-label"></p><p id="instructions"></p><div class="actions"><button id="back" type="button" disabled>Back</button><button id="open-leads" type="button">Lead pack</button><button id="open-supporting" type="button">Supporting files</button><button id="download-member" type="button" disabled>Download this file</button><button id="download-zip" type="button">Download complete ZIP</button></div><p class="muted">Keep the ZIP together to edit worksheets or run an application using browser storage or external services. Downloads contain the original complete files.</p><details><summary>Saved edition and file identity</summary><pre id="details"></pre></details></section><p id="status" role="status" aria-live="polite">Opening the original package…</p><p id="error" role="alert" hidden></p><iframe id="document" title="Original customer document" sandbox="allow-scripts allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" hidden></iframe><pre id="plain" hidden></pre><div id="customer-review"></div></main><script id="lead-package-data" type="application/json">'+safeJSON(payload)+'</script><script>'+zipFactory+bootstrap.replace(/<\/script/gi,'<\\/script')+'</script></body></html>\n';
 const content=compactInlinePayload(html,{dataId:'lead-package-data',zipGlobal:'PackageBytes',bootstrapBefore:'('+startPortableLeadPackages.toString()+')',gzipSource,compactBootstrap:true});
 const identity=hashes.sha256Utf8(content);
 if(identity.bytes>maxHtmlBytes)fail('This complete customer preview exceeds the selected Page size. Use its complete native/extracted directory.');
 return {name:customerKey+'-complete-packages.html',type:'text/html',content,...identity,customer:payload.customer,package_count:payload.packages.length,packages:payload.packages.map(p=>({id:p.id,edition_id:p.edition_id,archive:p.archive.name,archive_sha256:p.archive.sha256,member_count:p.files.length}))};
}
