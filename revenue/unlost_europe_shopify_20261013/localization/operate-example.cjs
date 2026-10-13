'use strict';
function operateExample(api,initial){
 let state=api.receive(api.exportWorking(initial),initial.selection);
 const merchantId=state.selection.leadIds[0],events=[];
 const act=(kind,input)=>{const request={operationId:'tjl-example-'+String(events.length+1),expectedRevision:state.revision,merchantId,kind,input};const result=api.apply(state,request,'2026-10-13T12:00:'+String(events.length).padStart(2,'0')+'.000Z');state=result.state;events.push({request,revision:state.revision,changed:result.changed});return request;};
 act('project.save',{targetLocale:'fr',currentTool:'Not confirmed; preparation example only',productUrl:state.research[0].record.source_url,reviewer:'TJL preparation operator',tone:'formal',objective:'Work through a prepared localization note, retaining original merchant context and human edits.',commercialNotes:'Internal worked example. Merchant agreement and trial eligibility remain blank.',notes:'This separate worked workspace demonstrates the actual application with an authored preparation note; the delivered opening workspace is empty.'});
 act('glossary.save',{id:'example-designer',source:'designer',target:'designer',locale:'fr',keepUnchanged:true,caseSensitive:false,notes:'Prepared reminder for this example.'});
 const content={id:'example-pilot-note',resourceType:'other',field:'Preparation note',url:state.research[0].record.source_url,locale:'fr',sourceText:'Preserve designer names, dimensions and condition notes.',translation:'Conserver les noms des designers, les dimensions et les remarques sur l’état.',notes:'TJL-authored note derived from the existing preparation brief, not captured merchant catalog text.'};
 act('unit.save',content);
 const review=act('review.record',{id:content.id,status:'approved',reviewer:'TJL preparation operator',notes:'Authored French preparation note reviewed for this working example.'});
 if(api.stage(state.merchants[merchantId],state.merchants[merchantId].units[0])!=='approved')throw Error('The saved decision did not bind its exact entered content');
 act('handover.save',{id:'original-preparation',title:'Original preparation note'});
 const originalTranslation=state.merchants[merchantId].units[0].translation;
 act('unit.save',{...content,sourceText:content.sourceText+' Keep shipping-quote instructions.'});
 let row=state.merchants[merchantId].units[0];
 if(row.translation!==originalTranslation||api.stage(state.merchants[merchantId],row)!=='changed_since_review'||row.sourceVersion!==2)throw Error('The source update must preserve the entered translation and earlier decision');
 const before=api.exportWorking(state);let stale=false;
 try{api.apply(state,{operationId:'stale-example',expectedRevision:0,merchantId,kind:'project.save',input:state.merchants[merchantId].project},'2026-10-13T12:01:00.000Z');}catch(error){stale=/workspace changed/.test(error.message);}
 if(!stale||JSON.stringify(api.exportWorking(state))!==JSON.stringify(before))throw Error('A stale edit changed the actual workspace');
 act('unit.save',{...row,translation:originalTranslation+' Conserver les instructions relatives au devis de livraison.'});
 act('review.record',{id:content.id,status:'approved',reviewer:'TJL preparation operator',notes:'The added shipping-quote sentence is included.'});
 act('glossary.save',{id:'example-shipping',source:'shipping-quote',target:'devis de livraison',locale:'fr',keepUnchanged:false,caseSensitive:false,notes:'Use the complete shipping context.'});
 if(api.stage(state.merchants[merchantId],state.merchants[merchantId].units[0])!=='changed_since_review')throw Error('The changed applicable glossary must require a new review');
 act('review.record',{id:content.id,status:'approved',reviewer:'TJL preparation operator',notes:'Reviewed the current source, entered translation and both glossary terms.'});
 act('handover.save',{id:'updated-preparation',title:'Updated preparation note'});
 const working=api.exportWorking(state),received=api.receive(working,initial.selection);
 if(JSON.stringify(api.exportWorking(received))!==JSON.stringify(working))throw Error('The complete working file did not reopen exactly');
 const replay=api.apply(received,review,'2026-10-13T12:02:00.000Z');
 if(!replay.replayed||replay.changed||replay.originalRevision!==4||JSON.stringify(replay.state)!==JSON.stringify(received))throw Error('Original-request replay must preserve all later work');
 const csv=api.csv(received,merchantId);
 return{schema:'tjlabs.localization-worked-operation.v1',description:'Actual original engine operating an explicitly authored preparation example, separate from the empty customer workspace.',requests:events,working,csv,summary:api.summary(received,merchantId),reopenedEqual:true,sourceUpdatePreservedTranslation:true,applicableGlossaryRequiredNewReview:true,staleEditPreservedState:true,originalRequestReplayPreservedLaterWork:true};
}
module.exports={operateExample};
