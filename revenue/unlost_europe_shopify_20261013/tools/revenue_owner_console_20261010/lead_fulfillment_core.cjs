'use strict';
/** Lead briefs, original request editions, customer packs and replacement fulfillment. */
const {sha256Utf8}=require('../../host/connected_sha256.cjs');
const VERSION='dealscout.lead-fulfillment.v1';
const BUNDLE='dealscout.lead-working-record.v1';
const EDITION='dealscout.lead-pack.v1';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?value.map(canonical):plain(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>sha256Utf8(JSON.stringify(canonical(value))).sha256;
const issue=(status,message,details)=>Object.assign(new Error(message),{status,code:'LEAD_FULFILLMENT',...(details?{details}:{})});
const need=(value,message,status=422,details)=>{if(!value)throw issue(status,message,details);};
function text(value,label,max=8000,required=false){
  need(typeof(value??'')==='string',label+' must be text.');
  const result=(value??'').trim();
  need(result.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result),label+' contains unsupported text.');
  need(!required||result,'Enter '+label+'.');sha256Utf8(result);return result;
}
function id(value,label='record ID'){
  const result=text(value,label,160,true);
  need(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result),'Use letters, numbers, dots, colons or hyphens for '+label+'.');return result;
}
function integer(value,label,min=0,max=Number.MAX_SAFE_INTEGER){
  need(Number.isSafeInteger(value)&&value>=min&&value<=max,label+' is outside its supported range.');return value;
}
function date(value,label,required=false){
  const result=text(value,label,10,required);if(!result)return '';
  need(/^\d{4}-\d\d-\d\d$/.test(result)&&Number.isFinite(Date.parse(result+'T12:00:00Z'))&&new Date(result+'T12:00:00Z').toISOString().slice(0,10)===result,
    label+' needs a valid YYYY-MM-DD date.');return result;
}
function instant(value,label,required=false){
  const result=text(value,label,40,required);if(!result)return '';
  need(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(result)&&Number.isFinite(Date.parse(result)),
    label+' needs a date, time and timezone.');date(result.slice(0,10),label);return new Date(result).toISOString();
}
function choice(value,values,label){need(values.includes(value),'Choose '+label+'.');return value;}
function web(value,label='source URL',required=false,mail=false){
  const result=text(value,label,4000,required);if(!result)return '';
  if(mail&&/^mailto:[^@\s<>?#]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(result))return result;
  const parsed=/^(https?):\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?([/?#][^\s<>"'\\]*)?$/i.exec(result);
  need(parsed&&!parsed[2].includes('..')&&(!parsed[3]||Number(parsed[3])<=65535),label+' needs an absolute HTTP or HTTPS address.');return result;
}
function domain(value){
  const result=text(value,'company domain',253).toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
  need(!result||/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(result)&&!result.includes('..'),'Enter the company domain without a path.');return result;
}
function list(value,label){need(Array.isArray(value??[]),label+' must be a list.');return [...new Set((value??[]).map(v=>text(v,label,1000,true)))];}
function canonicalURL(value){
  if(!value)return '';
  if(/^mailto:/i.test(value))return value.toLowerCase();
  const m=/^(https?):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(value);
  if(!m)return value;
  let authority=m[2].toLowerCase().replace(/^www\./,'');
  authority=authority.replace(m[1].toLowerCase()==='https'?/:443$/:/:80$/,'');
  let path=m[3].replace(/\/+$/,'')||'/';
  // Discourse activity/reply URLs identify the same original buyer request.
  const topic=/^\/t\/(?:[^/]+\/)?(\d+)(?:\/\d+)?$/.exec(path);
  if(topic)path='/t/'+topic[1];
  const query=(m[4]||'').split('&').filter(Boolean).filter(part=>! /^(?:utm_[^=]*|fbclid|gclid)=/i.test(part)).sort().join('&');
  return 'https://'+authority+path+(query?'?'+query:'');
}
function keys(lead){
  const result=['request:'+canonicalURL(lead.source_url)];
  if(!lead.source_url)result.length=0;
  if(lead.company_domain)result.push('company:'+lead.company_domain);
  if(lead.buyer_key)result.push('buyer:'+lead.buyer_key.toLowerCase());
  if(/^mailto:/i.test(lead.contact_url))result.push('email:'+lead.contact_url.slice(7).toLowerCase());
  return result;
}
const intersects=(left,right)=>left.some(value=>right.includes(value));
function normalizePack(input){
  need(plain(input),'Enter the customer brief.');const c=input.customer??{},b=input.brief??{};
  need(plain(c)&&plain(b),'Enter a customer and brief.');
  const currency=text(b.currency??'USD','currency',3,true).toUpperCase();
  need(/^[A-Z]{3}$/.test(currency),'Use a three-letter currency.');
  return {customer:{name:text(c.name,'customer name',240,true),company_domain:domain(c.company_domain),
    contact_url:web(c.contact_url,'customer contact',false,true),case_id:text(c.case_id,'existing case ID',160),
    prospect_id:text(c.prospect_id,'existing prospect ID',160)},
    brief:{title:text(b.title,'pack title',300,true),description:text(b.description,'customer criteria',8000,true),
      geography:text(b.geography,'geography',1000),skills:list(b.skills,'skills'),
      lead_kind:choice(b.lead_kind??'any',['any','paid_request','problem_signal','company_fit'],'the requested lead type'),
      quantity:integer(b.quantity??5,'paid pack quantity',1,500),currency,
      price_minor:integer(b.price_minor??2000,'price in minor currency units'),
      max_age_days:integer(b.max_age_days??0,'original request age limit',0,3660),
      excluded_domains:list(b.excluded_domains,'excluded domains').map(domain),
      excluded_sources:list(b.excluded_sources,'excluded request URLs').map(value=>canonicalURL(web(value))),
      exclusions:text(b.exclusions,'other customer exclusions',8000)},
    operator_note:text(input.operator_note,'internal note',12000)};
}
function normalizeLead(input){
  need(plain(input),'Enter a complete lead record.');
  return {organization:text(input.organization,'company or buyer name',400),
    company_domain:domain(input.company_domain),company_url:web(input.company_url,'company URL'),
    buyer_key:text(input.buyer_key,'original buyer identity',600),person:text(input.person,'contact name',240),
    source_url:web(input.source_url),published_on:date(input.published_on,'original request date'),
    author_updated_on:date(input.author_updated_on,'last buyer update date'),
    lead_kind:choice(input.lead_kind??'problem_signal',['paid_request','problem_signal','company_fit'],'the kind of buyer signal'),
    checked_at:/^\d{4}-\d\d-\d\d$/.test(input.checked_at??'')?date(input.checked_at,'source checked date'):instant(input.checked_at,'source checked time'),deadline_on:date(input.deadline_on,'deadline date'),
    deadline_at:instant(input.deadline_at,'exact deadline'),
    demand:text(input.demand,'buyer request',8000),fit:text(input.fit,'reason this matches the brief',8000),
    contact_url:web(input.contact_url,'public contact route',false,true),contact_instructions:text(input.contact_instructions,'contact instructions',8000),
    geography:text(input.geography,'lead geography',1000),budget:text(input.budget,'published budget',1000),
    opening_message:text(input.opening_message,'suggested opening message',12000),
    source_status:choice(input.source_status??'unconfirmed',['open','unconfirmed','closed','expired','excluded'],'the source status'),
    status_note:text(input.status_note,'source status note',8000),
    tags:list(input.tags,'lead tags'),operator_note:text(input.operator_note,'internal lead note',12000)};
}
function empty(){return {version:VERSION,packs:[],leads:[],editions:[],deliveries:[],withdrawals:[],operations:[]};}
function find(rows,value,label){const result=rows.find(row=>row.id===value);need(result,'Choose an existing '+label+'.',404);return result;}
function validRecord(row,normalize){
  need(plain(row)&&Number.isSafeInteger(row.revision)&&row.revision>0&&plain(row.document)&&Array.isArray(row.history),
    'The saved lead record is incomplete.');
  id(row.id);instant(row.updated_at,'saved record time',true);
  need(row.sha256===hash(row.document)&&row.history.length===row.revision-1,'The saved lead edition changed.');
  if(normalize)need(hash(normalize(row.document))===row.sha256,'The saved record does not contain its complete supported fields.');
  row.history.forEach((old,i)=>{
    need(plain(old)&&plain(old.document)&&old.revision===i+1&&old.sha256===hash(old.document),'The saved lead history changed.');
    instant(old.updated_at,'saved history time',true);
    if(normalize)need(hash(normalize(old.document))===old.sha256,'The saved history is incomplete.');
  });
}
function validateRoot(ledger){
  need(plain(ledger),'Open the original sales workspace.');
  const root=ledger.lead_fulfillment;if(root===undefined)return empty();
  need(plain(root)&&root.version===VERSION,'Open a compatible lead fulfillment workspace.');
  for(const key of ['packs','leads','editions','deliveries','withdrawals','operations']){
    need(Array.isArray(root[key]),'The saved '+key+' list is missing.');
    root[key].forEach(row=>{need(plain(row),'The saved '+key+' record is incomplete.');id(row.id);});
    need(new Set(root[key].map(row=>row.id)).size===root[key].length,'The saved '+key+' list contains repeated IDs.');
  }
  root.packs.forEach(row=>validRecord(row,normalizePack));root.leads.forEach(row=>validRecord(row,normalizeLead));
  const packIds=new Set(root.packs.map(row=>row.id));
  for(const row of root.leads)need(packIds.has(row.pack_id),'A lead has lost its original customer brief.');
  for(const row of root.editions){
    const {sha256,...document}=row;
    need(row.version===EDITION&&sha256===hash(document)&&packIds.has(row.pack_id)&&Array.isArray(row.leads),'The complete prepared customer edition changed.');
    need(hash(normalizePack(row.brief))===hash(row.brief),'The prepared customer brief is incomplete.');
    choice(row.kind,['sample','paid','replacement'],'the saved delivery type');instant(row.prepared_at,'prepared edition time',true);
    need(row.leads.length===(row.kind==='sample'?1:row.brief.brief.quantity)&&new Set(row.leads.map(lead=>lead.id)).size===row.leads.length,'The prepared edition has an incomplete lead selection.');
    need(row.currency===row.brief.brief.currency&&row.price_minor===(row.kind==='paid'?row.brief.brief.price_minor:0),'The prepared edition price differs from its original brief.');
    row.leads.forEach(lead=>{validRecord(lead,normalizeLead);need(lead.pack_id===row.pack_id,'A prepared lead belongs to another pack.');});
  }
  for(const row of [...root.deliveries,...root.withdrawals])need(root.editions.some(edition=>edition.id===row.edition_id),'An edition event has lost its original customer edition.');
  return root;
}
function revision(rows,recordId,document,at,extra={}){
  const old=rows.find(row=>row.id===recordId);
  if(old&&hash(old.document)===hash(document))return old;
  const next={id:recordId,...extra,revision:(old?.revision??0)+1,document,sha256:hash(document),updated_at:at,
    history:old?[...old.history,{revision:old.revision,document:old.document,sha256:old.sha256,updated_at:old.updated_at}]:[]};
  if(old)rows[rows.indexOf(old)]=next;else rows.push(next);return next;
}
function customerKeys(customer){return [customer.case_id?'case:'+customer.case_id:'',customer.prospect_id?'prospect:'+customer.prospect_id:'',
  customer.company_domain?'domain:'+customer.company_domain:'',customer.contact_url?'contact:'+canonicalURL(customer.contact_url):'',
  'name:'+customer.name.toLowerCase()].filter(Boolean);}
const withdrawn=(root,editionId)=>root.withdrawals.some(row=>row.edition_id===editionId);
function quality(lead,pack,at){
  const reasons=[],notes=[],d=lead.document??lead,b=pack.document?.brief??pack.brief;
  if(!d.organization)reasons.push('Add the company or original buyer name.');
  if(!d.source_url)reasons.push('Add the original buyer request.');
  if(d.lead_kind!=='company_fit'&&!d.published_on)reasons.push('Record the original request date.');
  if(!d.checked_at)reasons.push('Record when the source was checked.');
  if(!d.demand)reasons.push(d.lead_kind==='company_fit'?'Describe the observed business need or workflow.':'Describe the buyer request.');
  if(b.lead_kind!=='any'&&d.lead_kind!==b.lead_kind)reasons.push('This buyer signal does not match the lead type in the customer brief.');
  if(!d.fit)reasons.push('Explain the match to this customer.');
  if(!d.contact_url)reasons.push('Add the published contact route.');
  if(['closed','expired','excluded'].includes(d.source_status))reasons.push('Source is '+d.source_status+(d.status_note?': '+d.status_note:'.'));
  if(d.source_status==='unconfirmed')notes.push(d.status_note||'Current availability has not been confirmed.');
  const today=at.slice(0,10);
  if(d.published_on>today)reasons.push('The original request date is in the future.');
  if(d.checked_at&&Date.parse(d.checked_at)>Date.parse(at))reasons.push('The source checked time is in the future.');
  if(d.deadline_at&&Date.parse(d.deadline_at)<Date.parse(at))reasons.push('The published exact deadline has passed.');
  else if(d.deadline_on&&d.deadline_on<today)reasons.push('The published deadline date has passed.');
  const freshnessDate=d.lead_kind==='company_fit'?d.checked_at.slice(0,10):d.published_on;
  if(b.max_age_days&&freshnessDate){
    const age=Math.floor((Date.parse(today+'T12:00:00Z')-Date.parse(freshnessDate+'T12:00:00Z'))/86400000);
    if(age>b.max_age_days)reasons.push(d.lead_kind==='company_fit'?'The company source was checked earlier than the customer brief permits.':'The original request is older than the customer brief permits.');
  }
  if(d.company_domain&&b.excluded_domains.includes(d.company_domain))reasons.push('Company is on the customer exclusion list.');
  if(d.source_url&&b.excluded_sources.includes(canonicalURL(d.source_url)))reasons.push('Request is on the customer exclusion list.');
  return {ready:reasons.length===0,reasons,notes};
}
function editionLeads(root,pack,ids,at,ignoreEditionIds=[]){
  need(Array.isArray(ids)&&ids.length&&new Set(ids).size===ids.length,'Select distinct lead records.');
  const leads=ids.map(value=>find(root.leads,value,'lead'));
  need(leads.every(row=>row.pack_id===pack.id),'Select leads from the same customer brief.');
  const problems=leads.flatMap(row=>quality(row,pack,at).reasons.map(reason=>({lead_id:row.id,reason})));
  need(!problems.length,'Complete the selected leads before preparing the customer pack.',422,problems);
  const selectedKeys=[];
  for(const row of leads){
    const candidate=keys(row.document);
    need(!intersects(selectedKeys,candidate),'The selection repeats the same company or buyer request.',422,{lead_id:row.id});
    selectedKeys.push(...candidate);
  }
  const customer=customerKeys(pack.document.customer);
  const used=root.editions.filter(edition=>!withdrawn(root,edition.id)&&!ignoreEditionIds.includes(edition.id)&&intersects(customerKeys(edition.brief.customer),customer))
    .flatMap(edition=>edition.leads.flatMap(row=>keys(row.document)));
  for(const row of leads)need(!intersects(used,keys(row.document)),
    'This customer already has that lead in a prepared sample or delivery. Select an additional lead.',422,{lead_id:row.id});
  return clone(leads);
}
function freezeEdition(root,pack,input,at){
  const editionId=id(input.id,'edition ID');need(!root.editions.some(row=>row.id===editionId),'That edition ID already exists.',409);
  const kind=choice(input.kind,['sample','paid','replacement'],'sample, paid pack or replacement');
  let leads,replaces='',changes=[],editionBrief=pack.document,briefRevision=pack.revision;
  if(kind==='replacement'){
    const base=find(root.editions,id(input.replaces,'original edition ID'),'original customer edition');
    need(base.pack_id===pack.id&&base.kind!=='sample'&&!withdrawn(root,base.id),'Choose the original paid pack or its current replacement.');
    need(!root.editions.some(row=>row.replaces===base.id),'Choose the latest replacement edition, so earlier changes are retained.',409);
    need(Array.isArray(input.replacements)&&input.replacements.length,'Specify the leads to replace.');
    need(new Set(input.replacements.map(change=>change.old_id)).size===input.replacements.length,'Replace each original lead once.');
    changes=input.replacements.map(change=>({old_id:id(change.old_id),new_id:id(change.new_id),reason:text(change.reason,'replacement reason',4000,true)}));
    need(changes.every(change=>base.leads.some(row=>row.id===change.old_id)),'Choose original leads from that delivered edition.');
    const additions=editionLeads(root,{...pack,document:base.brief},changes.map(change=>change.new_id),at);
    editionBrief=base.brief;briefRevision=base.brief_revision;
    leads=base.leads.map(row=>{const change=changes.find(c=>c.old_id===row.id);return clone(change?additions.find(v=>v.id===change.new_id):row);});
    const all=[];for(const row of leads){need(!intersects(all,keys(row.document)),'A replacement duplicates a retained company or request.');all.push(...keys(row.document));}
    replaces=base.id;
  }else{
    leads=editionLeads(root,pack,input.lead_ids,at);
    need(leads.length===(kind==='sample'?1:pack.document.brief.quantity),
      kind==='sample'?'Choose one free sample.':'Choose exactly '+pack.document.brief.quantity+' additional leads for this paid pack.');
  }
  const document={version:EDITION,id:editionId,pack_id:pack.id,kind,prepared_at:at,brief:clone(editionBrief),brief_revision:briefRevision,
    leads,replaces,replacements:changes,currency:editionBrief.brief.currency,
    price_minor:kind==='paid'?editionBrief.brief.price_minor:0};
  const edition={...document,sha256:hash(document)};root.editions.push(edition);return edition;
}
function exportWorkingRecord(root,packId){
  const pack=find(root.packs,packId,'customer brief');
  const document={version:BUNDLE,pack:clone(pack),leads:clone(root.leads.filter(row=>row.pack_id===packId)),
    editions:clone(root.editions.filter(row=>row.pack_id===packId)),
    withdrawals:clone(root.withdrawals.filter(row=>root.editions.some(e=>e.id===row.edition_id&&e.pack_id===packId))),
    deliveries:clone(root.deliveries.filter(row=>root.editions.some(e=>e.id===row.edition_id&&e.pack_id===packId)))};
  return {...document,sha256:hash(document)};
}
function receiveWorkingRecord(root,bundle){
  need(plain(bundle)&&bundle.version===BUNDLE,'Choose a complete lead working record.');
  const {sha256,...document}=bundle;need(sha256===hash(document),'The complete working record differs from its original content.');
  const candidate={...empty(),packs:[bundle.pack],leads:bundle.leads,editions:bundle.editions,deliveries:bundle.deliveries,withdrawals:bundle.withdrawals};
  validateRoot({lead_fulfillment:candidate});
  const existing=root.packs.find(row=>row.id===bundle.pack.id);
  if(existing){need(hash(exportWorkingRecord(root,existing.id))===hash(bundle),
    'This customer pack already has a different saved edition. Keep its current work and use the original workspace history to select another edition.',409);return existing;}
  for(const key of ['leads','editions','deliveries','withdrawals'])need(bundle[key].every(row=>!root[key].some(old=>old.id===row.id)),
    'An imported record ID already belongs to another saved pack.',409);
  root.packs.push(clone(bundle.pack));
  for(const key of ['leads','editions','deliveries','withdrawals'])root[key].push(...clone(bundle[key]));
  return bundle.pack;
}
function applyLeadFulfillment(ledger,body,asOf=new Date().toISOString()){
  need(plain(body)&&plain(body.input),'Supply the saved operation and input.');
  const operationId=id(body.operation_id,'operation ID'),at=instant(asOf,'operation time',true),original=validateRoot(ledger);
  const requestHash=hash({kind:body.kind,input:body.input,expected_root_sha256:body.expected_root_sha256});
  const prior=original.operations.find(row=>row.id===operationId);
  if(prior){need(prior.request_sha256===requestHash,'The operation ID belongs to a different saved request.',409);
    return {ledger,changed:false,replayed:true,operation_id:operationId,...clone(prior.result)};}
  need(body.expected_root_sha256===hash(original),'The lead workspace changed. Reload its current edition before saving your edits.',409);
  const root=clone(original),input=body.input;let packId='',result={};
  if(body.kind==='pack-save'){
    packId=id(input.id,'pack ID');const pack=revision(root.packs,packId,normalizePack(input),at);result={pack_id:packId,pack_revision:pack.revision};
  }else if(body.kind==='leads-save'){
    packId=id(input.pack_id,'pack ID');find(root.packs,packId,'customer brief');
    need(Array.isArray(input.leads)&&input.leads.length,'Supply the original lead records.');
    need(new Set(input.leads.map(row=>row.id)).size===input.leads.length,'Use distinct IDs in the imported lead list.');
    const saved=input.leads.map(row=>{
      const leadId=id(row.id,'lead ID'),existing=root.leads.find(old=>old.id===leadId);
      need(!existing||existing.pack_id===packId,'That lead ID belongs to another customer pack.',409);
      return revision(root.leads,leadId,normalizeLead(row.document??row),at,{pack_id:packId});
    });result={pack_id:packId,lead_ids:saved.map(row=>row.id),lead_revisions:saved.map(row=>row.revision)};
  }else if(body.kind==='edition-prepare'){
    packId=id(input.pack_id,'pack ID');const edition=freezeEdition(root,find(root.packs,packId,'customer brief'),input,at);
    result={pack_id:packId,edition_id:edition.id,edition_sha256:edition.sha256,lead_count:edition.leads.length};
  }else if(body.kind==='edition-withdraw'){
    const edition=find(root.editions,id(input.edition_id,'edition ID'),'prepared edition');packId=edition.pack_id;
    need(!root.deliveries.some(row=>row.edition_id===edition.id),'This edition has an actual delivery. Prepare a replacement to retain the customer history.',409);
    need(!root.editions.some(row=>row.replaces===edition.id),'This edition already has a replacement. Select its latest successor.',409);
    need(!withdrawn(root,edition.id),'This prepared edition is already withdrawn.',409);
    root.withdrawals.push({id:id(input.id,'withdrawal ID'),edition_id:edition.id,occurred_at:at,reason:text(input.reason,'withdrawal reason',4000,true)});
    result={pack_id:packId,edition_id:edition.id,withdrawn:true};
  }else if(body.kind==='delivery-record'){
    const edition=find(root.editions,id(input.edition_id,'edition ID'),'customer edition');packId=edition.pack_id;
    need(!withdrawn(root,edition.id),'Select an active prepared edition to record its delivery.');
    const deliveryId=id(input.id,'delivery ID');need(!root.deliveries.some(row=>row.id===deliveryId),'That delivery is already recorded.',409);
    const deliveredAt=instant(input.delivered_at,'actual delivery time',true);
    need(Date.parse(deliveredAt)<=Date.parse(at),'Record an existing delivery.');
    need(Date.parse(deliveredAt)>=Date.parse(edition.prepared_at),'The delivery time precedes this prepared edition.');
    const row={id:deliveryId,edition_id:edition.id,delivered_at:deliveredAt,
      channel:text(input.channel,'delivery channel',120,true),destination:text(input.destination,'actual destination',1000,true),
      provider_id:text(input.provider_id,'provider message or file ID',500,true),receipt_url:web(input.receipt_url,'delivery receipt URL'),
      note:text(input.note,'delivery note',4000)};
    const duplicated=root.deliveries.find(old=>old.channel===row.channel&&old.provider_id===row.provider_id&&old.destination===row.destination);
    need(!duplicated,'That provider delivery is already attached to a saved customer edition.',409);
    root.deliveries.push(row);result={pack_id:packId,edition_id:edition.id,delivery_id:row.id};
  }else if(body.kind==='working-record-receive'){
    const pack=receiveWorkingRecord(root,input.bundle);packId=pack.id;result={pack_id:packId,received:true};
  }else throw issue(422,'Choose a supported lead fulfillment operation.');
  root.operations.push({id:operationId,kind:body.kind,request_sha256:requestHash,occurred_at:at,result:clone(result)});
  const next={...ledger,lead_fulfillment:root};validateRoot(next);
  return {ledger:next,changed:true,replayed:false,operation_id:operationId,...result};
}
function leadFulfillmentState(ledger,{packId='',asOf=new Date().toISOString()}={}){
  const root=validateRoot(ledger),at=instant(asOf,'current time',true);
  const packs=root.packs.map(pack=>({id:pack.id,revision:pack.revision,customer:pack.document.customer.name,title:pack.document.brief.title,
    quantity:pack.document.brief.quantity,currency:pack.document.brief.currency,price_minor:pack.document.brief.price_minor,
    leads:root.leads.filter(row=>row.pack_id===pack.id).length,editions:root.editions.filter(row=>row.pack_id===pack.id).length,updated_at:pack.updated_at}));
  const pack=packId?find(root.packs,packId,'customer brief'):null;
  const rows=pack?root.leads.filter(row=>row.pack_id===packId):[];
  const customer=pack?customerKeys(pack.document.customer):[];
  const previous=root.editions.filter(row=>!withdrawn(root,row.id)&&intersects(customerKeys(row.brief.customer),customer)).flatMap(row=>row.leads.flatMap(lead=>keys(lead.document)));
  return {version:VERSION,root_sha256:hash(root),as_of_at:at,packs,selected:pack?{pack:clone(pack),
    leads:rows.map(row=>({...clone(row),quality:quality(row,pack,at),
      duplicates:rows.filter(other=>other.id!==row.id&&intersects(keys(row.document),keys(other.document))).map(other=>other.id),
      used:intersects(keys(row.document),previous)})),
    editions:root.editions.filter(row=>row.pack_id===packId).map(row=>({...clone(row),withdrawn:withdrawn(root,row.id)})),
    deliveries:clone(root.deliveries.filter(row=>root.editions.some(e=>e.id===row.edition_id&&e.pack_id===packId)))}:null};
}
function customerEdition(edition){
  return {version:EDITION,title:edition.brief.brief.title,customer:edition.brief.customer.name,prepared_at:edition.prepared_at,
    delivery_type:edition.kind,criteria:edition.brief.brief.description,geography:edition.brief.brief.geography,
    skills:clone(edition.brief.brief.skills),quantity:edition.leads.length,currency:edition.currency,price_minor:edition.price_minor,
    leads:edition.leads.map(row=>{const d=row.document;return {organization:d.organization,company_url:d.company_url,person:d.person,
      business_need:d.demand,source_url:d.source_url,original_request_date:d.published_on,last_buyer_update:d.author_updated_on,source_checked_at:d.checked_at,signal_type:d.lead_kind,
      deadline:d.deadline_at||d.deadline_on,contact_route:d.contact_url,contact_instructions:d.contact_instructions,
      geography:d.geography,published_budget:d.budget,why_it_fits:d.fit,opening_message:d.opening_message,
      source_status:d.source_status,status_note:d.status_note};})};
}
function leadFulfillmentExport(ledger,{packId,editionId='',format='json'}={}){
  const root=validateRoot(ledger),pack=find(root.packs,packId,'customer brief');
  if(format==='working-record')return {name:(pack.id+'-working-record.json').replace(/:/g,'-'),value:exportWorkingRecord(root,pack.id)};
  const edition=find(root.editions,editionId,'prepared edition');need(edition.pack_id===pack.id,'Choose an edition from this customer brief.');
  return {name:(pack.id+'-'+edition.id+'.json').replace(/:/g,'-'),value:customerEdition(edition),edition_sha256:edition.sha256};
}
module.exports={VERSION,BUNDLE,EDITION,hash,canonicalURL,validateRoot,quality,applyLeadFulfillment,leadFulfillmentState,leadFulfillmentExport,customerEdition};
