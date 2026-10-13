import {readFile,open,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const [app,out]=process.argv.slice(2);
if(!app||!out)throw new Error('Provide complete application and existing Review directory.');
const mod=path=>import(pathToFileURL(join(resolve(app),path)).href);
const {createMatchPackage}=await mod('src/match_archive.mjs');
const {createBroadcastReport,broadcastHtml,broadcastVtt}=await mod('src/broadcast_handover.mjs');
const {buildPlayerRecap,playerRecapJson,playerRecapHtml}=await mod('src/player_recap.mjs');
const input=JSON.parse(await readFile(join(out,'Counterpress_Captured_Coach_Review.json'),'utf8'));
if(input.format!=='counterpress.coach-review.v1'||input.matches.length!==2)throw new Error('Original complete coach review required.');
const save=async(name,body)=>{
 const target=join(out,name),data=Buffer.from(body);
 try{const current=await readFile(target);if(!current.equals(data))throw new Error('Retained output differs: '+name);return;}catch(e){if(e.code!=='ENOENT')throw e;}
 const part=target+'.part';let prior=Buffer.alloc(0);
 try{prior=await readFile(part);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(prior.length>data.length||!prior.equals(data.subarray(0,prior.length)))throw new Error('Retained partial differs: '+name);
 const handle=await open(part,'a',0o600);
 try{await handle.writeFile(data.subarray(prior.length));await handle.sync();}finally{await handle.close();}
 await rename(part,target);
};
let proof=[];
for(let i=0;i<input.matches.length;i++){
 const original=input.matches[i].package;
 const normalized=createMatchPackage(original.match,original.review);
 if(!isDeepStrictEqual(normalized.match,original.match))throw new Error('Native match normalization changed original source.');
 for(const key of ['notes','insights','broadcast','bookmarks','recap']){
  if(original.review[key]!==undefined&&!isDeepStrictEqual(normalized.review[key],original.review[key]))throw new Error('Native review normalization changed '+key);
 }
 const stem=i===0?'Harbor_High_Press':'Harbor_Low_Block';
 await save(stem+'_Editable_Match.json',JSON.stringify(original,null,2)+'\n');
 for(const locale of ['en','es']){
  const recap=buildPlayerRecap(original.match.events,{team:'Harbor FC',player:'H10',period:'all',locale});
  if(!isDeepStrictEqual(recap.sourceEvents,original.match.events))throw new Error('Player recap source rows changed.');
  await save(stem+'_H10_Recap_'+locale+'.json',playerRecapJson(recap));
  await save(stem+'_H10_Recap_'+locale+'.html',playerRecapHtml(recap,{scenario:original.match.scenario,seed:original.match.seed}));
  proof.push({match:stem,locale,events:recap.sourceEvents.length,selection:recap.selection,coverage:recap.coverage});
 }
 if(original.review.broadcast){
  const report=createBroadcastReport(original.match,original.review);
  report.generatedAt=input.generatedAt;
  await save(stem+'_Broadcast_Report.json',JSON.stringify(report,null,2)+'\n');
  await save(stem+'_Broadcast.html',broadcastHtml(report,original));
  await save(stem+'_Broadcast_Captions.vtt',broadcastVtt(report));
  proof.push({match:stem,broadcastCues:report.cues.length,timedCues:report.timedCues,source:report.source});
 }
}
await save('EXPORTS.json',JSON.stringify({schema:'counterpress.original-reports.v1',complete:true,originalInsightsPreserved:true,modelCalls:0,results:proof},null,2)+'\n');
console.log(JSON.stringify({stage:'NATIVE_PUBLIC_EXPORTS',complete:true,results:proof}));
