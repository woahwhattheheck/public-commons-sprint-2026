'use strict';
const Sha=require('./host/connected_sha256.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const digest=x=>Sha.sha256Utf8(canonical(x)).sha256;
const fail=m=>{throw Error(m);}, text=(x,n,required=true)=>{if(typeof x!=='string'||x.length>200000||(required&&!x.trim()))fail(n+' is required.');return x;};
const number=(x,n,min,max,integer=false,nullable=false)=>{if(nullable&&x===null)return;if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max||(integer&&!Number.isInteger(x)))fail(n+' is outside its allowed range.');};
const list=(x,n)=>{if(!Array.isArray(x))fail(n+' must be a list.');return x;};
const one=(x,values,n)=>{if(!values.includes(x))fail('Select a valid '+n+'.');};
const date=(x,n,required=true)=>{if(!required&&!x)return;text(x,n);if(!Number.isFinite(Date.parse(x)))fail(n+' must be a date/time.');};
const ref=(xs,id,n)=>xs.find(x=>x.id===id)||fail(n+' was not found.');
const unique=xs=>new Set(xs).size===xs.length;
const coord=p=>{number(p.latitude,'Latitude',-90,90);number(p.longitude,'Longitude',-180,180);return p.latitude+','+p.longitude;};
const fields=(x,names,n)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join('|')!==[...names].sort().join('|'))fail(n+' has unexpected or missing fields.');};
const collections=['pilots','accounts','scopes','attachments','observations','findings','decisions','publications'];
function seedCheck(seed){fields(seed,['edition_id','agencies','guide','sources'],'Selection');text(seed.edition_id,'Edition');list(seed.agencies,'Agencies');if(!seed.agencies.length||!unique(seed.agencies.map(a=>a.id)))fail('Agency selection must contain unique original profiles.');for(const a of seed.agencies){text(a.id,'Agency id');text(a.document.organization,'Agency name');}text(seed.guide,'Guide');list(seed.sources,'Sources');}
function initial(seed){seedCheck(seed);return{schema:'maprank.agency-pilot.v1',seed:clone(seed),revision:0,pilots:[],accounts:[],scopes:[],attachments:[],observations:[],findings:[],decisions:[],publications:[],history:[]};}
function create(seed){return seal(initial(seed));}
function seal(s){const out=clone(s);delete out.sha256;out.sha256=digest(out);return out;}
function relevant(s,pilotId){return digest({pilot:ref(s.pilots,pilotId,'Pilot'),accounts:s.accounts.filter(x=>x.pilot_id===pilotId),scopes:s.scopes.filter(x=>x.pilot_id===pilotId),attachments:s.attachments.filter(x=>x.pilot_id===pilotId),observations:s.observations.filter(x=>x.pilot_id===pilotId),findings:s.findings.filter(x=>x.pilot_id===pilotId)});}
function decisionCurrent(s,d){return d.basis===relevant(s,d.pilot_id);}
function normalizeBase64(value){if(typeof value!=='string'||value.length>7*1024*1024)fail('Attachment encoding exceeds 5 MB.');if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail('Attachment encoding is invalid.');const a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out=[];let v=0,bits=0;for(const c of value){const q=a.indexOf(c);if(q<0)continue;v=(v<<6)|q;bits+=6;if(bits>=8){bits-=8;out.push((v>>bits)&255);}}return Uint8Array.from(out);}
function validateRecord(s,kind,r){
 text(r.id,'Record id');if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(r.id))fail('Use an ordinary record identifier.');
 if(kind==='pilot'){
 fields(r,['id','agency_id','client','location','address','place_id','provider_business_id','identity_source','identity_review','operator','reviewer','question','target','custody','timezone'],'Pilot');
 ref(s.seed.agencies,r.agency_id,'Original agency');for(const k of ['client','location','operator','question','timezone'])text(r[k],k);for(const k of ['address','place_id','provider_business_id','identity_source','reviewer','target','custody'])text(r[k],k,false);one(r.identity_review,['unreviewed','matched','needs_correction'],'identity review');try{new Intl.DateTimeFormat('en',{timeZone:r.timezone});}catch{fail('Use a recognized timezone.');}
 return;
 }
 text(r.pilot_id,'Pilot');const pilot=ref(s.pilots,r.pilot_id,'Pilot');
 if(kind==='account'){
 fields(r,['id','pilot_id','label','plan','generation','observed_at','source','owner','grid_ceiling','balance','topup','custom_domain','api_allowed','seats','renewal','quote'],'Account snapshot');
 for(const k of ['label','plan','source','owner'])text(r[k],k);date(r.observed_at,'Account observation time');one(r.generation,['current','legacy','unknown'],'plan generation');for(const k of ['custom_domain','api_allowed'])one(r[k],['yes','no','unknown'],k);text(r.seats,'Seats',false);text(r.renewal,'Renewal',false);text(r.quote,'Actual checkout quote',false);number(r.grid_ceiling,'Account grid ceiling',1,101,true,true);if(r.grid_ceiling!==null&&r.grid_ceiling%2!==1)fail('Grid ceiling must be odd.');for(const k of ['balance','topup'])number(r[k],k,0,1e12,true,true);return;
 }
 if(kind==='scope'){
 fields(r,['id','pilot_id','account_id','supersedes','keyword','identity','rows','columns','center_latitude','center_longitude','spacing','unit','points','expected_points','depth','cadence','occurrences','budget','reason','created_at'],'Scope');
 const a=ref(s.accounts,r.account_id,'Account snapshot');if(a.pilot_id!==r.pilot_id)fail('Account belongs to another pilot.');
 if(r.supersedes&&ref(s.scopes,r.supersedes,'Previous scope').pilot_id!==r.pilot_id)fail('Previous scope belongs to another pilot.');
 text(r.keyword,'Keyword');text(r.reason,'Grid rationale');date(r.created_at,'Scope time');if(canonical(r.identity)!==canonical({client:pilot.client,location:pilot.location,address:pilot.address,place_id:pilot.place_id,provider_business_id:pilot.provider_business_id}))fail('Scope identity must match the selected pilot.');
 for(const k of ['rows','columns']){number(r[k],k,1,101,true);if(r[k]%2!==1)fail('Grid sides must be odd.');if(a.grid_ceiling!==null&&r[k]>a.grid_ceiling)fail('Grid exceeds the observed account ceiling.');}
 for(const k of ['center_latitude','center_longitude'])number(r[k],k,k==='center_latitude'?-90:-180,k==='center_latitude'?90:180,false,true);
 number(r.spacing,'Spacing',0.000001,1e6,false,true);one(r.unit,['km','mi','m','unknown'],'spacing unit');number(r.expected_points,'Expected points',1,10201,true);if(r.expected_points!==r.rows*r.columns)fail('Expected points must match rows × columns.');
 number(r.depth,'Received search depth',1,1e6,true,true);one(r.cadence,['one_off','weekly','biweekly','monthly','custom'],'cadence');number(r.occurrences,'Planned occurrences',1,10000,true);number(r.budget,'Budget ceiling',0,1e12,true,true);if(r.budget!==null&&r.expected_points*r.occurrences>r.budget)fail('Planned point estimate exceeds the entered budget. Change the plan or budget.');
 list(r.points,'Expected points');if(r.points.length&&r.points.length!==r.expected_points)fail('Enter all expected coordinates, or leave coordinates empty for summary-only intake.');for(const p of r.points){fields(p,['id','latitude','longitude'],'Expected point');text(p.id,'Point id');coord(p);}if(!unique(r.points.map(p=>p.id))||!unique(r.points.map(coord)))fail('Expected point ids and coordinates must be unique.');return;
 }
 if(kind==='attachment'){
 fields(r,['id','pilot_id','name','media_type','content_base64','bytes','sha256','source','received_at','visibility'],'Attachment');
 for(const k of ['name','media_type','source'])text(r[k],k);if(/[\\\/\u0000-\u001f]/.test(r.name))fail('Use an ordinary filename.');date(r.received_at,'Received time');one(r.visibility,['internal','client_selected'],'attachment visibility');
 number(r.bytes,'File size',0,5*1024*1024,true);const b=normalizeBase64(r.content_base64);if(b.length!==r.bytes||Sha.sha256Bytes(b).sha256!==r.sha256)fail('Attachment size or SHA differs from its original bytes.');return;
 }
 if(kind==='observation'){
 fields(r,['id','pilot_id','scope_id','correction_of','correction_reason','provider','provider_scan_id','mode','status','captured_at','entered_by','source','attachment_ids','provider_metrics','points','quote_credits','actual_credits','notes'],'Observation');
 const scope=ref(s.scopes,r.scope_id,'Scope');if(scope.pilot_id!==r.pilot_id)fail('Scope belongs to another pilot.');
 if(r.correction_of){const old=ref(s.observations,r.correction_of,'Corrected observation');if(old.pilot_id!==r.pilot_id)fail('Correction belongs to another pilot.');text(r.correction_reason,'Correction reason');}else text(r.correction_reason,'Correction reason',false);
 for(const k of ['provider','entered_by','source'])text(r[k],k);text(r.provider_scan_id,'Provider scan id',false);text(r.notes,'Notes',false);date(r.captured_at,'Capture time');one(r.mode,['original_file','provider_result','manual_transcription','summary_only'],'capture mode');one(r.status,['completed','partial','failed'],'status');
 for(const k of ['quote_credits','actual_credits'])number(r[k],k,0,1e12,true,true);
 fields(r.provider_metrics,['average_rank','best_rank','top3_coverage','convention_source'],'Vendor metrics');for(const v of Object.values(r.provider_metrics))text(v,'Vendor metric',false);
 list(r.attachment_ids,'Attachment references');for(const id of r.attachment_ids)if(ref(s.attachments,id,'Attachment').pilot_id!==r.pilot_id)fail('Attachment belongs to another pilot.');
 list(r.points,'Received points');if(r.mode==='summary_only'&&r.points.length)fail('Summary-only observations cannot contain point rows.');
 if(r.points.length&&!scope.points.length)fail('Receive exact expected geometry before entering point results.');
 for(const p of r.points){fields(p,['id','latitude','longitude','state','rank','source','error'],'Result point');const expected=ref(scope.points,p.id,'Expected point');if(coord(p)!==coord(expected))fail('Received point coordinates differ from scope.');one(p.state,['ranked','not_found','error','missing'],'point outcome');number(p.rank,'Rank',1,1000000,true,true);if((p.state==='ranked')!==(p.rank!==null))fail('Only ranked points have a positive rank.');text(p.source,'Point source');text(p.error,'Point error',false);if(p.state==='error'&&!p.error.trim())fail('Retain the point error text.');}
 if(!unique(r.points.map(p=>p.id)))fail('A result contains duplicate points.');
 return;
 }
 if(kind==='finding'){
 fields(r,['id','pilot_id','scope_id','observation_ids','title','observed','hypothesis','owner','action','due','status'],'Finding');const scope=ref(s.scopes,r.scope_id,'Scope');if(scope.pilot_id!==r.pilot_id)fail('Finding scope belongs to another pilot.');list(r.observation_ids,'Observation references');if(!r.observation_ids.length)fail('Select an actual observation.');for(const id of r.observation_ids)if(ref(s.observations,id,'Observation').pilot_id!==r.pilot_id)fail('Finding observation belongs to another pilot.');for(const k of ['title','observed'])text(r[k],k);for(const k of ['hypothesis','owner','action','due'])text(r[k],k,false);one(r.status,['open','in_progress','done','deferred'],'finding status');return;
 }
 if(kind==='decision'){
 fields(r,['id','pilot_id','baseline_id','followup_id','outcome','rationale','decided_by','decided_at','next_date','client_summary','basis','basis_revision'],'Decision');
 const base=ref(s.observations,r.baseline_id,'Baseline');if(base.pilot_id!==r.pilot_id)fail('Baseline belongs to another pilot.');if(r.followup_id&&ref(s.observations,r.followup_id,'Follow-up').pilot_id!==r.pilot_id)fail('Follow-up belongs to another pilot.');
 one(r.outcome,['continue_observation','approve_action','revise_scope','finish_pilot','pending'],'decision');for(const k of ['rationale','client_summary'])text(r[k],k);text(r.decided_by,'Decision maker',r.outcome!=='pending');date(r.decided_at,'Decision time',r.outcome!=='pending');text(r.next_date,'Next review date',false);
 if(r.outcome!=='pending'){const identity=Object.fromEntries(['client','location','address','place_id','provider_business_id'].map(k=>[k,pilot[k]]));for(const obs of [base,r.followup_id?ref(s.observations,r.followup_id,'Follow-up'):null].filter(Boolean)){if(canonical(ref(s.scopes,obs.scope_id,'Scope').identity)!==canonical(identity))fail('Selected observations belong to an earlier client/location identity. Create and receive the current scope before a completed decision.');}}
 if(r.basis!==relevant(s,r.pilot_id)||r.basis_revision!==s.revision)fail('Decision basis changed; review the current pilot.');if(pilot.identity_review!=='matched'&&r.outcome!=='pending')fail('Review the selected business identity before recording a completed client decision.');return;
 }
 if(kind==='publication'){
 fields(r,['id','pilot_id','decision_id','status','source_revision','attachment_ids','report_url','recipient','reviewer','at','note'],'Publication');
 const d=ref(s.decisions,r.decision_id,'Decision');if(d.pilot_id!==r.pilot_id)fail('Decision belongs to another pilot.');one(r.status,['unpublished','approved','shared','withdrawn'],'publication status');if(r.source_revision!==d.basis_revision)fail('Select the exact decision source revision.');
 if(['approved','shared'].includes(r.status)&&(!decisionCurrent(s,d)||d.outcome==='pending'))fail('Review the current completed client decision before approval/sharing.');
 list(r.attachment_ids,'Selected attachments');for(const id of r.attachment_ids){const a=ref(s.attachments,id,'Attachment');if(a.pilot_id!==r.pilot_id||a.visibility!=='client_selected')fail('Client packets may select only this pilot’s client-selected attachments.');}
 for(const k of ['report_url','recipient','reviewer','note'])text(r[k],k,false);if(r.report_url&&!/^https?:\/\//.test(r.report_url))fail('Use an actual HTTP(S) report URL.');date(r.at,'Publication time');if(['approved','shared'].includes(r.status))text(r.reviewer,'Publication reviewer');if(r.status==='shared')text(r.recipient,'Actual recipient');return;
 }
 fail('Unknown record kind.');
}
const kindCollection={pilot:'pilots',account:'accounts',scope:'scopes',attachment:'attachments',observation:'observations',finding:'findings',decision:'decisions',publication:'publications'};
function run(s,event){
 fields(event,['revision','expected_revision','kind','record','actor','at'],'Operation');if(event.expected_revision!==s.revision||event.revision!==s.revision+1)fail('This operation is based on another working revision.');text(event.actor,'Operator');date(event.at,'Operation time');
 validateRecord(s,event.kind,event.record);const key=kindCollection[event.kind],old=s[key].findIndex(x=>x.id===event.record.id);
 if(old!==-1&&!['pilot','finding'].includes(event.kind))fail('Preserve the original record; add a new version/correction instead.');
 const out=clone(s);delete out.sha256;if(old===-1)out[key].push(clone(event.record));else out[key][old]=clone(event.record);out.revision=event.revision;out.history.push(clone(event));return out;
}
function apply(workspace,{kind,record,actor,at,expected_revision}){
 const s=receive(workspace,workspace.seed);if(expected_revision!==s.revision)fail('A newer working revision is available. Reopen it before saving.');
 return seal(run(s,{revision:s.revision+1,expected_revision,kind,record:clone(record),actor,at}));
}
function receive(input,expectedSeed){
 fields(input,['schema','seed','revision',...collections,'history','sha256'],'Working file');if(input.schema!=='maprank.agency-pilot.v1')fail('Choose a MapRank pilot working file.');seedCheck(input.seed);if(expectedSeed&&digest(expectedSeed)!==digest(input.seed))fail('This file belongs to a different original customer selection.');const original=clone(input);delete original.sha256;if(digest(original)!==input.sha256)fail('Working file checksum differs.');
 let state=initial(input.seed);for(const ev of list(input.history,'History'))state=run(state,ev);state=seal(state);if(canonical(state)!==canonical(input))fail('Working file does not match its complete operation history.');return clone(state);
}
function metrics(s,observation){
 const scope=ref(s.scopes,observation.scope_id,'Scope'),points=observation.points,ranked=points.filter(p=>p.state==='ranked'),notFound=points.filter(p=>p.state==='not_found').length,errors=points.filter(p=>p.state==='error').length,evaluated=ranked.length+notFound,missing=scope.expected_points-evaluated-errors,top3=ranked.filter(p=>p.rank<=3).length,top10=ranked.filter(p=>p.rank<=10).length;
 const complete=scope.points.length===scope.expected_points&&evaluated===scope.expected_points;
 return {planned:scope.expected_points,evaluated,ranked:ranked.length,not_found:notFound,error:errors,missing,complete,top3,top10,top3_grid:complete?100*top3/scope.expected_points:null,top10_grid:complete?100*top10/scope.expected_points:null,top3_evaluated:evaluated?100*top3/evaluated:null,found_only_mean:ranked.length?ranked.reduce((n,p)=>n+p.rank,0)/ranked.length:null,best_rank:ranked.length?Math.min(...ranked.map(p=>p.rank)):null};
}
function compare(s,baselineId,followupId){
 const b=ref(s.observations,baselineId,'Baseline'),f=ref(s.observations,followupId,'Follow-up'),bs=ref(s.scopes,b.scope_id,'Baseline scope'),fs=ref(s.scopes,f.scope_id,'Follow-up scope'),differences=[];
 for(const k of ['pilot_id','keyword','identity','rows','columns','center_latitude','center_longitude','spacing','unit','depth'])if(canonical(bs[k])!==canonical(fs[k]))differences.push(k);
 const geometry=x=>x.points.map(p=>coord(p)).sort();if(canonical(geometry(bs))!==canonical(geometry(fs)))differences.push('coordinates');
 const status=differences.length?'different_scope':!bs.points.length||!fs.points.length?'unconfirmed':'eligible',bm=metrics(s,b),fm=metrics(s,f),joined=[];
 if(status==='eligible'){const fmBy=new Map(f.points.map(p=>[coord(p),p]));for(const expected of bs.points){const bp=b.points.find(p=>coord(p)===coord(expected)),fp=fmBy.get(coord(expected));joined.push({point:expected.id,latitude:expected.latitude,longitude:expected.longitude,baseline:bp?.state??'missing',followup:fp?.state??'missing',baseline_rank:bp?.rank??null,followup_rank:fp?.rank??null,positions_gained:bp?.state==='ranked'&&fp?.state==='ranked'?bp.rank-fp.rank:null});}}
 return{status,differences,baseline:bm,followup:fm,top3_percentage_points:status==='eligible'&&bm.top3_grid!==null&&fm.top3_grid!==null?fm.top3_grid-bm.top3_grid:null,joined};
}
function parsePoints(value,result=false){if(!value.trim())return[];return value.split(/\r?\n/).filter(line=>line.trim()).map((line,i)=>{const a=line.split('\t');const min=result?6:3;if(a.length!==min&&!(result&&a.length===7))fail('Line '+(i+1)+' needs '+min+' tab-separated columns, without a header.');const p={id:a[0].trim(),latitude:Number(a[1]),longitude:Number(a[2])};if(!a[1].trim()||!a[2].trim())fail('Point coordinates cannot be blank.');if(result)Object.assign(p,{state:a[3].trim(),rank:a[4].trim()?Number(a[4]):null,source:a[5],error:a[6]||''});return p;});}
function clientPacket(s,decisionId,attachmentIds=[]){
 s=receive(s,s.seed);const d=ref(s.decisions,decisionId,'Decision');if(!decisionCurrent(s,d)||d.outcome==='pending')fail('Select a completed current decision for a client handover.');
 const baseline=ref(s.observations,d.baseline_id,'Baseline'),followup=d.followup_id?ref(s.observations,d.followup_id,'Follow-up'):null;
 const currentPilot=ref(s.pilots,d.pilot_id,'Pilot'),identity=Object.fromEntries(['client','location','address','place_id','provider_business_id'].map(k=>[k,currentPilot[k]]));for(const o of [baseline,followup].filter(Boolean))if(canonical(ref(s.scopes,o.scope_id,'Scope').identity)!==canonical(identity))fail('Client handover identity differs from its original observations.');
 const attachments=attachmentIds.map(id=>{const a=ref(s.attachments,id,'Attachment');if(a.pilot_id!==d.pilot_id||a.visibility!=='client_selected')fail('An attachment is not selected for this client.');return clone(a);});
 const clientObservation=o=>{if(!o)return null;const c=clone(o);delete c.notes;return c;};
 const packet={schema:'maprank.client-handover.v1',agency:(()=>{const a=ref(s.seed.agencies,ref(s.pilots,d.pilot_id,'Pilot').agency_id,'Agency').document;return{name:a.organization,website:a.company_url};})(),client:ref(s.pilots,d.pilot_id,'Pilot').client,location:ref(s.pilots,d.pilot_id,'Pilot').location,decision:clone(d),scopes:[...new Set([baseline.scope_id,followup?.scope_id].filter(Boolean))].map(id=>clone(ref(s.scopes,id,'Scope'))),baseline:clientObservation(baseline),followup:clientObservation(followup),comparison:followup?compare(s,baseline.id,followup.id):null,baseline_metrics:metrics(s,baseline),attachments,source_working_sha256:s.sha256};
 return seal(packet);
}
module.exports={create,receive,apply,seal,digest,canonical,metrics,compare,parsePoints,clientPacket,decisionCurrent,relevant,normalizeBase64};