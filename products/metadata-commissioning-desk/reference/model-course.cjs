'use strict';
/* Focused exact-source model course. Authored observations are explicitly labelled. */
function runModelCourse(M,fixtureText){
 const need=(v,m)=>{if(!v)throw Error(m);},member=(n,k)=>n.items.find(([a])=>a===k)?.[1],ast=M.parseExact(fixtureText),findings=[];
 need(ast.type==='array','Keep the complete original upstream fixture.');
 let selected;
 for(const r of ast.items){const proposed=member(r,'proposedSnapshot');if(!proposed)continue;for(const [kind,snapshot]of proposed.items){
  if(!kind.endsWith('.DatasetSnapshot'))continue;
  const urn=member(snapshot,'urn').value,aspects=member(snapshot,'aspects');
  for(const item of aspects.items)for(const [name,value]of item.items)if(name.endsWith('.DatasetProperties')&&!selected)selected={urn,text:value.raw};
 }}
 need(selected,'Original datasetProperties aspect must be present.');
 const source={schema:'tjl.datahub.observation.v1',role:'source',label:'Model course: exact original datasetProperties extraction',entries:[{urn:selected.urn,exists:true,aspects:{datasetProperties:selected.text}}],errors:[],timeseries:[],originals:[{name:'bootstrap_mce.json',text:fixtureText}],course_scope:'Source-model exercise; actual pinned SDK normalization and GMS receiving are separate.'};
 const authored=JSON.parse(selected.text);authored.description=(authored.description||'')+' [authored comparison exercise]';
 const target={schema:'tjl.datahub.observation.v1',role:'target',label:'Authored model-course target; no GMS request',target_url:'http://127.0.0.1:8080',entries:[{urn:selected.urn,exists:true,aspects:{datasetProperties:JSON.stringify(authored)}}],errors:[],timeseries:[],originals:[]};
 const w=M.newWorkspace('Exact source model course');M.importObservation(w,JSON.stringify(source),'Original aspect');M.importObservation(w,JSON.stringify(target),'Authored comparison');w.selection.target_url=target.target_url;w.selection.reviewer='Source model course';
 let c=M.compare(w);need(c.counts.different===1,'Original difference must remain visible.');
 M.decision(w,c.id,c.rows[0].key,'correct','Source model course','Retain complete original aspect as intended correction.');
 const proposal=M.propose(w,selected.urn,'datasetProperties',selected.text,'Source model course','Restore exact original datasetProperties in authored comparison.');
 const plan=M.proposalPacket(w,[proposal.id],'Authored source-model plan','Source model course');
 need(plan.changes[0].after_json===selected.text,'Original aspect text must remain exact.');
 need(M.canonical('{"n":9007199254740993}')!==M.canonical('{"n":9007199254740992}'),'Large integers merged.');
 need(M.canonical('{"n":1.0000000000000000001}')!==M.canonical('{"n":1.0}'),'Decimal tokens merged.');
 need(M.canonical('{"b":2,"a":1}')===M.canonical('{"a":1,"b":2}'),'Object order altered semantic comparison.');
 let duplicate=false;try{M.parseExact('{"a":1,"a":2}');}catch{duplicate=true;}need(duplicate,'Duplicate keys must be visible.');
 M.edition(w,'Before authored after observation');
 const next=M.copy(target);next.label='Authored after observation; no GMS request';next.entries[0].aspects.datasetProperties=selected.text;M.importObservation(w,JSON.stringify(next));
 const r=M.proposeRevert(w,proposal.id,'Source model course','Reviewed authored revert against fresh observation.');
 need(r.after_json===proposal.before_json&&r.before_json===proposal.after_json,'Revert must use exact original before and fresh after.');
 need(M.currentDecisions(w,M.compare(w)).size===0,'Old comparison decision must not accept a new target.');
 w.editorDrafts.keep={reason:'Unfinished reviewer writing',aspect_json:'{"unfinished":'};
 const before=JSON.stringify(w),restored=M.restoreEdition(w,w.editions[0].id);
 need(restored.received_originals.some(x=>x.text===before),'Restore lost displaced full project.');
 const incoming=M.receiveWorkspace(restored,JSON.stringify({working:w,rawDraft:'{"unfinished incoming":'}));
 need(incoming.rawDraft==='{"unfinished incoming":'&&incoming.working.editorDrafts.keep.reason==='Unfinished reviewer writing','Reopen lost writing.');
 findings.push('Exact original aspect retained','Large integer and decimal tokens distinct','Duplicate keys rejected','Object key order ignored','Proposal bound to original target','Fresh revert retains original values','New comparison needs its own decisions','Named restore retains full displaced work','Complete reopen retains unfinished writing');
 return {schema:'tjl.datahub.model-course.v1',fixture_records:ast.items.length,selected_original_urn:selected.urn,findings,workspace:incoming.working,rawDraft:incoming.rawDraft,plan,observations_are_authored:true,native_requests:0};
}
if(typeof module!=='undefined')module.exports={runModelCourse};
