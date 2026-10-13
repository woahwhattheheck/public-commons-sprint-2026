'use strict';
function compose(core,sha,commissioning,render,input,assets){
 const need=(x,m)=>{if(!x)throw Error(m);},same=(a,b)=>core.hash(a)===core.hash(b),json=x=>JSON.stringify(x,null,2)+'\n';
 const original=input.original_working_record,id=original.pack.id,at=input.prepared_at,operations=[];
 need(original.leads.length===input.expected_original_companies&&original.editions.length===2,'The complete original company and edition selection is required.');
 let ledger={};
 function apply(suffix,kind,data){const body={operation_id:id+':commissioning:'+suffix,kind,input:data,expected_root_sha256:core.hash(core.validateRoot(ledger))};const result=core.applyLeadFulfillment(ledger,body,at);ledger=result.ledger;operations.push({body,at});return result;}
 apply('original-receive','working-record-receive',{bundle:original});
 need(same(core.leadFulfillmentExport(ledger,{packId:id,format:'working-record'}).value,original),'The full original record did not receive exactly.');
 const enc=s=>{const b=unescape(encodeURIComponent(s)),a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let out='';for(let i=0;i<b.length;i+=3){const x=b.charCodeAt(i),y=b.charCodeAt(i+1),z=b.charCodeAt(i+2);out+=a[x>>>2]+a[(x&3)<<4|(Number.isNaN(y)?0:y>>>4)]+(Number.isNaN(y)?'=':a[(y&15)<<2|(Number.isNaN(z)?0:z>>>6)])+(Number.isNaN(z)?'=':a[z&63]);}return out;};
 const catalogue=original.leads.map(l=>{const d=l.document;return {id:l.id,company:d.organization,geography:d.geography,contact:[d.person,d.contact_url,d.contact_instructions].join('\n'),observed:d.demand,proposal:d.fit,qualification:d.status_note+'\n'+d.opening_message,sources:[...new Set([d.company_url,d.source_url,...(d.contact_instructions.match(/https:\/\/\S+/g)||[])])]};});
 const seedFor=(title,ids)=>({version:'ventcrm.commissioning-seed.v1',title,operators:catalogue.filter(x=>ids.includes(x.id)),criteria:input.criteria});
 const customerFiles=[],specs=[],desks=[];
 function add(name,content,type,leadIds,title){const identity=sha.sha256Utf8(content),fileId=id+':file:'+name;customerFiles.push({path:'customer/'+name,content,...identity});specs.push({id:fileId,name,title,description:title,type,lead_ids:leadIds,source_url:'',content_base64:enc(content),...identity});return fileId;}
 const guideID=add('START-HERE.md',input.guide_markdown,'text/markdown',[],'Full profile and commissioning operating guide');
 for(const kind of ['sample','paid']){
  const edition=original.editions.find(x=>x.kind===kind);need(edition,'The original selected edition is missing.');
  const ids=edition.leads.map(x=>x.id),selected=[];
  for(const extension of ['csv','html','json']){
   const f=input.original_customer_files.find(x=>x.path==='customer/'+kind+'.'+extension);
   need(f,'The complete original '+kind+' '+extension+' is missing.');const h=sha.sha256Utf8(f.content);
   need(h.bytes===f.bytes&&h.sha256===f.sha256,'Original customer bytes differ: '+f.path);
   if(extension==='json')need(same(JSON.parse(f.content),core.customerEdition(edition)),'Original customer JSON differs from its immutable edition.');
   selected.push(add(kind+'.'+extension,f.content,{'csv':'text/csv','html':'text/html','json':'application/json'}[extension],ids,'Original '+kind+' researched operator profiles'));
  }
  const seed=seedFor(kind==='sample'?'VentCRM — sample operator programme':'VentCRM — five operator programmes',ids),blank=commissioning.create(seed,id+':'+kind+':programme');
  need(commissioning.hash(commissioning.receive(blank))===commissioning.hash(blank),'Blank programme did not reopen.');
  const html=render({...assets,seed,guide_markdown:input.guide_markdown,guide_html:input.guide_html});
  selected.push(add(kind+'-commissioning.html',html,'text/html',ids,'Complete editable '+kind+' commissioning desk'));
  selected.push(add(kind+'-working.json',json(blank),'application/json',ids,'Complete blank '+kind+' working programme'));
  selected.push(guideID);desks.push({kind,edition_id:edition.id,file_ids:selected,seed,working:blank});
 }
 apply('customer-files','customer-files-save',{pack_id:id,files:specs});
 const saved=core.validateRoot(ledger);
 const packages=[];
 for(const desk of desks){
  const packageId=id+':'+desk.kind+':complete-commissioning-20261013';
  apply(desk.kind+'-package','customer-package-prepare',{pack_id:id,id:packageId,edition_id:desk.edition_id,title:desk.kind==='sample'?'One operator profile and commissioning desk':'Five operator profiles and commissioning desk',instructions:'Open START-HERE.md, the original profile HTML and the complete commissioning HTML. The full working JSON reopens in that same desk; each download contains the selected edition only.',files:desk.file_ids.map(id=>{const f=saved.customer_files.find(x=>x.id===id);need(f,'Saved customer file missing.');return {id:f.id,revision:f.revision,sha256:f.sha256};})});
  packages.push({id:packageId,selection:core.leadCustomerPackageSelection(ledger,packageId,id)});
 }
 const working=core.leadFulfillmentExport(ledger,{packId:id,format:'working-record'}).value;
 for(const k of Object.keys(original).filter(k=>k!=='sha256'))need(same(original[k],working[k]),'Original field changed: '+k);
 const received=core.applyLeadFulfillment({}, {operation_id:id+':commissioning:independent-receive',kind:'working-record-receive',input:{bundle:working},expected_root_sha256:core.hash(core.validateRoot({}))},at).ledger;
 need(same(working,core.leadFulfillmentExport(received,{packId:id,format:'working-record'}).value),'Whole successor did not reopen.');
 for(const p of packages)need(same(p.selection,core.leadCustomerPackageSelection(received,p.id,id)),'Selected customer package did not reopen.');
 const internalSeed=seedFor('VentCRM — complete internal operator programme',catalogue.map(x=>x.id));
 return {ledger,operations,working_record:working,customer_files:customerFiles,packages,internal_programme:{working:commissioning.create(internalSeed,id+':internal:programme'),html:render({...assets,seed:internalSeed,guide_markdown:input.guide_markdown,guide_html:input.guide_html})},validation:{original_companies:original.leads.length,original_editions:2,original_fields_equal:true,original_customer_bytes_equal:true,original_deliveries_equal:true,customer_files:customerFiles.length,customer_packages:packages.length,whole_record_receive_equal:true,package_selection_receive_equal:true,visual_review:'pending_actual_original_rendering'}};
}
module.exports={compose};
