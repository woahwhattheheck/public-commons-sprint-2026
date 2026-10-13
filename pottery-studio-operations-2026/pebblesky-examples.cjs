/* SPDX-License-Identifier: MIT */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.PebbleStudioExamples=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
function* programme(C,catalogue,ctx){
 const ids={},walkthrough=[];ctx.ids=ids;ctx.walkthrough=walkthrough;
 const send=(type,body)=>({type,...body});
 const review=(kind,id)=>({id,expectedReviewSha256:C[kind](ctx.workspace,id).reviewSha256});
 const person=(studio,key,name)=>send('person-save',{person:{id:key,studioKey:studio,name,email:'',externalRef:'demonstration-only',notes:'Invented walkthrough participant; no customer history.'}});
 const session=(studio,id,title,kind,start,end,capacity,resourceIds,programmeId,membershipRequired=false)=>send('session-save',{session:{id,studioKey:studio,title,kind,start,end,timezone:catalogue.studios.find(x=>x.key===studio).timezone,capacity,resourceIds,programmeId,membershipRequired,notes:'Operator-selected demonstration time/resources. Confirm actual availability before real use.'}});
 const booking=(studio,id,personId,sessionId,membershipId='',units=1,extra={})=>send('booking-save',{booking:{id,studioKey:studio,personId,sessionId,membershipId,units,...extra}});
 const membership=(studio,id,personId,access,unit,opening,limits)=>send('membership-save',{membership:{id,studioKey:studio,personId,name:'Demonstration membership',access,validFrom:'2026-10-01',validTo:'2026-10-31',unit,opening,limits,notes:'Explicit commissioning choice; original source rules remain in the catalogue.',sourceUrls:catalogue.studios.find(x=>x.key===studio).sourceUrls}});
 const piece=(studio,id,ownerId,label,programmeCone,bookingId='',stage='greenware')=>send('piece-save',{piece:{id,studioKey:studio,ownerId,label,material:'Operator-selected demonstration clay body',cone:programmeCone,stage,bookingId,externalRef:id.toUpperCase(),notes:'Demonstration piece. Actual material, dryness and glaze compatibility require staff inspection.',gallery:'private'}});
 function* approvedSession(command){yield command;yield send('session-approve',review('reviewSession',command.session.id));}
 function* confirm(command){yield command;yield send('booking-confirm',review('reviewBooking',command.booking.id));}
 function* clear(pieceId,programmeId){yield send('piece-clear',{id:pieceId,programmeId,approved:true,reason:'Demonstration technician explicitly checks the chosen body, stage, glaze and programme. This entry is an operating example.'});}
 function* loadCycle(studio,id,name,pieceIds,programmeId,day,outcomes,finish=true){for(const p of pieceIds)yield* clear(p,programmeId);
  yield send('load-save',{load:{id,studioKey:studio,name,kilnId:studio+'-kiln',programmeId,pieceIds,plannedStart:day+'T08:00:00Z',plannedEnd:day+'T20:00:00Z',timezone:catalogue.studios.find(s=>s.key===studio).timezone,capacityAcknowledged:true,notes:'Demonstration operator-selected load; planned interval does not assert a firing duration.'}});
  yield send('load-approve',review('reviewLoad',id));if(!finish)return;
  yield send('load-start',{...review('reviewLoad',id),actualAt:day+'T08:00:00Z'});
  yield send('load-cooling',{id,actualAt:day+'T12:00:00Z',notes:'Demonstration operator records transition after actual kiln observation.'});
  yield send('load-unload',{id,actualAt:day+'T20:00:00Z',outcomes:pieceIds.map((pieceId,i)=>({pieceId,result:outcomes[i],notes:'Explicit demonstration outcome, not an elapsed-time inference.'}))});
 }
 for(const studio of catalogue.studios){const key=studio.key;ids[key]={member:key+'-member',maker:key+'-maker',room:key+'-room',kiln:key+'-kiln',classProgramme:key+'-class',accessProgramme:key+'-access',firingProgramme:key+'-firing'};
  yield person(key,key+'-member','Demo member — '+studio.name);yield person(key,key+'-maker','Demo outside maker — '+studio.name);
  yield send('resource-save',{resource:{id:key+'-room',studioKey:key,name:'Demonstration teaching room',kind:'room',capacity:key==='stones-throw'?6:key==='zed-alley'?8:6,notes:'Configured for this example; website counts do not create physical inventory.'}});
  yield send('resource-save',{resource:{id:key+'-kiln',studioKey:key,name:'Demonstration kiln A',kind:'kiln',capacity:null,notes:'Actual asset and loading capacity require local operator entry.'}});
  yield send('programme-save',{programme:{id:key+'-class',studioKey:key,name:'Demonstration taught session',kind:'class',makeupLimit:key==='west-end'?2:null,sourceUrls:studio.sourceUrls}});
  yield send('programme-save',{programme:{id:key+'-access',studioKey:key,name:'Demonstration member access',kind:'member-access',sourceUrls:studio.sourceUrls}});
  yield send('programme-save',{programme:{id:key+'-firing',studioKey:key,name:'Demonstration reviewed firing',kind:'firing',cone:key==='garret-pendergrass'?'^06–^04':key==='west-end'?'Cone 10':'Operator-selected cone 6',materials:'Demonstration body/glaze selection; staff must clear each piece.',instructions:'Use the real studio’s approved operating instructions. This programme does not control a kiln.',sourceUrls:studio.sourceUrls}});
 }
 const stone='stones-throw';
 yield* approvedSession(session(stone,'stone-taster','Six-place throwing taster','class','2026-10-05T09:00:00Z','2026-10-05T12:00:00Z',6,[stone+'-room'],stone+'-class'));
 for(let i=1;i<=7;i++){yield person(stone,'stone-student-'+i,'Demo taster participant '+i);yield booking(stone,'stone-place-'+i,'stone-student-'+i,'stone-taster');if(i<=6)yield send('booking-confirm',review('reviewBooking','stone-place-'+i));}
 yield send('booking-attend',review('reviewBooking','stone-place-1'));
 yield piece(stone,'stone-bowl','stone-student-1','Taster bowl — ready collection','Operator-selected cone 6','stone-place-1');
 yield piece(stone,'stone-cup','stone-student-1','Taster cup — collected','Operator-selected cone 6','stone-place-1');
 yield* loadCycle(stone,'stone-load','Taster pieces / reviewed final programme',['stone-bowl','stone-cup'],stone+'-firing','2026-10-06',['finished','finished']);
 yield send('notice-prepare',{notice:{id:'stone-ready-note',studioKey:stone,personId:'stone-student-1',pieceIds:['stone-bowl','stone-cup'],channel:'other',destination:'Demonstration only',body:'Your demonstration bowl and cup are ready. Check the studio’s current collection times before visiting.'}});
 yield send('notice-record',{id:'stone-ready-note',sentAt:ctx.workspace.updatedAt,reference:'DEMO-MANUAL-RECORD-ONLY / no transport called'});
 yield send('piece-pickup',{id:'stone-cup',collector:'Demo participant 1',actualAt:ctx.workspace.updatedAt,notes:'Demonstration partial collection; bowl stays ready.'});
 yield send('notice-prepare',{notice:{id:'stone-reminder-draft',studioKey:stone,personId:'stone-student-1',pieceIds:['stone-bowl'],channel:'other',destination:'Demonstration only',body:'Prepared collection reminder for the remaining demonstration bowl. Confirm the current collection timetable before recording any actual send.'}});
 yield membership(stone,'stone-month',stone+'-member','booked','minutes',null,[{period:'month',unit:'minutes',maximum:720}]);
 yield* approvedSession(session(stone,'stone-member-session','Three-hour member session','member-access','2026-10-09T09:00:00Z','2026-10-09T12:00:00Z',6,[stone+'-room'],stone+'-access',true));
 yield* confirm(booking(stone,'stone-member-booking',stone+'-member','stone-member-session','stone-month',180));
 yield send('booking-attend',review('reviewBooking','stone-member-booking'));
 walkthrough.push({studioKey:stone,focus:'Six seats, seventh request remains unconfirmed; explicit final firing, manual notice record and partial pickup; calendar-month minutes.',ids:['stone-taster','stone-place-7','stone-bowl','stone-cup','stone-month']});
 const garret='garret-pendergrass';
 yield piece(garret,'garret-trial-work',garret+'-maker','Trial piece / no retained shelf decision','^06–^04');
 yield send('piece-withdraw',{id:'garret-trial-work',reason:'Demonstration trial ended without membership/shelf space; operator chose withdrawal. No automatic firing entitlement.'});
 yield membership(garret,'garret-member-plan',garret+'-member','booked','visits',null,[]);
 yield piece(garret,'garret-bisque',garret+'-member','Member piece — bisque queue','^06–^04');
 yield* loadCycle(garret,'garret-load','Exact leading-zero cone notation',['garret-bisque'],garret+'-firing','2026-10-10',['bisqued'],false);
 walkthrough.push({studioKey:garret,focus:'Exact ^06–^04 string and reviewed pending kiln load; shelf quota stays a dimensioned source rule, not fabricated visit credit.',ids:['garret-load','garret-trial-work','garret-member-plan']});
 const west='west-end';
 yield membership(west,'west-open',west+'-member','booked','visits',null,[{period:'week',unit:'visits',maximum:3}]);
 for(let i=0;i<4;i++){const date='2026-10-'+String(5+i).padStart(2,'0'),sid='west-access-'+i,bid='west-access-booking-'+i;
  yield* approvedSession(session(west,sid,'Weekly member visit '+(i+1),'member-access',date+'T14:00:00Z',date+'T17:00:00Z',6,[west+'-room'],west+'-access',true));
  yield booking(west,bid,west+'-member',sid,'west-open',1);if(i<3)yield send('booking-confirm',review('reviewBooking',bid));}
 yield send('programme-save',{programme:{id:'west-dropoff-programme',studioKey:west,name:'Firing membership dropoff',kind:'firing-dropoff',sourceUrls:catalogue.studios.find(x=>x.key===west).sourceUrls}});
 yield membership(west,'west-firing-member',west+'-maker','firing-only','visits',null,[{period:'week',unit:'visits',maximum:1}]);
 yield* approvedSession(session(west,'west-dropoff','Home-maker weekly firing dropoff','firing-dropoff','2026-10-09T14:00:00Z','2026-10-09T14:30:00Z',1,[],'west-dropoff-programme',true));
 yield* confirm(booking(west,'west-dropoff-booking',west+'-maker','west-dropoff','west-firing-member',1));
 yield send('booking-attend',review('reviewBooking','west-dropoff-booking'));
 yield* approvedSession(session(west,'west-original-class','Original course class','class','2026-10-02T15:00:00Z','2026-10-02T18:00:00Z',6,[west+'-room'],west+'-class'));
 yield* confirm(booking(west,'west-original-booking',west+'-member','west-original-class','',1,{courseRef:'DEMO-AUTUMN-COURSE'}));
 yield send('booking-missed',{id:'west-original-booking',consume:false,reason:'Demonstration absence; operator retains possible course makeup.'});
 yield* approvedSession(session(west,'west-makeup-class','Alternative class with actual space','class','2026-10-10T15:00:00Z','2026-10-10T18:00:00Z',6,[west+'-room'],west+'-class'));
 yield* confirm(booking(west,'west-makeup-booking',west+'-member','west-makeup-class','',1,{courseRef:'DEMO-AUTUMN-COURSE',makeupOf:'west-original-booking'}));
 walkthrough.push({studioKey:west,focus:'Fourth weekly visit remains requested; firing-only dropoff has its own access type; makeup preserves original absence and real alternative place.',ids:['west-access-booking-3','west-dropoff-booking','west-makeup-booking']});
 const mud='mudworks';
 yield membership(mud,'mud-unbooked',mud+'-member','unbooked','visits',null,[]);
 yield* approvedSession(session(mud,'mud-open-access','Actual member access window','member-access','2026-10-07T08:00:00Z','2026-10-07T10:00:00Z',6,[mud+'-room'],mud+'-access',true));
 yield booking(mud,'mud-arrival',mud+'-member','mud-open-access','mud-unbooked',1);
 yield send('booking-attend',review('reviewBooking','mud-arrival'));
 yield send('programme-save',{programme:{id:'mud-booked-open',studioKey:mud,name:'Booked open studio / studio materials',kind:'open-studio',materials:'Only studio-provided clay and glazes in this source route.',sourceUrls:catalogue.studios.find(x=>x.key===mud).sourceUrls}});
 yield* approvedSession(session(mud,'mud-booked-session','Booked two-hour open studio','open-studio','2026-10-08T08:00:00Z','2026-10-08T10:00:00Z',6,[mud+'-room'],'mud-booked-open'));
 yield* confirm(booking(mud,'mud-booked-place',mud+'-maker','mud-booked-session','',1,{externalRef:'DEMO-ACUITY-ORIGINAL-REFERENCE'}));
 yield piece(mud,'mud-wip',mud+'-maker','Open-session WIP / original booking retained','Operator-selected cone 6','mud-booked-place');
 walkthrough.push({studioKey:mud,focus:'Unbooked member records attendance without a reservation; separate booked Acuity-referenced route retains its studio-material and WIP source.',ids:['mud-arrival','mud-booked-place','mud-wip']});
 const long='longtom';
 yield membership(long,'long-weekly',long+'-member','booked','minutes',null,[{period:'week',unit:'minutes',maximum:180}]);
 yield* approvedSession(session(long,'long-session','Chosen one weekly three-hour allocation','member-access','2026-10-09T17:00:00Z','2026-10-09T20:00:00Z',6,[long+'-room'],long+'-access',true));
 yield* confirm(booking(long,'long-member-place',long+'-member','long-session','long-weekly',180));
 yield piece(long,'long-awaiting',long+'-member','Member piece awaiting actual technical review','Operator-selected cone 6','long-member-place');
 walkthrough.push({studioKey:long,focus:'Explicit weekly interpretation; monthly marketing total is retained separately. Piece readiness does not advance after four weeks by itself.',ids:['long-weekly','long-awaiting']});
 const zed='zed-alley';
 yield membership(zed,'zed-month',zed+'-member','booked','visits',4,[{period:'month',unit:'visits',maximum:4}]);
 yield* approvedSession(session(zed,'zed-member-session','One actual three-hour member session','member-access','2026-10-03T09:00:00Z','2026-10-03T12:00:00Z',8,[zed+'-room'],zed+'-access',true));
 yield* confirm(booking(zed,'zed-member-place',zed+'-member','zed-member-session','zed-month',1,{externalRef:'DEMO-BOOKEO-ORIGINAL-REFERENCE'}));
 yield send('booking-attend',review('reviewBooking','zed-member-place'));
 yield send('attendance-correct',{id:'zed-member-place',reason:'Demonstration reasoned correction of the original attendance; original debit remains visible.'});
 yield piece(zed,'zed-refire',zed+'-member','Member work — explicit refire decision','Operator-selected cone 6');
 yield* loadCycle(zed,'zed-first-load','Retained first firing and refire decision',['zed-refire'],zed+'-firing','2026-10-04',['refire']);
 yield* clear('zed-refire',zed+'-firing');
 yield piece(zed,'zed-damage',zed+'-maker','Outside piece — actual damage retained','Operator-selected cone 6');
 yield* loadCycle(zed,'zed-damage-load','Recorded explicit damaged outcome',['zed-damage'],zed+'-firing','2026-10-05',['damaged']);
 walkthrough.push({studioKey:zed,focus:'Bookeo reference, reversible attendance ledger, original refire/damage outcomes and renewed programme clearance; fees remain unconfigured.',ids:['zed-month','zed-member-place','zed-refire','zed-damage']});
 const raw='reference,label,material,cone,stage\r\nINTAKE-001,"Outside maker, bowl","Explicit demo clay","^06–^04",greenware\r\nGARRET-BISQUE,"Existing source piece","Operator-selected demonstration clay body","^06–^04",greenware\r\n';
 const intake=C.reviewCSV(ctx.workspace,{name:'original-maker-intake.csv',text:raw,mapping:{externalRef:'reference',label:'label',material:'material',cone:'cone',stage:'stage',studioKey:{constant:garret},ownerId:{constant:garret+'-member'}}});
 yield {type:'csv-commit',review:intake,decisions:[{row:2,action:'create',pieceId:'garret-imported-piece',reason:''},{row:3,action:'link',pieceId:'garret-bisque',reason:'Link to the selected original member piece without overwriting it.'}]};
 walkthrough.push({studioKey:garret,focus:'Whole original CSV, quoted comma, leading-zero cone, explicit constant mappings and separate link/create decisions survive receiving.',ids:['garret-imported-piece','garret-bisque']});
}
function context(C,catalogue){return {workspace:C.create(catalogue,{id:'pebblesky-studio-demonstration',title:'Six studio operating walkthrough — demonstration records',now:'2026-10-13T08:00:00Z'})};}
function execute(C,ctx,command,index){ctx.workspace=C.mutate(ctx.workspace,command,{expectedRevision:ctx.workspace.revision,now:new Date(Date.parse('2026-10-13T08:00:00Z')+(index+1)*1000).toISOString(),actor:'Demonstration operator'});}
function result(ctx){return {workspace:ctx.workspace,ids:ctx.ids,walkthrough:ctx.walkthrough};}
function build(C,catalogue){const ctx=context(C,catalogue);let i=0;for(const command of programme(C,catalogue,ctx))execute(C,ctx,command,i++);return result(ctx);}
async function buildAsync(C,catalogue,{onProgress=()=>{},yieldEvery=8}={}){const ctx=context(C,catalogue);let i=0;for(const command of programme(C,catalogue,ctx)){execute(C,ctx,command,i++);if(i%yieldEvery===0){onProgress({operations:i,message:'Building complete studio example'});await new Promise(resolve=>setTimeout(resolve,0));}}onProgress({operations:i,message:'Complete studio example ready'});return result(ctx);}
return Object.freeze({build,buildAsync});
});
