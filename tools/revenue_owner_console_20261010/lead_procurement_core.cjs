'use strict';
/** Procurement response work within the original customer/lead ledger.
 * Persistence, operation replay and root concurrency remain with its caller.
 */
const VERSION='dealscout.lead-procurement.v1';
const REPORT='dealscout.lead-procurement-report.v1';
const HANDOVER='dealscout.lead-procurement-handover.v1';
const FIELDS=Object.freeze(['procurements','procurement_handovers']);
const CHOICES=Object.freeze({
  procurement_type:['RFP','RFI','RFQ','grant','other'],
  role:['issuer_packet','amendment','answer','team_brief','response_attachment'],
  timeline_type:['question_deadline','proposal_deadline','answers','demonstration','deployment','registration','other'],
  precision:['unknown','date','time','instant'],
  category:['eligibility','returnable','technical','commercial','submission','other'],
  requirement_status:['unknown','needed','in_progress','ready','met','unmet','not_applicable'],
  question_status:['draft','open','answered','withdrawn'],
  assignment_status:['todo','in_progress','done','blocked'],
  assessment:['matched','partial','gap','unknown'],
  decision:['unreviewed','pursue','decline','needs_information']
});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>JSON.parse(JSON.stringify(x));
const problem=(message,status=422,details)=>Object.assign(new Error(message),
  {status,code:'LEAD_PROCUREMENT',...(details?{details}:{})});
const need=(value,message,status=422,details)=>{if(!value)throw problem(message,status,details);};

function createLeadProcurement({hash,utf8ByteLength,customerFiles}){
  need(typeof hash==='function'&&typeof utf8ByteLength==='function'&&typeof customerFiles?.version==='function',
    'Use the original lead digest and customer file store.');
  const rows=(root,key)=>root[key]||[];
  const find=(list,id,label)=>{const value=list.find(x=>x.id===id);need(value,'Choose the original '+label+'.',404);return value;};
  function text(value,label,max=8000,required=false){
    need(typeof(value??'')==='string',label+' must be text.');
    const result=(value??'').trim();
    need(result.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result),label+' contains unsupported text.');
    utf8ByteLength(result);need(!required||result,'Enter '+label+'.');return result;
  }
  function id(value,label='record ID'){
    const result=text(value,label,160,true);
    need(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result),'Use a stable '+label+'.');return result;
  }
  function digest(value,label){
    need(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),label+' needs its complete SHA-256.');return value;
  }
  function integer(value,label,min=0){
    need(Number.isSafeInteger(value)&&value>=min,label+' must be a whole number.');return value;
  }
  function choose(value,choices,label){need(choices.includes(value),'Choose '+label+'.');return value;}
  function bool(value,label){need(typeof value==='boolean',label+' must be true or false.');return value;}
  function date(value,label){
    const result=text(value,label,10);if(!result)return '';
    need(/^\d{4}-\d\d-\d\d$/.test(result)&&Number.isFinite(Date.parse(result+'T12:00:00Z'))&&
      new Date(result+'T12:00:00Z').toISOString().slice(0,10)===result,label+' needs a valid YYYY-MM-DD date.');
    return result;
  }
  function instant(value,label,required=false){
    const result=text(value,label,40,required);if(!result)return '';
    const parts=/^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/.exec(result);
    need(parts&&Number(parts[2])<24&&Number(parts[3])<60&&Number(parts[4])<60&&Number.isFinite(Date.parse(result)),
      label+' needs its actual date, time and timezone.');
    date(parts[1],label);return new Date(result).toISOString();
  }
  function url(value,label='source URL'){
    const result=text(value,label,4000);
    need(!result||/^https?:\/\/[a-z0-9.-]+(?::[0-9]{1,5})?(?:[/?#][^\s<>"'\\]*)?$/i.test(result),
      label+' needs an absolute HTTP or HTTPS address.');return result;
  }
  function list(value,label,max=500){
    need(Array.isArray(value??[])&&(value??[]).length<=max,'Keep the complete '+label+' list within '+max+' entries.');
    return value??[];
  }
  function unique(values,label,key='id'){
    need(new Set(values.map(x=>x[key])).size===values.length,'List each '+label+' once.');return values;
  }
  function fileRef(value){
    need(plain(value),'Select an exact saved customer file revision.');
    return {id:id(value.id??value.file_id,'customer file ID'),revision:integer(value.revision,'file revision',1),
      sha256:digest(value.sha256,'file revision')};
  }
  function citation(value,required=false){
    const result={source_file_id:value.source_file_id?id(value.source_file_id,'source file ID'):'',
      source_page:text(value.source_page,'source page or section',500),
      source_quote:text(value.source_quote,'exact source excerpt',16000),
      source_url:url(value.source_url)};
    need(!required||result.source_file_id||result.source_url,'Link the original document or URL for this requirement or date.');
    return result;
  }
  function evidence(value){
    return unique(list(value,'evidence files',100).map(fileRef),'evidence file','id');
  }
  function normalizeDocument(input){
    need(plain(input),'Supply the complete procurement response document.');
    const files=unique(list(input.files,'procurement files',300).map(value=>{
      need(plain(value),'Each selected packet file must be complete.');
      const ref=fileRef(value);
      return {file_id:ref.id,revision:ref.revision,sha256:ref.sha256,
        role:choose(value.role,CHOICES.role,'the original file role'),
        title:text(value.title,'packet file title',300,true),note:text(value.note,'packet file note',8000),
        source_url:url(value.source_url),published_at:instant(value.published_at,'file publication time'),
        supersedes_file_id:value.supersedes_file_id?id(value.supersedes_file_id,'earlier packet file ID'):''};
    }),'selected packet file','file_id');
    const timeline=unique(list(input.timeline,'procurement timeline',300).map(value=>{
      need(plain(value),'Each timeline entry must be complete.');
      const result={id:id(value.id,'timeline ID'),type:choose(value.type,CHOICES.timeline_type,'timeline event type'),
        label:text(value.label,'timeline label',500,true),printed_date:text(value.printed_date,'printed date',200),
        printed_time:text(value.printed_time,'printed time',200),printed_zone:text(value.printed_zone,'printed timezone',200),
        at:instant(value.at,'confirmed deadline instant'),precision:choose(value.precision??(value.at?'instant':value.printed_time?'time':value.printed_date?'date':'unknown'),CHOICES.precision,'deadline precision'),
        ...citation(value,true),notes:text(value.notes,'timeline note',8000)};
      need(!result.at||(result.printed_date&&result.printed_time&&result.printed_zone),
        'Retain the printed date, time and timezone with a normalized deadline.');
      need(result.precision!=='instant'||result.at,'An exact instant needs its retained date, time and timezone.');
      need(!result.at||result.precision==='instant','Use instant precision for a normalized deadline.');
      need(result.precision!=='time'||result.printed_date&&result.printed_time,'Time precision needs the printed date and time.');
      need(result.precision!=='date'||result.printed_date,'Date precision needs the printed date.');
      return result;
    }),'timeline entry');
    const requirements=unique(list(input.requirements,'response requirements',1000).map(value=>{
      need(plain(value),'Each requirement must be complete.');
      const result={id:id(value.id,'requirement ID'),category:choose(value.category??'other',CHOICES.category,'requirement category'),
        mandatory:bool(value.mandatory??false,'Mandatory requirement'),text:text(value.text,'requirement',16000,true),
        status:choose(value.status??'unknown',CHOICES.requirement_status,'requirement status'),
        owner:text(value.owner,'requirement owner',500),due_on:date(value.due_on,'internal requirement due date'),
        ...citation(value,true),response:text(value.response,'response or qualification assessment',30000),
        evidence_file_refs:evidence(value.evidence_file_refs)};
      need(!result.mandatory||result.source_quote,'Retain the actual excerpt for a mandatory requirement.');
      need(!['met','ready','not_applicable','unmet'].includes(result.status)||result.response,
        'Explain a completed, inapplicable or unmet requirement in its response.');
      return result;
    }),'requirement');
    const questions=unique(list(input.questions,'issuer questions',500).map(value=>{
      need(plain(value),'Each issuer question must be complete.');
      return {id:id(value.id,'question ID'),question:text(value.question,'issuer question',16000,true),
        status:choose(value.status??'draft',CHOICES.question_status,'question status'),owner:text(value.owner,'question owner',500),
        due_on:date(value.due_on,'internal question due date'),...citation(value),
        answer:text(value.answer,'retained answer',30000),
        answer_source_file_id:value.answer_source_file_id?id(value.answer_source_file_id,'answer source file ID'):'',
        answer_source_url:url(value.answer_source_url),notes:text(value.notes,'question notes',8000)};
    }),'question');
    const assignments=unique(list(input.assignments,'response assignments',500).map(value=>{
      need(plain(value),'Each response assignment must be complete.');
      return {id:id(value.id,'assignment ID'),title:text(value.title,'assignment title',1000,true),
        owner:text(value.owner,'assignment owner',500),status:choose(value.status??'todo',CHOICES.assignment_status,'assignment status'),
        due_on:date(value.due_on,'assignment due date'),
        requirement_ids:[...new Set(list(value.requirement_ids,'assigned requirements').map(x=>id(x,'assigned requirement ID')))],
        notes:text(value.notes,'assignment notes',16000)};
    }),'assignment');
    const vendorFit=unique(list(input.vendor_fit,'vendor fit assessments',500).map(value=>{
      need(plain(value),'Each vendor fit assessment must be complete.');
      return {id:id(value.id,'vendor fit ID'),criterion:text(value.criterion,'vendor fit criterion',8000,true),
        assessment:choose(value.assessment??'unknown',CHOICES.assessment,'vendor fit assessment'),
        detail:text(value.detail,'vendor fit explanation',16000),...citation(value),
        evidence_file_refs:evidence(value.evidence_file_refs)};
    }),'vendor fit assessment');
    need(input.decision===undefined||plain(input.decision),'Keep the complete procurement decision.');
    need(input.submission===undefined||plain(input.submission),'Keep the complete submission instructions.');
    const d=input.decision??{},s=input.submission??{};
    const decision={status:choose(d.status??'unreviewed',CHOICES.decision,'procurement decision'),
      reason:text(d.reason,'procurement decision reason',16000),
      reviewed_by:text(d.reviewed_by,'decision reviewer',500),reviewed_at:instant(d.reviewed_at,'decision review time')};
    need(decision.status==='unreviewed'||decision.reason&&decision.reviewed_by&&decision.reviewed_at,
      'Record the reason, reviewer and actual review time for this decision.');
    return {title:text(input.title,'procurement title',500,true),issuer:text(input.issuer,'issuing organization',1000,true),
      reference:text(input.reference,'issuer reference',1000),procurement_type:choose(input.procurement_type??'other',CHOICES.procurement_type,'procurement type'),
      source_url:url(input.source_url),owner:text(input.owner,'response owner',500),notes:text(input.notes,'procurement notes',30000),
      files,timeline,requirements,questions,assignments,vendor_fit:vendorFit,decision,
      submission:{method:text(s.method,'submission method',1000),destination:text(s.destination,'submission destination',4000),
        instructions:text(s.instructions,'issuer submission instructions',30000),
        confirmation_required:bool(s.confirmation_required??false,'Submission confirmation requirement')}};
  }
  function versions(row){return [...row.history,{revision:row.revision,document:row.document,sha256:row.sha256,updated_at:row.updated_at,actor:row.actor}];}
  const anchors=row=>({id:row.id,pack_id:row.pack_id,lead_id:row.lead_id,lead_revision:row.lead_revision,
    lead_sha256:row.lead_sha256,pack_revision:row.pack_revision,pack_sha256:row.pack_sha256,case_id:row.case_id});
  function selectedRevision(row,revision=row.revision){
    const selected=versions(row).find(x=>x.revision===revision);
    need(selected,'Receive the complete original procurement revision history.',404);
    return {...anchors(row),...clone(selected)};
  }
  function originalVersion(collection,recordId,revision,sha,label){
    const row=find(collection,recordId,label);
    const selected=[...(row.history||[]),row].find(x=>x.revision===revision);
    need(selected&&selected.sha256===sha,'The '+label+' lost its selected original revision.');
    return {id:row.id,...(row.pack_id?{pack_id:row.pack_id}:{}),revision:selected.revision,
      document:selected.document,sha256:selected.sha256,updated_at:selected.updated_at};
  }
  function checkReferences(root,row,document,at){
    const selectedFiles=new Map();
    for(const file of document.files){
      const selected=customerFiles.version(root,fileRef(file),row.pack_id);
      need(!selected.document.lead_ids.length||selected.document.lead_ids.includes(row.lead_id),
        'Keep packet and response files scoped to this original lead or common customer instructions.');
      need(Date.parse(selected.updated_at)<=Date.parse(at),'The procurement revision precedes a selected file revision.');
      need(!file.published_at||Date.parse(file.published_at)<=Date.parse(at),'Retain an already published packet or answer.');
      selectedFiles.set(file.file_id,selected);
    }
    const source=ref=>{
      if(ref.source_file_id)need(selectedFiles.has(ref.source_file_id),'Retain the cited source file in this complete packet.');
    };
    const evidenceFiles=refs=>{
      for(const ref of refs){
        const selected=selectedFiles.get(ref.id);
        need(selected&&selected.revision===ref.revision&&selected.sha256===ref.sha256,
          'Select the same complete packet file revision for its response evidence.');
      }
    };
    for(const file of document.files)if(file.supersedes_file_id){
      need(file.supersedes_file_id!==file.file_id&&selectedFiles.has(file.supersedes_file_id),
        'Keep the superseded original document in the full packet.');
      const seen=new Set([file.file_id]);let current=file;
      while(current.supersedes_file_id){
        need(!seen.has(current.supersedes_file_id),'The packet amendment history contains a cycle.');
        seen.add(current.supersedes_file_id);current=document.files.find(x=>x.file_id===current.supersedes_file_id);
      }
    }
    for(const value of [...document.timeline,...document.requirements,...document.questions,...document.vendor_fit])source(value);
    for(const value of [...document.requirements,...document.vendor_fit])evidenceFiles(value.evidence_file_refs);
    for(const question of document.questions){
      if(question.answer_source_file_id)need(selectedFiles.has(question.answer_source_file_id),'Retain the original answer file.');
      need(question.status!=='answered'||question.answer&&(question.answer_source_file_id||question.answer_source_url),
        'An answered issuer question needs its actual answer and original source.');
    }
    const requirements=new Set(document.requirements.map(x=>x.id));
    for(const assignment of document.assignments)for(const requirementId of assignment.requirement_ids)
      need(requirements.has(requirementId),'Keep each assignment with its original response requirement.');
    need(!document.decision.reviewed_at||Date.parse(document.decision.reviewed_at)<=Date.parse(at),'Record an already completed decision review.');
  }
  function readiness(document){
    const issues=[];
    if(!document.files.some(x=>['issuer_packet','amendment','answer'].includes(x.role)))
      issues.push({kind:'issuer_packet',id:'',message:'Original issuer packet files have not been selected.'});
    for(const row of document.requirements)if(row.mandatory&&!['ready','met','not_applicable'].includes(row.status))
      issues.push({kind:'mandatory_requirement',id:row.id,message:row.text,status:row.status});
    for(const row of document.questions)if(row.status!=='answered'&&row.status!=='withdrawn')
      issues.push({kind:'issuer_question',id:row.id,message:row.question,status:row.status});
    for(const row of document.vendor_fit)if(row.assessment==='gap'||row.assessment==='unknown')
      issues.push({kind:'vendor_fit',id:row.id,message:row.criterion,status:row.assessment});
    for(const row of document.assignments)if(row.status!=='done')
      issues.push({kind:'assignment',id:row.id,message:row.title,status:row.status});
    return {decision:document.decision.status,requirements:document.requirements.length,
      mandatory_requirements:document.requirements.filter(x=>x.mandatory).length,
      completed_requirements:document.requirements.filter(x=>['ready','met','not_applicable'].includes(x.status)).length,
      files:document.files.length,open_issues:issues.length,issues};
  }
  function validate(root){
    for(const key of FIELDS){
      need(root[key]===undefined||Array.isArray(root[key]),'The complete '+key+' list is missing.');
      unique(rows(root,key),key);for(const row of rows(root,key)){need(plain(row),'The procurement record is incomplete.');id(row.id);}
    }
    for(const row of rows(root,'procurements')){
      id(row.pack_id,'customer brief ID');id(row.lead_id,'original lead ID');
      integer(row.revision,'procurement revision',1);need(Array.isArray(row.history)&&row.history.length===row.revision-1,'Retain the whole procurement revision history.');
      const pack=originalVersion(root.packs,row.pack_id,row.pack_revision,row.pack_sha256,'customer brief');
      const lead=originalVersion(root.leads.filter(lead=>lead.pack_id===row.pack_id),row.lead_id,row.lead_revision,row.lead_sha256,'lead');
      need(lead.pack_id===row.pack_id&&row.case_id===(pack.document.customer.case_id||''),'The procurement changed its original customer/lead association.');
      let previousTime=-Infinity;
      versions(row).forEach((saved,index)=>{
        need(saved.revision===index+1&&saved.sha256===hash(saved.document),'The complete procurement revision changed.');
        need(hash(normalizeDocument(saved.document))===saved.sha256,'The saved procurement document is incomplete.');
        const at=instant(saved.updated_at,'procurement save time',true);text(saved.actor,'saving operator',500,true);
        need(Date.parse(at)>=previousTime&&Date.parse(at)>=Date.parse(pack.updated_at)&&Date.parse(at)>=Date.parse(lead.updated_at),
          'Keep procurement revisions in their original save order.');
        previousTime=Date.parse(at);checkReferences(root,row,saved.document,at);
      });
    }
    const children=new Map();
    for(const row of rows(root,'procurement_handovers')){
      const {sha256,...document}=row;
      need(row.version===HANDOVER&&sha256===hash(document),'The immutable complete response handover changed.');
      const original=find(rows(root,'procurements'),row.procurement_id,'procurement response');
      need(row.pack_id===original.pack_id&&row.procurement_revision===row.snapshot?.revision&&
        row.procurement_sha256===row.snapshot?.sha256&&hash(row.snapshot)===hash(selectedRevision(original,row.procurement_revision)),
        'The handover lost its exact complete procurement revision.');
      instant(row.prepared_at,'handover preparation time',true);
      need(Date.parse(row.prepared_at)>=Date.parse(row.snapshot.updated_at),'The handover precedes its selected response revision.');
      text(row.title,'handover title',500,true);text(row.instructions,'handover instructions',30000,true);text(row.actor,'preparing operator',500,true);
      const expected=row.snapshot.document.files.map(fileRef);
      need(hash(row.files)===hash(expected),'The handover lost part of its original packet and response files.');
      if(row.supersedes){
        const previous=find(rows(root,'procurement_handovers'),row.supersedes,'earlier response handover');
        need(previous.id!==row.id&&previous.procurement_id===row.procurement_id&&previous.sha256===row.supersedes_sha256&&
          Date.parse(previous.prepared_at)<=Date.parse(row.prepared_at)&&row.procurement_revision>=previous.procurement_revision,'The revised handover changed its original response lineage.');
        need(!children.has(previous.id),'The imported response handover histories contain competing successors.',409);
        children.set(previous.id,row.id);text(row.reason,'handover revision reason',8000,true);
      }else need(row.supersedes_sha256===''&&row.reason==='','Keep the handover revision reason with its original predecessor.');
    }
    for(const row of rows(root,'procurement_handovers')){
      const seen=new Set();let current=row;
      while(current){need(!seen.has(current.id),'The response handover history contains a cycle.');seen.add(current.id);
        current=current.supersedes?find(rows(root,'procurement_handovers'),current.supersedes,'earlier handover'):null;}
    }
    return root;
  }
  function save(root,input,at){
    const packId=id(input.pack_id,'customer brief ID'),recordId=id(input.id,'procurement ID');
    const old=rows(root,'procurements').find(x=>x.id===recordId);
    need(!old||old.pack_id===packId,'This procurement ID belongs to another customer.',409);
    need(integer(input.expected_revision,'expected procurement revision')===(old?.revision||0)&&
      (input.expected_sha256??'')===(old?.sha256||''),'Reopen the latest saved procurement revision before saving.',409);
    const pack=find(root.packs,packId,'customer brief');
    const lead=find(root.leads.filter(row=>row.pack_id===packId),old?.lead_id||id(input.lead_id,'original lead ID'),'original lead');
    need(lead.pack_id===packId&&(!old||!input.lead_id||input.lead_id===old.lead_id),'Keep the procurement with its original customer and lead.');
    const identity=old?anchors(old):{id:recordId,pack_id:packId,lead_id:lead.id,lead_revision:lead.revision,
      lead_sha256:lead.sha256,pack_revision:pack.revision,pack_sha256:pack.sha256,case_id:pack.document.customer.case_id||''};
    const document=normalizeDocument(input.document),sha256=hash(document),actor=text(input.actor,'saving operator',500,true);
    if(old&&old.sha256===sha256)return {pack_id:packId,procurement_id:old.id,procurement_revision:old.revision,procurement_sha256:old.sha256,case_id:old.case_id};
    need(!old||Date.parse(at)>=Date.parse(old.updated_at),'The response revision precedes its saved history.');
    const row={...identity,revision:(old?.revision||0)+1,document,sha256,updated_at:at,actor,history:old?versions(old):[]};
    checkReferences(root,row,document,at);
    root.procurements??=[];if(old)root.procurements[root.procurements.indexOf(old)]=row;else root.procurements.push(row);
    return {pack_id:packId,procurement_id:row.id,procurement_revision:row.revision,procurement_sha256:row.sha256,case_id:row.case_id};
  }
  function prepare(root,input,at){
    const packId=id(input.pack_id,'customer brief ID'),original=find(rows(root,'procurements'),id(input.procurement_id,'procurement ID'),'procurement response');
    need(original.pack_id===packId&&input.expected_revision===original.revision&&input.expected_sha256===original.sha256,
      'Select the exact current complete response before preparing its handover.',409);
    const handoverId=id(input.id,'handover ID');
    need(!rows(root,'procurement_handovers').some(x=>x.id===handoverId),'That immutable handover ID is already saved.',409);
    const previous=input.supersedes?find(rows(root,'procurement_handovers'),id(input.supersedes,'earlier handover ID'),'earlier handover'):null;
    if(previous)need(previous.procurement_id===original.id&&!rows(root,'procurement_handovers').some(x=>x.supersedes===previous.id),
      'Revise the latest handover for this original response.',409);
    const snapshot=selectedRevision(original);
    const document={version:HANDOVER,id:handoverId,pack_id:packId,procurement_id:original.id,procurement_revision:original.revision,
      procurement_sha256:original.sha256,snapshot,files:snapshot.document.files.map(fileRef),
      title:text(input.title,'handover title',500,true),instructions:text(input.instructions,'handover instructions',30000,true),
      prepared_at:at,actor:text(input.actor,'preparing operator',500,true),supersedes:previous?.id||'',
      supersedes_sha256:previous?.sha256||'',reason:text(input.reason,'handover revision reason',8000,!!previous)};
    need(previous||!document.reason,'Use a revision reason with a selected earlier handover.');
    const row={...document,sha256:hash(document)};(root.procurement_handovers??=[]).push(row);
    return {pack_id:packId,procurement_id:original.id,procurement_revision:original.revision,handover_id:row.id,
      handover_sha256:row.sha256,file_count:row.files.length,case_id:original.case_id};
  }
  function apply(root,kind,input,at){
    need(plain(input),'Supply the complete procurement operation.');at=instant(at,'procurement operation time',true);
    if(kind==='procurement-save')return save(root,input,at);
    if(kind==='procurement-handover-prepare')return prepare(root,input,at);
    throw problem('Choose a supported procurement operation.');
  }
  function forPack(root,packId){
    return Object.fromEntries(FIELDS.filter(key=>root[key]!==undefined).map(key=>[key,clone(rows(root,key).filter(x=>x.pack_id===packId))]));
  }
  function merge(root,bundle,report){
    for(const incoming of bundle.procurements||[]){
      const current=rows(root,'procurements').find(x=>x.id===incoming.id);
      const record=action=>report.records.push({entity:'procurements',id:incoming.id,name:incoming.document?.title||incoming.id,action,revision:incoming.revision});
      if(!current){(root.procurements??=[]).push(clone(incoming));report.added.procurements=(report.added.procurements||0)+1;record('add');continue;}
      if(hash(anchors(current))!==hash(anchors(incoming))){
        report.conflicts.push({entity:'procurements',id:incoming.id,reason:'The response belongs to different original customer or lead revisions.'});continue;
      }
      const left=versions(current),right=versions(incoming);
      const diverged=left.findIndex((row,index)=>index<right.length&&hash(row)!==hash(right[index]));
      if(diverged!==-1){report.conflicts.push({entity:'procurements',id:incoming.id,reason:'The response histories differ at revision '+(diverged+1)+'.',
        local_revision:current.revision,incoming_revision:incoming.revision});continue;}
      if(right.length>left.length){root.procurements[root.procurements.indexOf(current)]=clone(incoming);report.advanced.procurements=(report.advanced.procurements||0)+1;record('advance');}
      else if(right.length<left.length){report.kept_current++;record('keep_current');}
      else{report.unchanged++;record('unchanged');}
    }
    for(const incoming of bundle.procurement_handovers||[]){
      const current=rows(root,'procurement_handovers').find(x=>x.id===incoming.id);
      if(!current){(root.procurement_handovers??=[]).push(clone(incoming));report.added.procurement_handovers=(report.added.procurement_handovers||0)+1;
        report.records.push({entity:'procurement_handovers',id:incoming.id,name:incoming.title,action:'add'});}
      else if(hash(current)!==hash(incoming))report.conflicts.push({entity:'procurement_handovers',id:incoming.id,reason:'This immutable response handover contains different complete content.'});
      else report.unchanged++;
    }
    try{validate(root);}catch(error){report.conflicts.push({entity:'procurements',id:bundle.pack?.id||'workspace',reason:error.message});}
  }
  function view(root,packId=''){
    return rows(root,'procurements').filter(x=>!packId||x.pack_id===packId).map(row=>({
      ...clone(row),readiness:readiness(row.document),
      handovers:clone(rows(root,'procurement_handovers').filter(x=>x.procurement_id===row.id).map(({snapshot,...summary})=>summary)),
      case_url:row.case_id?'/case?case_id='+encodeURIComponent(row.case_id):''}));
  }
  function report(root,{packId='',procurementId='',handoverId=''}={}){
    let handover=null;
    if(handoverId)handover=find(rows(root,'procurement_handovers'),handoverId,'response handover');
    const original=find(rows(root,'procurements'),procurementId||handover?.procurement_id,'procurement response');
    need((!packId||packId===original.pack_id)&&(!handover||handover.procurement_id===original.id),'Select the response from this original customer.',404);
    const selected=handover?clone(handover.snapshot):selectedRevision(original);
    const pack=originalVersion(root.packs,selected.pack_id,selected.pack_revision,selected.pack_sha256,'customer brief');
    const lead=originalVersion(root.leads.filter(row=>row.pack_id===selected.pack_id),selected.lead_id,selected.lead_revision,selected.lead_sha256,'lead');
    const files=selected.document.files.map(ref=>clone(customerFiles.version(root,fileRef(ref),selected.pack_id)));
    const selectedHandovers=handover?[]:rows(root,'procurement_handovers').filter(x=>x.procurement_id===original.id);
    if(handover){let cursor=handover;const seen=new Set();while(cursor){
      need(!seen.has(cursor.id),'The response handover history contains a cycle.');seen.add(cursor.id);selectedHandovers.unshift(cursor);
      cursor=cursor.supersedes?find(rows(root,'procurement_handovers'),cursor.supersedes,'earlier handover'):null;
    }}
    return {version:REPORT,procurement:clone(selected),customer:clone(pack.document.customer),lead:clone(lead),
      document:clone(selected.document),files,readiness:readiness(selected.document),
      handovers:clone(selectedHandovers),handover:clone(handover)};
  }
  return Object.freeze({VERSION,REPORT,HANDOVER,FIELDS,CHOICES,normalizeDocument,validate,apply,forPack,merge,view,state:view,report,readiness,selectedRevision});
}
module.exports={VERSION,REPORT,HANDOVER,FIELDS,CHOICES,createLeadProcurement};
